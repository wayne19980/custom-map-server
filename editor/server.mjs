#!/usr/bin/env node
/**
 * Minimal style-editing API.
 *
 * The browser UI (web/editor.html) reads styles from the static Nginx route,
 * and writes through this service. Writes are validated, backed up under
 * data/style-versions/<styleId>/, and applied atomically.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';

const PORT = Number(process.env.PORT || 8090);
const STYLES_DIR = path.resolve(process.env.STYLES_DIR || '/srv/styles');
const VERSIONS_DIR = path.resolve(process.env.VERSIONS_DIR || '/srv/versions');
const MANIFEST_PATH = path.resolve(process.env.MANIFEST_PATH || '/srv/config/map.manifest.json');
const TOKEN = process.env.EDITOR_TOKEN || '';
const MAX_BODY = Number(process.env.MAX_BODY_BYTES || 8 * 1024 * 1024);

fs.mkdirSync(VERSIONS_DIR, { recursive: true });

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function fail(res, status, message, details) {
  send(res, status, { ok: false, error: message, details: details || undefined });
}

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function styleIds() {
  return new Set((readManifest().styles || []).map((style) => style.id));
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authorized(req) {
  if (!TOKEN) return true; // local/dev mode; set EDITOR_TOKEN in production
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const token = bearer || req.headers['x-editor-token'];
  return typeof token === 'string' && safeEqual(token, TOKEN);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error(`request body exceeds ${MAX_BODY} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function stylePath(id) {
  return path.join(STYLES_DIR, `${id}.json`);
}

function versionsPath(id) {
  return path.join(VERSIONS_DIR, id);
}

function versionName() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(2).toString('hex')}.json`;
}

function listVersions(id) {
  const dir = versionsPath(id);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { version: name, size: stat.size, mtime: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

function backup(id, contents) {
  const dir = versionsPath(id);
  fs.mkdirSync(dir, { recursive: true });
  const name = versionName();
  fs.writeFileSync(path.join(dir, name), contents);
  return name;
}

function writeAtomic(file, contents) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, file);
}

function validateStyle(style, id) {
  const issues = [];
  if (!style || typeof style !== 'object' || Array.isArray(style)) {
    return ['style must be a JSON object'];
  }
  if (style.version !== 8) issues.push('style.version must be 8');
  if (!style.sources || typeof style.sources !== 'object') issues.push('style.sources is required');
  if (!Array.isArray(style.layers)) issues.push('style.layers must be an array');

  if (style.metadata && style.metadata['map:styleId'] && style.metadata['map:styleId'] !== id) {
    issues.push(`metadata.map:styleId (${style.metadata['map:styleId']}) does not match ${id}`);
  }
  if (issues.length) return issues;

  style.metadata = { ...(style.metadata || {}), 'map:styleId': id };
  for (const issue of validateStyleMin(style)) {
    issues.push(issue.message || String(issue));
  }
  return issues;
}

async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://editor.local');
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === 'GET' && pathname === '/api/health') {
    return send(res, 200, { ok: true, service: 'custom-map-editor-api', auth: Boolean(TOKEN) });
  }

  if (pathname === '/api/manifest' && req.method === 'GET') {
    return send(res, 200, readManifest());
  }

  if (pathname === '/api/styles' && req.method === 'GET') {
    if (!authorized(req)) return fail(res, 401, 'missing or invalid editor token');
    const manifest = readManifest();
    return send(
      res,
      200,
      (manifest.styles || []).map((style) => ({
        ...style,
        versions: listVersions(style.id).length,
      })),
    );
  }

  const match = pathname.match(/^\/api\/styles\/([a-z0-9_-]+)(?:\/(versions|restore|validate))?$/);
  if (!match) return fail(res, 404, 'not found');
  const id = match[1];
  const action = match[2] || 'style';

  if (!styleIds().has(id)) return fail(res, 404, `unknown style id: ${id}`);
  if (!authorized(req)) return fail(res, 401, 'missing or invalid editor token');

  if (action === 'style' && req.method === 'GET') {
    const file = stylePath(id);
    if (!fs.existsSync(file)) return fail(res, 404, `style file missing: ${id}.json`);
    return send(res, 200, fs.readFileSync(file, 'utf8'));
  }

  if (action === 'versions' && req.method === 'GET') {
    return send(res, 200, { ok: true, versions: listVersions(id) });
  }

  if (action === 'validate' && req.method === 'POST') {
    let style;
    try {
      style = JSON.parse(await readBody(req));
    } catch (error) {
      return fail(res, 400, 'invalid JSON', error.message);
    }
    const issues = validateStyle(style, id);
    return send(res, issues.length ? 422 : 200, { ok: issues.length === 0, issues });
  }

  if (action === 'style' && req.method === 'PUT') {
    let style;
    try {
      style = JSON.parse(await readBody(req));
    } catch (error) {
      return fail(res, 400, 'invalid JSON', error.message);
    }
    const issues = validateStyle(style, id);
    if (issues.length) return send(res, 422, { ok: false, error: 'style validation failed', issues });

    const contents = `${JSON.stringify(style, null, 2)}\n`;
    const file = stylePath(id);
    let previousVersion = null;
    if (fs.existsSync(file)) previousVersion = backup(id, fs.readFileSync(file, 'utf8'));
    writeAtomic(file, contents);
    const version = backup(id, contents);
    return send(res, 200, {
      ok: true,
      id,
      version,
      previousVersion,
      bytes: Buffer.byteLength(contents),
    });
  }

  if (action === 'restore' && req.method === 'POST') {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (error) {
      return fail(res, 400, 'invalid JSON', error.message);
    }
    const version = typeof payload.version === 'string' ? payload.version : '';
    if (!/^[A-Za-z0-9._-]+\.json$/.test(version)) return fail(res, 400, 'invalid version name');
    const source = path.join(versionsPath(id), version);
    if (!source.startsWith(versionsPath(id) + path.sep) || !fs.existsSync(source)) {
      return fail(res, 404, `version not found: ${version}`);
    }
    let style;
    try {
      style = JSON.parse(fs.readFileSync(source, 'utf8'));
    } catch (error) {
      return fail(res, 422, 'version is not valid JSON', error.message);
    }
    const issues = validateStyle(style, id);
    if (issues.length) return send(res, 422, { ok: false, error: 'version validation failed', issues });

    const contents = `${JSON.stringify(style, null, 2)}\n`;
    const file = stylePath(id);
    let previousVersion = null;
    if (fs.existsSync(file)) previousVersion = backup(id, fs.readFileSync(file, 'utf8'));
    writeAtomic(file, contents);
    const newVersion = backup(id, contents);
    return send(res, 200, { ok: true, id, restored: version, version: newVersion, previousVersion });
  }

  return fail(res, 405, 'method not allowed');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error('editor-api:', error);
    if (!res.headersSent) fail(res, 500, 'internal error', error.message);
    else res.end();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`custom-map-editor-api listening on :${PORT}`);
  console.log(`  styles:   ${STYLES_DIR}`);
  console.log(`  versions: ${VERSIONS_DIR}`);
  console.log(`  auth:     ${TOKEN ? 'token required' : 'disabled (set EDITOR_TOKEN)'}`);
});
