import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VK, PAD_BUTTONS, parseAction, defaultConfig, sanitizeConfig } from '../desktop/config.js';
import { Engine, parseStateLine, commandToLine } from '../desktop/engine.js';
import { DesktopManager } from '../desktop/manager.js';
import { createServer, isLocalRequest } from '../server.js';

const idle = () => ({ connected: true, buttons: {}, lt: 0, rt: 0, lx: 0, ly: 0, rx: 0, ry: 0 });
const withBtn = (names, extra = {}) => ({ ...idle(), buttons: Object.fromEntries(names.map((n) => [n, true])), ...extra });

test('parseAction accepts the documented forms and rejects junk', () => {
  assert.deepEqual(parseAction('none'), { type: 'none' });
  assert.deepEqual(parseAction('precision'), { type: 'precision' });
  assert.deepEqual(parseAction('mouse:left'), { type: 'mouse', button: 'left' });
  assert.deepEqual(parseAction('key:Ctrl+Shift+T'), { type: 'key', vks: [VK.Ctrl, VK.Shift, VK.T] });
  assert.deepEqual(parseAction('key:win+ctrl+o'), { type: 'key', vks: [VK.Win, VK.Ctrl, VK.O] });
  assert.deepEqual(parseAction('key:F24'), { type: 'key', vks: [0x87] });
  for (const bad of ['mouse:side', 'key:', 'key:Foo', 'key:A+B+C+D+E', 'click', ':x', 42, null]) assert.equal(parseAction(bad), null, String(bad));
});

test('sanitizeConfig clamps numbers and drops bad button actions', () => {
  const c = sanitizeConfig({ mouse: { speed: 1e9, deadzone: -1 }, buttons: { a: 'key:Nope', b: 'mouse:middle' }, player: 9, pollMs: 'x' });
  assert.equal(c.mouse.speed, 6000);
  assert.equal(c.mouse.deadzone, 0);
  assert.equal(c.buttons.a, defaultConfig().buttons.a);
  assert.equal(c.buttons.b, 'mouse:middle');
  assert.equal(c.player, 3);
  assert.equal(c.pollMs, 8);
  assert.deepEqual(sanitizeConfig(null), defaultConfig());
  for (const v of Object.values(defaultConfig().buttons)) assert.ok(parseAction(v), v);
});

test('pointer: deadzone, speed and sub-pixel accumulation', () => {
  const e = new Engine(defaultConfig());
  e.update(idle(), 0);
  // Inside the deadzone: no movement.
  assert.deepEqual(e.update({ ...idle(), lx: 0.1 }, 100), []);
  // Full tilt right for 100 ms at 1400 px/s = 140 px.
  const out = e.update({ ...idle(), lx: 1 }, 200);
  assert.deepEqual(out, [{ t: 'move', dx: 140, dy: 0 }]);
  // Small tilt adds up over frames instead of being lost.
  let total = 0;
  for (let t = 208; t <= 1200; t += 8) for (const c of e.update({ ...idle(), lx: 0.3 }, t)) total += c.dx;
  assert.ok(total > 0, 'small tilt should still move');
});

test('precision (LT) slows the pointer', () => {
  const e = new Engine(defaultConfig());
  e.update(idle(), 0);
  const fast = e.update({ ...idle(), lx: 1 }, 100)[0].dx;
  const e2 = new Engine(defaultConfig());
  e2.update(idle(), 0);
  const slow = e2.update({ ...idle(), lx: 1, lt: 1 }, 100)[0].dx;
  assert.equal(fast, 140);
  assert.equal(slow, 42);
});

test('right stick scrolls; stick up = wheel up', () => {
  const e = new Engine(defaultConfig());
  e.update(idle(), 0);
  const out = e.update({ ...idle(), ry: -1 }, 100);
  assert.deepEqual(out, [{ t: 'wheel', v: 144 }]); // 12 notches/s * 120 * 0.1 s
});

test('A holds left mouse button for drag, B right click', () => {
  const e = new Engine(defaultConfig());
  assert.deepEqual(e.update(withBtn(['a']), 0), [{ t: 'mouse', button: 'left', down: true }]);
  assert.deepEqual(e.update(withBtn(['a']), 10), []);
  assert.deepEqual(e.update(idle(), 20), [{ t: 'mouse', button: 'left', down: false }]);
  assert.deepEqual(e.update(withBtn(['b']), 30), [{ t: 'mouse', button: 'right', down: true }]);
});

