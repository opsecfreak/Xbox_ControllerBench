import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyTracker, decodeAltCode } from '../public/js/lib/keytracker.js';
import { XINPUT_DEADZONE, driftVerdict } from '../public/js/lib/mapping.js';

test('decodeAltCode: ASCII, Windows-1252 and bad input', () => {
  assert.equal(decodeAltCode('64'), '@');
  assert.equal(decodeAltCode('064'), '@');
  assert.equal(decodeAltCode('0233'), 'é');
  assert.equal(decodeAltCode('0128'), '€');
  assert.equal(decodeAltCode('200'), null); // OEM code page, not decoded
  assert.equal(decodeAltCode('09'), null); // control character
  assert.equal(decodeAltCode('0999'), null);
  assert.equal(decodeAltCode('abc'), null);
});

test('Alt + numpad digits are an Alt code, not chatter', () => {
  // Same pattern as the v1 report: AltLeft + Numpad0 fired fast by the keyboard.
  const k = new KeyTracker({ chatterMs: 30 });
  k.down('AltLeft', 0);
  for (const [i, d] of ['0', '0', '6', '4'].entries()) {
    const t = 10 + i * 8;
    assert.equal(k.down('Numpad' + d, t).type, 'altcode-digit');
    k.up('Numpad' + d, t + 2);
  }
  const res = k.up('AltLeft', 60);
  assert.deepEqual({ digits: res.altCode.digits, char: res.altCode.char }, { digits: '0064', char: '@' });
  const s = k.summary();
  assert.equal(s.chatterEvents, 0);
  assert.equal(s.altCodes.length, 1);
});

test('numpad chatter without Alt is still caught', () => {
  const k = new KeyTracker({ chatterMs: 30 });
  k.down('Numpad2', 0);
  k.up('Numpad2', 50);
  assert.equal(k.down('Numpad2', 60).type, 'chatter');
});

test('Alt released with no digits makes no Alt code', () => {
  const k = new KeyTracker();
  k.down('AltLeft', 0);
  k.down('Tab', 5);
  k.up('Tab', 10);
  assert.equal(k.up('AltLeft', 20).altCode, undefined);
  assert.equal(k.summary().altCodes.length, 0);
});

test('drift verdict uses the user limit and the XInput default deadzone', () => {
  near(XINPUT_DEADZONE.left, 0.2395, 1e-4);
  near(XINPUT_DEADZONE.right, 0.2652, 1e-4);
  // v1 report: right stick rests at 0.0708 with a 0.05 limit.
  assert.equal(driftVerdict(0.0708, 0.05, XINPUT_DEADZONE.right).level, 'warn');
  assert.equal(driftVerdict(0.0061, 0.05, XINPUT_DEADZONE.left).level, 'ok');
  assert.equal(driftVerdict(0.3, 0.05, XINPUT_DEADZONE.right).level, 'bad');
});

function near(a, b, eps) {
  assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
}
