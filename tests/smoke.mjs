#!/usr/bin/env node
/**
 * Browser smoke test for the running stack.
 * Requires Playwright's Chromium (or set CHROME=/path/to/chrome).
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const outDir = path.join(process.cwd(), 'docs/screenshots');
fs.mkdirSync(outDir, { recursive: true });

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (!fs.existsSync(root)) return undefined;
  for (const entry of fs.readdirSync(root)) {
    if (!entry.startsWith('chromium-')) continue;
    const candidate = path.join(root, entry, 'chrome-linux64', 'chrome');
    if (fs.existsSync(candidate)) return candidate;
    const fallback = path.join(root, entry, 'chrome-linux', 'chrome');
    if (fs.existsSync(fallback)) return fallback;
  }
  return undefined;
}

const executablePath = findChrome();
if (!executablePath) {
  console.error('smoke: no Chromium found; set CHROME=/path/to/chrome');
  process.exit(1);
}

const consoleErrors = [];
const pageErrors = [];
const externalRequests = new Set();
const tileResponses = [];
const fontResponses = [];
const spriteResponses = [];
const badResponses = [];

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('request', (request) => {
  const url = new URL(request.url());
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    externalRequests.add(request.url());
  }
});
page.on('response', (response) => {
  const url = response.url();
  if (!response.ok()) { badResponses.push({ status: response.status(), url }); return; }
  if (url.includes('/data/') && url.endsWith('.pbf')) tileResponses.push(response.status());
  if (url.includes('/fonts/')) fontResponses.push(response.status());
  if (url.includes('/sprite')) spriteResponses.push(response.status());
});

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForSelector('#map canvas', { timeout: 30_000 });
await page.waitForFunction(() => window.__map && window.__map.loaded(), null, { timeout: 45_000 });
await page.waitForTimeout(10_000);

const state = await page.evaluate(() => {
  const map = window.__map;
  return {
    title: document.title,
    buttons: [...document.querySelectorAll('#style-switcher button')].map((b) => b.textContent),
    loadingHidden: document.getElementById('loading')?.classList.contains('is-hidden') ?? false,
    canvases: document.querySelectorAll('#map canvas').length,
    active: document.querySelector('#style-switcher button.is-active')?.textContent ?? null,
    mapLoaded: map?.loaded() ?? false,
    tilesLoaded: map?.areTilesLoaded() ?? false,
    layers: map?.getStyle()?.layers?.length ?? 0,
    hasSource: Boolean(map?.getSource('basemap')),
    hasSpriteImage: map?.hasImage('circle-11') ?? false,
    zoom: map?.getZoom() ?? null,
  };
});

await page.screenshot({ path: path.join(outDir, 'shanghai-light.png') });

// Detail check: buildings/street labels at z16.
await page.evaluate(() => window.__map?.jumpTo({ center: [121.4737, 31.2304], zoom: 16 }));
await page.waitForTimeout(8_000);
await page.screenshot({ path: path.join(outDir, 'shanghai-z16.png') });
await page.evaluate(() => window.__map?.jumpTo({ center: [121.4737, 31.2304], zoom: 11 }));
await page.waitForTimeout(4_000);

async function switchTo(label) {
  const button = page.locator('#style-switcher button', { hasText: label });
  await button.click();
  await page.waitForTimeout(8_000);
  const slug = label === '深色' ? 'dark' : label === '彩色' ? 'bright' : 'blueprint';
  await page.screenshot({ path: path.join(outDir, `shanghai-${slug}.png`) });
  return page.evaluate(() => document.querySelector('#style-switcher button.is-active')?.textContent ?? null);
}

const afterDark = await switchTo('深色');
const afterBright = await switchTo('彩色');
const afterBlueprint = await switchTo('深蓝');

await browser.close();

const report = {
  state,
  afterDark,
  afterBright,
  afterBlueprint,
  tiles: tileResponses.length,
  fonts: fontResponses.length,
  sprites: spriteResponses.length,
  badResponses,
  consoleErrors,
  pageErrors,
  externalRequests: [...externalRequests],
};

console.log(JSON.stringify(report, null, 2));

const failures = [];
if (!state.loadingHidden) failures.push('initial map did not finish loading');
if (state.buttons.length !== 4) failures.push(`expected 4 style buttons, got ${state.buttons.length}`);
if (afterDark !== '深色') failures.push('dark style did not activate');
if (afterBright !== '彩色') failures.push('bright style did not activate');
if (afterBlueprint !== '深蓝') failures.push('blueprint style did not activate');
if (!state.mapLoaded) failures.push('map is not loaded');
if (!state.tilesLoaded) failures.push('map tiles are not loaded');
if (!state.hasSource) failures.push('basemap source is missing');
if (state.layers === 0) failures.push('style has no layers');
if (fontResponses.length === 0) failures.push('no glyph ranges loaded');
if (spriteResponses.length === 0) failures.push('no sprite assets loaded');
if (consoleErrors.length) failures.push(`console errors: ${consoleErrors.length}`);
if (pageErrors.length) failures.push(`page errors: ${pageErrors.length}`);
if (externalRequests.length) failures.push(`external requests: ${externalRequests.length}`);

if (failures.length) {
  console.error('\nsmoke: FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('\nsmoke: OK');
