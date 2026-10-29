#!/usr/bin/env node
/**
 * Generate config/tileserver.config.json from config/map.manifest.json.
 * This is the only place where dataset/style ids are bound to files.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const manifestPath = path.join(root, 'config/map.manifest.json');
const outPath = path.join(root, 'config/tileserver.config.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function fail(message) {
  console.error(`gen-config: ${message}`);
  process.exit(1);
}

const styles = {};
for (const meta of manifest.styles) {
  if (!meta.id) fail('style without id');
  const styleFile = path.join(root, 'styles', `${meta.id}.json`);
  if (!fs.existsSync(styleFile)) fail(`missing style file: ${styleFile} (run: make styles)`);
  styles[meta.id] = {
    style: `${meta.id}.json`,
    serve_rendered: false,
  };
}

const data = {};
for (const [id, ds] of Object.entries(manifest.datasets || {})) {
  const file = path.join(root, 'data/tiles', ds.pmtiles);
  if (!fs.existsSync(file)) fail(`missing dataset file: ${file} (run: make tiles)`);
  data[id] = { pmtiles: ds.pmtiles };
}

const config = {
  options: {
    paths: {
      root: '/srv/map',
      fonts: 'fonts',
      sprites: 'sprites',
      styles: 'styles',
      pmtiles: 'tiles',
      mbtiles: 'tiles',
    },
    serveAllFonts: true,
    serveAllStyles: false,
    serveStaticMaps: false,
    staticAttributionText: manifest.branding?.attribution || '© OpenStreetMap contributors',
    allowedHosts: '*',
  },
  styles,
  data,
};

fs.writeFileSync(outPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`gen-config: wrote ${path.relative(root, outPath)} (${Object.keys(styles).length} styles, ${Object.keys(data).length} datasets)`);
