#!/usr/bin/env node
/**
 * Static validation for the built style/data contract.
 * Run after: make fonts sprites styles config
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const errors = [];
const warnings = [];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function err(message) {
  errors.push(message);
}
function warn(message) {
  warnings.push(message);
}

const manifestPath = path.join(root, 'config/map.manifest.json');
if (!fs.existsSync(manifestPath)) {
  err('missing config/map.manifest.json');
} else {
  const manifest = readJson(manifestPath);
  const fontsPath = path.join(root, 'data/fonts/fonts.json');
  const fonts = fs.existsSync(fontsPath) ? readJson(fontsPath) : null;
  if (!fonts) err('missing data/fonts/fonts.json (run: make fonts)');

  const tilegen = readJson(path.join(root, 'tilegen/config.json'));
  const tilegenLayers = new Set(Object.keys(tilegen.layers));
  const groupsPath = path.join(root, 'styles/schema/layer-groups.json');
  const groups = fs.existsSync(groupsPath) ? readJson(groupsPath) : null;
  if (!groups) err('missing styles/schema/layer-groups.json');
  const groupIds = new Set((groups?.groups || []).map((g) => g.id));

  const knownFonts = new Set();
  if (fonts) {
    for (const name of [fonts.regular, fonts.bold]) {
      if (!name) continue;
      knownFonts.add(name);
      const dir = path.join(root, 'data/fonts', name);
      if (!fs.existsSync(dir)) err(`font directory missing: data/fonts/${name}`);
    }
  }

  const seenStyles = new Set();
  for (const meta of manifest.styles || []) {
    if (!meta.id) {
      err('style without id');
      continue;
    }
    if (seenStyles.has(meta.id)) err(`duplicate style id: ${meta.id}`);
    seenStyles.add(meta.id);

    const dataset = (manifest.datasets || {})[meta.dataset];
    if (!dataset) {
      err(`style ${meta.id}: unknown dataset ${meta.dataset}`);
      continue;
    }
    const datasetFile = path.join(root, 'data/tiles', dataset.pmtiles);
    if (!fs.existsSync(datasetFile)) err(`style ${meta.id}: missing dataset file data/tiles/${dataset.pmtiles}`);

    const stylePath = path.join(root, 'styles', `${meta.id}.json`);
    if (!fs.existsSync(stylePath)) {
      err(`style ${meta.id}: missing built style styles/${meta.id}.json (run: make styles)`);
      continue;
    }
    let style;
    try {
      style = readJson(stylePath);
    } catch (e) {
      err(`style ${meta.id}: invalid JSON (${e.message})`);
      continue;
    }

    if (style.version !== 8) err(`style ${meta.id}: version must be 8`);
    if (!style.sources || !style.sources.basemap) err(`style ${meta.id}: missing sources.basemap`);
    if (!Array.isArray(style.layers) || style.layers.length === 0) err(`style ${meta.id}: missing layers`);

    const source = style.sources?.basemap;
    if (source) {
      if (!Array.isArray(source.tiles) || source.tiles.length === 0) {
        err(`style ${meta.id}: basemap.tiles must be a non-empty array`);
      } else {
        const expected = `/data/${meta.dataset}/`;
        for (const tile of source.tiles) {
          if (!tile.startsWith(expected)) err(`style ${meta.id}: tile URL ${tile} does not start with ${expected}`);
          if (/^https?:\/\//.test(tile)) err(`style ${meta.id}: external tile URL ${tile}`);
        }
      }
      if (!source.attribution) warn(`style ${meta.id}: source has no attribution`);
    }

    if (!style.glyphs || !style.glyphs.startsWith('/fonts/')) {
      err(`style ${meta.id}: glyphs must be local /fonts/... (got ${style.glyphs})`);
    }
    if (style.sprite && /^https?:\/\//.test(String(style.sprite))) {
      err(`style ${meta.id}: external sprite URL ${style.sprite}`);
    }

    const spritePath = path.join(root, 'data/sprites', meta.id, 'sprite.json');
    const sprite = fs.existsSync(spritePath) ? readJson(spritePath) : null;
    if (!sprite) err(`style ${meta.id}: missing data/sprites/${meta.id}/sprite.json (run: make sprites)`);

    for (const layer of style.layers || []) {
      const group = layer.metadata && layer.metadata.group;
      if (!group || !groupIds.has(group)) {
        err(`style ${meta.id}: layer ${layer.id} has no valid metadata.group (got ${group})`);
      }
      if (typeof layer.minzoom === 'number' && typeof layer.maxzoom === 'number' && layer.minzoom > layer.maxzoom) {
        err(`style ${meta.id}: layer ${layer.id} has minzoom ${layer.minzoom} > maxzoom ${layer.maxzoom}`);
      }
      if (layer['source-layer'] && !tilegenLayers.has(layer['source-layer'])) {
        warn(`style ${meta.id}: layer ${layer.id} references missing source-layer ${layer['source-layer']}`);
      }
      const textFont = layer.layout && layer.layout['text-font'];
      if (textFont) {
        const names = Array.isArray(textFont) ? textFont : [textFont];
        for (const name of names) {
          if (typeof name === 'string' && !knownFonts.has(name)) {
            err(`style ${meta.id}: layer ${layer.id} uses unknown font ${name}`);
          }
        }
      }
      const icon = layer.layout && layer.layout['icon-image'];
      if (sprite && typeof icon === 'string' && /^[A-Za-z0-9_-]+$/.test(icon) && !sprite[icon]) {
        warn(`style ${meta.id}: layer ${layer.id} references missing sprite icon ${icon}`);
      }
    }

    // Full style-spec validation when the package is installed.
    try {
      const { validateStyleMin } = await import('@maplibre/maplibre-gl-style-spec');
      const issues = validateStyleMin(style);
      for (const issue of issues) {
        err(`style ${meta.id}: spec: ${issue.message}`);
      }
    } catch {
      warn('@maplibre/maplibre-gl-style-spec not installed; skipped full style validation');
    }
  }
}

for (const message of warnings) console.warn(`check: warning: ${message}`);
for (const message of errors) console.error(`check: error: ${message}`);
if (errors.length) {
  console.error(`check: FAILED (${errors.length} errors, ${warnings.length} warnings)`);
  process.exit(1);
}
console.log(`check: OK (${warnings.length} warnings)`);