test('key combos press in order and release in reverse', () => {
  const cfg = defaultConfig();
  cfg.buttons.x = 'key:Ctrl+C';
  const e = new Engine(cfg);
  assert.deepEqual(e.update(withBtn(['x']), 0), [{ t: 'key', vk: VK.Ctrl, down: true }, { t: 'key', vk: VK.C, down: true }]);
  assert.deepEqual(e.update(idle(), 10), [{ t: 'key', vk: VK.C, down: false }, { t: 'key', vk: VK.Ctrl, down: false }]);
});

test('d-pad keys repeat while held', () => {
  const e = new Engine(defaultConfig());
  e.update(withBtn(['down']), 0);
  assert.deepEqual(e.update(withBtn(['down']), 399), []);
  assert.deepEqual(e.update(withBtn(['down']), 400), [{ t: 'key', vk: VK.Down, down: true }]);
  assert.deepEqual(e.update(withBtn(['down']), 430), []);
  assert.deepEqual(e.update(withBtn(['down']), 460), [{ t: 'key', vk: VK.Down, down: true }]);
  assert.deepEqual(e.update(idle(), 470), [{ t: 'key', vk: VK.Down, down: false }]);
});

test('View and Menu tap on release; holding both toggles without firing them', () => {
  const e = new Engine(defaultConfig());
  // Tap Menu alone: Win key down+up on release.
  assert.deepEqual(e.update(withBtn(['menu']), 0), []);
  assert.deepEqual(e.update(idle(), 50), [{ t: 'key', vk: VK.Win, down: true }, { t: 'key', vk: VK.Win, down: false }]);
  // Hold both for 1 s: pause, rumble, no Win or Win+Tab.
  assert.equal(e.enabled, true);
  e.update(withBtn(['view', 'menu']), 100);
  const out = e.update(withBtn(['view', 'menu']), 1100);
  assert.equal(e.enabled, false);
  assert.deepEqual(out, [{ t: 'rumble', l: 0.6, r: 0, ms: 250 }]);
  assert.deepEqual(e.update(withBtn(['menu']), 1150), []);
  assert.deepEqual(e.update(idle(), 1200), []);
  // While paused nothing is sent.
  assert.deepEqual(e.update(withBtn(['a'], { lx: 1 }), 1300), []);
  // Hold again to resume.
  e.update(withBtn(['view', 'menu']), 1400);
  e.update(withBtn(['view', 'menu']), 2400);
  assert.equal(e.enabled, true);
});

test('disconnect and pause release everything held', () => {
  const e = new Engine(defaultConfig());
  e.update(withBtn(['a', 'up']), 0);
  assert.deepEqual(e.update({ connected: false }, 10), [{ t: 'mouse', button: 'left', down: false }, { t: 'key', vk: VK.Up, down: false }]);
  e.update(withBtn(['a']), 20);
  e.update(withBtn(['a', 'view', 'menu']), 30);
  const out = e.update(withBtn(['a', 'view', 'menu']), 1030);
  assert.ok(out.some((c) => c.t === 'mouse' && c.button === 'left' && c.down === false));
  assert.equal(e.held.size, 0);
});

test('two buttons on the same key share it (one down, one up)', () => {
  const cfg = defaultConfig();
  cfg.buttons.x = 'key:Enter';
  cfg.buttons.y = 'key:Enter';
  const e = new Engine(cfg);
  assert.equal(e.update(withBtn(['x']), 0).length, 1);
  assert.equal(e.update(withBtn(['x', 'y']), 10).length, 0);
  assert.equal(e.update(withBtn(['y']), 20).length, 0);
  assert.deepEqual(e.update(idle(), 30), [{ t: 'key', vk: VK.Enter, down: false }]);
});

