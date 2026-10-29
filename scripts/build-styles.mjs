#!/usr/bin/env node
/**
 * Build deployable MapLibre styles from vendored OpenMapTiles styles
 * plus the data/style binding in config/map.manifest.json.
 *
 * Inputs:
 *   config/map.manifest.json
 *   styles/vendor/<...>/style.json
 *   data/fonts/fonts.json
 *   data/sprites/<styleId>/sprite.json
 *
 * Output:
 *   styles/<styleId>.json   (flat files served by TileServer GL)
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const manifestPath = path.join(root, 'config/map.manifest.json');
const fontsPath = path.join(root, 'data/fonts/fonts.json');
const tilegenConfigPath = path.join(root, 'tilegen/config.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fail(message) {
  console.error(`build-styles: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) fail(`missing ${manifestPath}`);
if (!fs.existsSync(fontsPath)) fail(`missing ${fontsPath} (run: make fonts)`);

const manifest = readJson(manifestPath);
const fonts = readJson(fontsPath);
const tilegenLayers = new Set(Object.keys(readJson(tilegenConfigPath).layers));
const groupsPath = path.join(root, 'styles/schema/layer-groups.json');
const groups = fs.existsSync(groupsPath) ? readJson(groupsPath) : { groups: [] };
const groupIds = new Set((groups.groups || []).map((g) => g.id));
const boldPattern = /(bold|semibold|semi-bold|medium|black|heavy)/i;

function inferGroup(layer) {
  const id = layer.id || '';
  const sourceLayer = layer['source-layer'] || '';
  if (id === 'background') return 'background';
  if (['water', 'waterway', 'water_name'].includes(sourceLayer)) return 'water';
  if (['landuse', 'landcover', 'park'].includes(sourceLayer)) return 'land';
  if (sourceLayer === 'building') return 'building';
  if (['transportation', 'transportation_name', 'aeroway'].includes(sourceLayer)) return 'transport';
  if (sourceLayer === 'boundary') return 'boundary';
  if (sourceLayer === 'place') return 'place';
  if (sourceLayer === 'poi') return 'poi';
  return 'other';
}

const styleIds = new Set();

for (const meta of manifest.styles) {
  const styleId = meta.id;
  if (!styleId) fail('style without id');
  if (styleIds.has(styleId)) fail(`duplicate style id: ${styleId}`);
  styleIds.add(styleId);

  const dataset = manifest.datasets[meta.dataset];
  if (!dataset) fail(`style ${styleId}: unknown dataset ${meta.dataset}`);

  const basePath = path.join(root, 'styles', meta.base);
  if (!fs.existsSync(basePath)) fail(`style ${styleId}: missing base ${basePath}`);
  const base = readJson(basePath);

  let palette = null;
  if (meta.palette) {
    const palettePath = path.join(root, 'styles', meta.palette);
    if (!fs.existsSync(palettePath)) fail(`style ${styleId}: missing palette ${palettePath}`);
    palette = readJson(palettePath);
  }

  // Deep clone so the vendored file is never mutated.
  const style = JSON.parse(JSON.stringify(base));

  if (style.version !== 8) fail(`style ${styleId}: expected version 8`);

  // --- data source: one vector source, served by TileServer GL ---------------
  const tileUrl = `/data/${meta.dataset}/{z}/{x}/{y}.pbf?v=${dataset.version}`;
  style.sources = {
    basemap: {
      type: 'vector',
      tiles: [tileUrl],
      minzoom: dataset.minzoom,
      maxzoom: dataset.maxzoom,
      bounds: dataset.bounds,
      attribution: dataset.attribution,
    },
  };

  for (const layer of style.layers || []) {
    if (layer.source === 'openmaptiles' || layer.source === 'maptiler' || layer.source === 'basemap') {
      layer.source = 'basemap';
    }
  }

  // --- local resources -------------------------------------------------------
  style.glyphs = '/fonts/{fontstack}/{range}.pbf';
  // Relative to TileServer GL's paths.sprites; it rewrites this to
  // /styles/<id>/sprite and serves the local files.
  style.sprite = `/sprites/${styleId}/sprite`;

  // --- camera ----------------------------------------------------------------
  style.center = dataset.center;
  style.zoom = dataset.zoom;
  style.name = `${base.name || styleId} · ${meta.label || styleId}`;

  // --- fonts: use one CJK font per style, chosen by weight -------------------
  for (const layer of style.layers || []) {
    const layout = layer.layout;
    if (!layout || !layout['text-font']) continue;
    const original = JSON.stringify(layout['text-font']);
    layout['text-font'] = [boldPattern.test(original) ? fonts.bold : fonts.regular];
  }

  // Dark Matter's default labels are very low-contrast on its near-black
  // background. Lift the most important label groups a little for readability.
  if (styleId === 'dark') {
    for (const layer of style.layers || []) {
      if (layer.type !== 'symbol' || !layer.layout || !layer.layout['text-field']) continue;
      layer.paint = layer.paint || {};
      if (layer.id.startsWith('place_')) layer.paint['text-color'] = '#c9c9c9';
      else if (layer.id.startsWith('highway_name_')) layer.paint['text-color'] = '#8f8f8f';
      else if (layer.id === 'water_name') layer.paint['text-color'] = '#7fa7c9';
    }
  }

  // --- optional palette override (layer-id based) ----------------------------
  if (palette) {
    for (const [layerId, override] of Object.entries(palette.layers || {})) {
      const layer = (style.layers || []).find((item) => item.id === layerId);
      if (!layer) {
        console.warn(`build-styles: warning: ${styleId} palette references missing layer ${layerId}`);
        continue;
      }
      layer.paint = layer.paint || {};
      for (const key of override.removePaint || []) delete layer.paint[key];
      Object.assign(layer.paint, override.paint || {});
      if (override.layout) {
        layer.layout = layer.layout || {};
        Object.assign(layer.layout, override.layout);
      }
      if (override.filter !== undefined) layer.filter = override.filter;
      if (override.minzoom !== undefined) layer.minzoom = override.minzoom;
      if (override.maxzoom !== undefined) layer.maxzoom = override.maxzoom;
    }
  }

  // --- optional extra layers (e.g. split a road class by zoom) ---------------
  for (const spec of palette?.extraLayers || []) {
    const source = (style.layers || []).find((item) => item.id === spec.clone);
    if (!source) {
      console.warn(`build-styles: warning: ${styleId} extraLayer references missing layer ${spec.clone}`);
      continue;
    }
    const layer = JSON.parse(JSON.stringify(source));
    layer.id = spec.id;
    if (spec.minzoom !== undefined) layer.minzoom = spec.minzoom;
    if (spec.maxzoom !== undefined) layer.maxzoom = spec.maxzoom;
    if (spec.filter !== undefined) layer.filter = spec.filter;
    if (spec.paint) Object.assign(layer.paint || (layer.paint = {}), spec.paint);
    if (spec.layout) Object.assign(layer.layout || (layer.layout = {}), spec.layout);
    const index = style.layers.indexOf(source);
    style.layers.splice(index + 1, 0, layer);
  }

  // --- layer groups for the editor/style tooling -----------------------------
  for (const layer of style.layers || []) {
    layer.metadata = layer.metadata || {};
    if (!layer.metadata.group || !groupIds.has(layer.metadata.group)) {
      layer.metadata.group = inferGroup(layer);
    }
  }

  // --- metadata: expose the binding to the frontend/inspector ----------------
  style.metadata = {
    ...(style.metadata || {}),
    'map:styleId': styleId,
    'map:datasetId': meta.dataset,
    'map:dataVersion': dataset.version,
    'map:attribution': dataset.attribution,
    'map:groups': (groups.groups || []).map((g) => g.id),
    ...(palette ? { 'map:palette': meta.palette } : {}),
  };

  // --- sanity warnings (non-fatal) ------------------------------------------
  const spritePath = path.join(root, 'data/sprites', styleId, 'sprite.json');
  let sprite = null;
  if (fs.existsSync(spritePath)) {
    sprite = readJson(spritePath);
  } else {
    console.warn(`build-styles: warning: missing sprite for ${styleId} (${spritePath})`);
  }

  const missingLayers = new Set();
  const missingIcons = new Set();
  for (const layer of style.layers || []) {
    if (layer['source-layer'] && !tilegenLayers.has(layer['source-layer'])) {
      missingLayers.add(layer['source-layer']);
    }
    const icon = layer.layout && layer.layout['icon-image'];
    if (sprite && typeof icon === 'string' && /^[A-Za-z0-9_-]+$/.test(icon) && !sprite[icon]) {
      missingIcons.add(icon);
    }
  }
  if (missingLayers.size) {
    console.warn(`build-styles: warning: ${styleId} references missing source-layers: ${[...missingLayers].join(', ')}`);
  }
  if (missingIcons.size) {
    console.warn(`build-styles: warning: ${styleId} references missing sprite icons: ${[...missingIcons].join(', ')}`);
  }

  const outPath = path.join(root, 'styles', `${styleId}.json`);
  // The editor service may have created this file as a different uid; unlink
  // first so a normal user can regenerate it.
  try {
    fs.rmSync(outPath, { force: true });
  } catch {
    // ignore; the write below will report a useful error
  }
  fs.writeFileSync(outPath, `${JSON.stringify(style, null, 2)}\n`);

  console.log(`build-styles: wrote ${path.relative(root, outPath)} (${style.layers.length} layers, font ${fonts.regular}${boldPattern.test(JSON.stringify(base.layers)) ? ' / ' + fonts.bold : ''})`);
}

console.log(`build-styles: done (${styleIds.size} styles)`);
