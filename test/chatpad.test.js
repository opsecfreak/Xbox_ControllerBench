import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHATPAD_KEYS, defaultChatpadMap, sanitizeChatpadMap, matchChatpadKey, learnChatpadKey,
  markNoEvent, chatpadProgress, modString,
} from '../public/js/lib/chatpad.js';

test('chatpad layout has every key from the photo, with unique ids', () => {
  const ids = CHATPAD_KEYS.map((k) => k.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 51);
  for (const id of ['plus', 'minus', 'x1', 'x2', 'green', 'orange', 'mic', 'pad', 'people', 'backspace', 'enter', 'space', 'shift', 'comma', 'period']) {
    assert.ok(ids.includes(id), id);
  }
  const special = CHATPAD_KEYS.filter((k) => k.special).map((k) => k.id).sort();
  assert.deepEqual(special, ['green', 'mic', 'minus', 'orange', 'pad', 'people', 'plus', 'x1', 'x2']);
});

test('modString drops the modifier the key itself is', () => {
  assert.equal(modString('ShiftLeft', { shift: true }), '');
  assert.equal(modString('F23', { shift: true, meta: true }), 'Shift+Win');
  assert.equal(modString('KeyA', { ctrl: true, alt: true }), 'Ctrl+Alt');
});

test('default map knows standard keys, not special keys', () => {
  const m = defaultChatpadMap();
  assert.equal(matchChatpadKey(m, 'KeyQ', ''), 'keyQ');
  assert.equal(matchChatpadKey(m, 'KeyQ', 'Shift'), 'keyQ'); // capital letter still counts
  assert.equal(matchChatpadKey(m, 'F23', 'Shift+Win'), null);
  assert.equal(chatpadProgress(m, new Set()).unmapped, 9);
});

test('learning a key, exact match beats loose match, duplicates move', () => {
  const m = defaultChatpadMap();
  learnChatpadKey(m, 'x1', 'F23', 'Shift+Win');
  learnChatpadKey(m, 'x2', 'F24', '');
  assert.equal(matchChatpadKey(m, 'F23', 'Shift+Win'), 'x1');
  assert.equal(matchChatpadKey(m, 'F24', ''), 'x2');
  learnChatpadKey(m, 'plus', 'F23', '');
  assert.equal(matchChatpadKey(m, 'F23', ''), 'plus');
  assert.equal(matchChatpadKey(m, 'F23', 'Shift+Win'), 'x1');
  const cleared = learnChatpadKey(m, 'minus', 'F24', '');
  assert.equal(cleared, 'x2');
  assert.equal(m.keys.x2, undefined);
});

test('no event keys count as checked; progress adds up', () => {
  const m = defaultChatpadMap();
  markNoEvent(m, 'mic');
  markNoEvent(m, 'green');
  const p = chatpadProgress(m, new Set(['keyA', 'space']));
  assert.deepEqual(p, { total: 51, pressed: 2, none: 2, unmapped: 7, done: 4 });
  assert.equal(matchChatpadKey(m, 'anything', ''), null);
});

test('sanitizeChatpadMap keeps good entries and drops bad ones', () => {
  const m = sanitizeChatpadMap({ keys: { x1: { code: 'F23', mods: 'Shift+Win', learned: true }, mic: { none: true }, bogus: { code: 'F1' }, x2: { code: '' }, plus: 'x' } });
  assert.equal(m.keys.x1.code, 'F23');
  assert.equal(m.keys.mic.none, true);
  assert.equal(m.keys.bogus, undefined);
  assert.equal(m.keys.x2, undefined);
  assert.equal(m.keys.plus, undefined);
  assert.equal(m.keys.keyA.code, 'KeyA');
  assert.deepEqual(sanitizeChatpadMap(null), defaultChatpadMap());
});