test('helper protocol: state line in, command lines out', () => {
  const s = parseStateLine('S 1 77 4097 255 0 32767 -32768 0 16384', PAD_BUTTONS);
  assert.equal(s.index, 1);
  assert.equal(s.buttons.a, true);
  assert.equal(s.buttons.up, true);
  assert.equal(s.buttons.b, false);
  assert.equal(s.lt, 1);
  assert.equal(s.lx, 1);
  assert.equal(s.ly, 1); // XInput down (-32768) = Gamepad API down (+1)
  assert.equal(s.ry < 0, true);
  assert.equal(parseStateLine('S 1 2 3', PAD_BUTTONS), null);
  assert.equal(parseStateLine('S a b c d e f g h i', PAD_BUTTONS), null);
  assert.equal(commandToLine({ t: 'move', dx: 9999, dy: -3.7 }), 'M 4000 -3');
  assert.equal(commandToLine({ t: 'mouse', button: 'back', down: true }), 'B X1 D');
  assert.equal(commandToLine({ t: 'key', vk: 13, down: false }), 'K 13 U');
  assert.equal(commandToLine({ t: 'rumble', l: 0.5, r: 2 }), 'V 32768 65535');
});

test('manager drives a helper process end to end and releases on stop', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cb-'));
  const rec = join(dir, 'commands.txt');
  const fake = fileURLToPath(new URL('../desktop/testing/fake-helper.mjs', import.meta.url));
  const m = new DesktopManager({
    configPath: join(dir, 'cfg.json'),
    helper: { cmd: process.execPath, args: [fake, rec], allowAnyPlatform: true },
    platform: 'linux',
  });
  await m.loadConfig();
  assert.equal(m.start().ok, true);
  await new Promise((r) => setTimeout(r, 250));
  const st = m.status();
  assert.equal(st.ready, true);
  assert.equal(st.connected, true);
  await m.saveConfig({ ...m.config, mouse: { ...m.config.mouse, speed: 500 } });
  assert.equal(JSON.parse(await readFile(join(dir, 'cfg.json'), 'utf8')).mouse.speed, 500);
  await m.stop();
  assert.equal(m.running, false);
  const lines = (await readFile(rec, 'utf8')).trim().split('\n');
  assert.equal(lines[0], 'P auto');
  assert.equal(lines[1], 'I 8');
  assert.ok(lines.some((l) => /^M [1-9]\d* 0$/.test(l)), 'pointer moved right');
  assert.ok(lines.includes('B L D') && lines.includes('B L U'), 'A clicked');
  assert.deepEqual(lines.slice(-2), ['R', 'Q']);
  await rm(dir, { recursive: true, force: true });
});

test('manager refuses to start off Windows with a clear message', () => {
  const m = new DesktopManager({ configPath: '/nonexistent/x.json', platform: 'linux' });
  const r = m.start();
  assert.equal(r.ok, false);
  assert.match(r.message, /Windows/);
});

test('API answers only this machine\'s page', async () => {
  const req = (h) => ({ headers: h });
  assert.equal(isLocalRequest(req({ host: '127.0.0.1:3100', 'x-controllerbench': '1' })), true);
  assert.equal(isLocalRequest(req({ host: 'localhost:3100', origin: 'http://localhost:3100', 'x-controllerbench': '1' })), true);
  assert.equal(isLocalRequest(req({ host: '127.0.0.1:3100' })), false); // no custom header
  assert.equal(isLocalRequest(req({ host: 'evil.example:3100', 'x-controllerbench': '1' })), false); // DNS rebinding
  assert.equal(isLocalRequest(req({ host: '127.0.0.1:3100', origin: 'https://evil.example', 'x-controllerbench': '1' })), false);
  assert.equal(isLocalRequest(req({ host: '192.168.1.5:3100', 'x-controllerbench': '1' })), false); // LAN

  const dir = await mkdtemp(join(tmpdir(), 'cb-'));
  const desktop = new DesktopManager({ configPath: join(dir, 'cfg.json'), platform: 'linux' });
  await desktop.loadConfig();
  const server = createServer({ desktop });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/desktop/`;
  const H = { 'X-ControllerBench': '1' };
  try {
    assert.equal((await fetch(base + 'status')).status, 403);
    const st = await (await fetch(base + 'status', { headers: H })).json();
    assert.equal(st.supported, false);
    const put = await fetch(base + 'config', { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ buttons: { a: 'key:Enter' } }) });
    assert.equal(put.status, 200);
    assert.equal((await put.json()).buttons.a, 'key:Enter');
    assert.equal((await fetch(base + 'start', { method: 'POST', headers: H })).status, 409);
    assert.equal((await fetch(base + 'config', { method: 'PUT', headers: H, body: '{bad' })).status, 400);
    assert.equal((await fetch(base + 'nope', { headers: H })).status, 404);
  } finally {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
