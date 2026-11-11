import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driftStats, RangeRecorder, RateMeter, mean, stddev } from '../public/js/lib/stats.js';
import {
  applyStick, applyTrigger, defaultCalibration, sanitizeCalibration, suggestStick, suggestTrigger,
  loadCalibration, saveCalibration,
} from '../public/js/lib/calibration.js';
import { KeyTracker } from '../public/js/lib/keytracker.js';
import { checkGamepad, BUTTONS, REQUIRED_BUTTONS } from '../public/js/lib/mapping.js';
import { allCodes } from '../public/js/lib/layout.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('mean and stddev', () => {
  assert.equal(mean([]), 0);
  near(mean([1, 2, 3]), 2);
  near(stddev([2, 4, 4, 4, 5, 5, 7, 9]), 2.138089935299395);
  assert.equal(stddev([5]), 0);
});

test('driftStats finds the rest offset and wobble', () => {
  const s = [{ x: 0.1, y: -0.05 }, { x: 0.12, y: -0.05 }, { x: 0.08, y: -0.05 }];
  const d = driftStats(s);
  near(d.meanX, 0.1);
  near(d.meanY, -0.05);
  near(d.offset, Math.hypot(0.1, 0.05));
  near(d.maxResidual, 0.02, 1e-12);
  assert.equal(d.count, 3);
});

test('RangeRecorder: full circle gives full coverage and zero error', () => {
  const r = new RangeRecorder(36);
  for (let i = 0; i < 720; i++) {
    const a = (i / 720) * Math.PI * 2;
    r.add(Math.cos(a), Math.sin(a));
  }
  const res = r.result();
  assert.equal(res.coverage, 1);
  near(res.minR, 1, 1e-9);
  near(res.circularityError, 0, 1e-9);
});

test('RangeRecorder ignores center samples and reports a short edge', () => {
  const r = new RangeRecorder(4);
  r.add(0.1, 0); // ignored
  assert.equal(r.result().coverage, 0);
  r.add(0.8, 0.01);
  const res = r.result();
  assert.equal(res.coverage, 0.25);
  near(res.minR, Math.hypot(0.8, 0.01));
});

test('RateMeter counts timestamp changes per window', () => {
  const m = new RateMeter(1000);
  for (let t = 0; t <= 1000; t += 4) m.update(t % 8 === 0 ? t : t - 4, t); // changes every 8 ms
  assert.ok(m.rate() > 100 && m.rate() < 140, String(m.rate()));
});

test('applyStick: deadzone, center offset, scaling', () => {
  const cal = { cx: 0.1, cy: 0, inner: 0.1, outer: 0.9 };
  assert.deepEqual(applyStick(0.15, 0, cal), { x: 0, y: 0 });
  const full = applyStick(1.0, 0, cal);
  near(full.x, 1);
  const half = applyStick(0.1 + 0.5, 0, cal);
  near(half.x, 0.5);
  const diag = applyStick(1, 1, { cx: 0, cy: 0, inner: 0, outer: 1 });
  near(Math.hypot(diag.x, diag.y), 1);
});

test('applyTrigger maps min..max to 0..1 and clamps', () => {
  const c = { min: 0.1, max: 0.9 };
  assert.equal(applyTrigger(0.05, c), 0);
  near(applyTrigger(0.5, c), 0.5);
  assert.equal(applyTrigger(1, c), 1);
});

test('sanitizeCalibration clamps bad input and falls back to defaults', () => {
  assert.deepEqual(sanitizeCalibration(null), defaultCalibration());
  const c = sanitizeCalibration({ left: { cx: 9, cy: 'x', inner: 0.9, outer: 2 }, lt: { min: -1, max: 0 } });
  assert.equal(c.left.cx, 0.5);
  assert.equal(c.left.cy, 0);
  assert.equal(c.left.outer, 1);
  assert.equal(c.left.inner, 0.5);
  assert.deepEqual(c.lt, { min: 0, max: 0.5 });
  const tight = sanitizeCalibration({ left: { inner: 0.5, outer: 0.55 } });
  assert.ok(tight.left.outer - tight.left.inner >= 0.1 - 1e-9);
});

test('suggestStick uses drift and range, keeps base for missing results', () => {
  const drift = { count: 100, meanX: 0.03, meanY: -0.02, maxResidual: 0.01 };
  const range = { coverage: 1, minR: 0.934 };
  const s = suggestStick(drift, range);
  near(s.cx, 0.03);
  near(s.cy, -0.02);
  near(s.inner, 0.03, 1e-9);
  near(s.outer, 0.93, 1e-9);
  const base = { cx: 0.01, cy: 0.02, inner: 0.07, outer: 0.95 };
  assert.deepEqual(suggestStick(null, { coverage: 0.5, minR: 0.6 }, base), base);
});

test('suggestTrigger', () => {
  const t = suggestTrigger(0.0, 0.997);
  near(t.min, 0.01, 1e-9);
  near(t.max, 0.99, 1e-9);
});

test('calibration save/load round trip and bad storage', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const cal = defaultCalibration();
  cal.left.inner = 0.08;
  assert.equal(saveCalibration(storage, 'pad', cal), true);
  assert.equal(loadCalibration(storage, 'pad').left.inner, 0.08);
  assert.deepEqual(loadCalibration(storage, 'other'), defaultCalibration());
  const broken = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); } };
  assert.deepEqual(loadCalibration(broken, 'pad'), defaultCalibration());
  assert.equal(saveCalibration(broken, 'pad', cal), false);
});

test('KeyTracker: rollover, chatter, repeat and double-down', () => {
  const k = new KeyTracker({ chatterMs: 30 });
  k.down('KeyW', 0); k.down('KeyA', 1); k.down('ShiftLeft', 2);
  assert.equal(k.maxRollover, 3);
  assert.equal(k.down('KeyW', 50, true).type, 'repeat');
  k.up('KeyW', 100);
  assert.equal(k.down('KeyW', 110).type, 'chatter');
  k.up('KeyW', 120);
  assert.equal(k.down('KeyW', 400).type, 'down');
  assert.equal(k.down('KeyW', 410).type, 'double-down');
  const s = k.summary();
  assert.equal(s.chatterEvents, 1);
  assert.deepEqual(s.chatterKeys, ['KeyW']);
  assert.equal(s.doubleDowns, 1);
  assert.equal(s.counts.KeyW, 3);
  k.releaseAll(500);
  assert.equal(k.held.size, 0);
});

test('checkGamepad warns on non-standard mapping only when needed', () => {
  const good = { id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', mapping: 'standard', axes: [0, 0, 0, 0], buttons: new Array(17).fill({}) };
  assert.deepEqual(checkGamepad(good), []);
  const bad = { id: 'Generic', mapping: '', axes: [0, 0], buttons: new Array(10).fill({}) };
  assert.equal(checkGamepad(bad).length, 4);
});

test('mapping and layout tables are consistent', () => {
  assert.equal(BUTTONS.length, 17);
  assert.equal(REQUIRED_BUTTONS.length, 16);
  assert.deepEqual(BUTTONS.map((b) => b.i), [...Array(17).keys()]);
  const codes = allCodes();
  assert.ok(codes.has('KeyA') && codes.has('NumpadEnter') && codes.has('ArrowUp'));
  assert.ok(codes.size >= 104, String(codes.size));
});
