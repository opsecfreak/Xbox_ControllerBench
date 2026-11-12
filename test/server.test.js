import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, resolvePath } from '../server.js';

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

test('serves the page and modules with the right types', async () => {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /ControllerBench/);
  const js = await fetch(base + '/js/app.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
});

test('every module the page imports exists', async () => {
  for (const f of ['app', 'controller', 'keyboard', 'diagnostics', 'errors', 'lib/stats', 'lib/calibration', 'lib/keytracker', 'lib/mapping', 'lib/layout', 'lib/chatpad', 'chatpad-ui', 'desktop-page']) {
    const r = await fetch(`${base}/js/${f}.js`);
    assert.equal(r.status, 200, f);
  }
  assert.equal((await fetch(base + '/css/app.css')).status, 200);
});

test('blocks path traversal and other methods', async () => {
  assert.equal(resolvePath('/../package.json'), resolvePath('/package.json')); // normalized inside root
  assert.equal(resolvePath('/%2e%2e/%2e%2e/etc/passwd')?.includes('etc'), true); // stays under public/
  assert.equal(resolvePath('/%E0%A4%A'), null);
  assert.equal(resolvePath('/a\0b'), null);
  assert.equal((await fetch(base + '/../server.js')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e/server.js')).status, 404);
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/nope.html')).status, 404);
});
