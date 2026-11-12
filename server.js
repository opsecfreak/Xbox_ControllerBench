#!/usr/bin/env node
// Server for ControllerBench. No dependencies.
// Serves the tester page (which reads the controller in the browser) and,
// on the desktop-mode branch, a small local API that starts and stops the
// Windows desktop mode helper and saves its settings. The API answers only
// requests from this machine's own page (see isLocalRequest).

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopManager } from './desktop/manager.js';

const ROOT = resolve(fileURLToPath(new URL('./public/', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

/** Resolve a URL path to a file inside ROOT, or null if it escapes ROOT. */
export function resolvePath(urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (p.includes('\0')) return null;
  if (p.endsWith('/')) p += 'index.html';
  const full = resolve(join(ROOT, normalize(p)));
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  return full;
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** True when the request comes from this machine's own page (blocks other sites and DNS rebinding). */
export function isLocalRequest(req) {
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  if (!LOCAL_HOSTS.has(host)) return false;
  const origin = req.headers.origin;
  if (origin) {
    let o;
    try { o = new URL(origin); } catch { return false; }
    if (o.protocol !== 'http:' || !LOCAL_HOSTS.has(o.hostname === '::1' ? '[::1]' : o.hostname)) return false;
  }
  // A custom header forces a CORS preflight, which this server never approves.
  return req.headers['x-controllerbench'] === '1';
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, limit = 65536) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleDesktopApi(req, res, desktop) {
  if (!isLocalRequest(req)) return sendJson(res, 403, { error: 'Forbidden' });
  if (!desktop) return sendJson(res, 404, { error: 'Desktop mode is not available' });
  const path = req.url.split('?')[0];
  try {
    if (path === '/api/desktop/status' && req.method === 'GET') return sendJson(res, 200, desktop.status());
    if (path === '/api/desktop/config' && req.method === 'GET') return sendJson(res, 200, desktop.config);
    if (path === '/api/desktop/config' && req.method === 'PUT') {
      const obj = JSON.parse(await readBody(req));
      return sendJson(res, 200, await desktop.saveConfig(obj));
    }
    if (path === '/api/desktop/start' && req.method === 'POST') {
      const r = desktop.start();
      return sendJson(res, r.ok ? 200 : 409, r);
    }
    if (path === '/api/desktop/stop' && req.method === 'POST') return sendJson(res, 200, await desktop.stop());
    if (path === '/api/desktop/enabled' && req.method === 'POST') {
      const obj = JSON.parse(await readBody(req));
      return sendJson(res, 200, { enabled: desktop.setEnabled(!!obj.enabled) });
    }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }
}

/** opts.desktop: a DesktopManager (desktop mode branch). */
export function createServer(opts = {}) {
  return http.createServer(async (req, res) => {
    if ((req.url || '').startsWith('/api/')) {
      await handleDesktopApi(req, res, opts.desktop);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...HEADERS, Allow: 'GET, HEAD' });
      res.end('Method not allowed');
      return;
    }
    const file = resolvePath(req.url || '/');
    if (!file) {
      res.writeHead(403, HEADERS);
      res.end('Forbidden');
      return;
    }
    try {
      const st = await stat(file);
      if (!st.isFile()) throw new Error('not a file');
      const body = await readFile(file);
      res.writeHead(200, {
        ...HEADERS,
        'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': body.length,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3100);
  const dataDir = process.env.CONTROLLERBENCH_DATA || fileURLToPath(new URL('./data/', import.meta.url));
  const desktop = new DesktopManager({ configPath: join(dataDir, 'desktop-config.json') });
  await desktop.loadConfig();
  const server = createServer({ desktop });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is in use. Run with another port, for example: PORT=3101 npm start`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });
  server.listen(port, host, () => {
    const shown = host === '0.0.0.0' ? '127.0.0.1' : host;
    console.log(`ControllerBench running at http://${shown}:${port}/`);
    console.log(`Desktop mode settings: http://${shown}:${port}/desktop.html`);
    console.log('Open this URL in Chrome. Press Ctrl+C to stop.');
    if (process.argv.includes('--desktop')) {
      const r = desktop.start();
      console.log('Desktop mode: ' + r.message);
    }
  });
  const shutdown = async () => {
    await desktop.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
