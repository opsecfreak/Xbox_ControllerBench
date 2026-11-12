// Xbox chatpad layout and key learning. No DOM.
//
// Letter, digit and the usual keys have a known KeyboardEvent.code.
// The special keys (+, -, X1, X2, green, orange, mic, the two icon keys)
// have no known code. The page "learns" them: the user clicks the key on
// screen, then presses it on the chatpad. A key that sends nothing to the
// browser can be marked "no event". Learned keys are saved in the browser.

const k = (id, label, code = null, w = 1, extra = {}) => ({ id, label, code, w, ...extra });

const letters = (s) => [...s].map((c) => k('key' + c, c, 'Key' + c));

export const CHATPAD_ROWS = [
  [...'1234567890'].map((d) => k('d' + d, d, 'Digit' + d)),
  letters('QWERTYUIOP'),
  [k('pad', 'Pad', null, 1.2, { special: true, hint: 'Controller icon key' }), ...letters('ASDFGHJKL'), k('comma', ',', 'Comma'), k('plus', '+', null, 1, { special: true, side: true })],
  [k('people', 'People', null, 1.2, { special: true, hint: 'People icon key' }), k('shift', 'Shift', 'ShiftLeft', 1.05), ...letters('ZXCVBNM'), k('period', '.', 'Period'), k('enter', 'Enter', 'Enter', 1.25), k('minus', '-', null, 1, { special: true, side: true })],
  [
    k('green', 'Green', null, 1.2, { special: true, tone: 'green' }), k('orange', 'Orange', null, 1.2, { special: true, tone: 'orange' }),
    k('x1', 'X1', null, 1, { special: true }), k('space', 'Space', 'Space', 4.1), k('x2', 'X2', null, 1, { special: true }),
    k('backspace', 'Back', 'Backspace', 1), k('mic', 'Mic', null, 1, { special: true }),
  ],
];

export const CHATPAD_KEYS = CHATPAD_ROWS.flat();

const MOD_CODES = {
  Shift: ['ShiftLeft', 'ShiftRight'],
  Ctrl: ['ControlLeft', 'ControlRight'],
  Alt: ['AltLeft', 'AltRight'],
  Win: ['MetaLeft', 'MetaRight'],
};

/**
 * Modifier string for an event, without the modifier the key itself is.
 * mods: {ctrl, shift, alt, meta} booleans.
 */
export function modString(code, mods) {
  const out = [];
  if (mods.ctrl && !MOD_CODES.Ctrl.includes(code)) out.push('Ctrl');
  if (mods.shift && !MOD_CODES.Shift.includes(code)) out.push('Shift');
  if (mods.alt && !MOD_CODES.Alt.includes(code)) out.push('Alt');
  if (mods.meta && !MOD_CODES.Win.includes(code)) out.push('Win');
  return out.join('+');
}

/** Default map: known codes for standard keys, nothing for special keys. */
export function defaultChatpadMap() {
  const keys = {};
  for (const key of CHATPAD_KEYS) if (key.code) keys[key.id] = { code: key.code, mods: '', learned: false };
  return { version: 1, keys };
}

/** Clean a stored map. Unknown key ids and bad entries are dropped. */
export function sanitizeChatpadMap(obj) {
  const out = defaultChatpadMap();
  const src = obj && typeof obj === 'object' && obj.keys && typeof obj.keys === 'object' ? obj.keys : {};
  const ids = new Set(CHATPAD_KEYS.map((x) => x.id));
  for (const [id, v] of Object.entries(src)) {
    if (!ids.has(id) || !v || typeof v !== 'object') continue;
    if (v.none === true) out.keys[id] = { none: true, learned: true };
    else if (typeof v.code === 'string' && v.code.length > 0 && v.code.length < 64) {
      out.keys[id] = { code: v.code, mods: typeof v.mods === 'string' ? v.mods.slice(0, 32) : '', learned: !!v.learned };
    }
  }
  return out;
}

/**
 * Find which chatpad key an event belongs to.
 * 1. Same code and same modifiers.
 * 2. Same code, key learned with no modifiers (for example Shift + letter).
 * Returns the key id or null.
 */
export function matchChatpadKey(map, code, mods) {
  let loose = null;
  for (const [id, v] of Object.entries(map.keys)) {
    if (v.none || v.code !== code) continue;
    if (v.mods === mods) return id;
    if (!v.mods && loose === null) loose = id;
  }
  return loose;
}

/**
 * Assign code + mods to keyId. Any other key with the same code + mods loses
 * its assignment (one physical key per signal). Returns the id that lost it, or null.
 */
export function learnChatpadKey(map, keyId, code, mods) {
  let cleared = null;
  for (const [id, v] of Object.entries(map.keys)) {
    if (id !== keyId && !v.none && v.code === code && v.mods === mods) {
      delete map.keys[id];
      cleared = id;
    }
  }
  map.keys[keyId] = { code, mods, learned: true };
  return cleared;
}

export function markNoEvent(map, keyId) {
  map.keys[keyId] = { none: true, learned: true };
}

export function chatpadProgress(map, tested) {
  const total = CHATPAD_KEYS.length;
  let none = 0;
  let unmapped = 0;
  for (const key of CHATPAD_KEYS) {
    const v = map.keys[key.id];
    if (!v) unmapped++;
    else if (v.none) none++;
  }
  const pressed = CHATPAD_KEYS.filter((x) => tested.has(x.id)).length;
  return { total, pressed, none, unmapped, done: pressed + none };
}
