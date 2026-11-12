// Desktop mode settings: defaults, validation and the action parser.
// Pure module. Used by the Node manager, the server and the tests.

/** Windows virtual-key codes by name. https://learn.microsoft.com/windows/win32/inputdev/virtual-key-codes */
export const VK = {
  Backspace: 0x08, Tab: 0x09, Enter: 0x0d, Pause: 0x13, CapsLock: 0x14, Escape: 0x1b, Space: 0x20,
  PageUp: 0x21, PageDown: 0x22, End: 0x23, Home: 0x24, Left: 0x25, Up: 0x26, Right: 0x27, Down: 0x28,
  PrintScreen: 0x2c, Insert: 0x2d, Delete: 0x2e,
  Win: 0x5b, Apps: 0x5d,
  Shift: 0xa0, Ctrl: 0xa2, Alt: 0xa4,
  BrowserBack: 0xa6, BrowserForward: 0xa7, BrowserRefresh: 0xa8, BrowserHome: 0xac,
  VolumeMute: 0xad, VolumeDown: 0xae, VolumeUp: 0xaf,
  MediaNext: 0xb0, MediaPrev: 0xb1, MediaStop: 0xb2, MediaPlayPause: 0xb3,
};
for (let i = 0; i < 26; i++) VK[String.fromCharCode(65 + i)] = 0x41 + i;
for (let i = 0; i < 10; i++) VK[String(i)] = 0x30 + i;
for (let i = 1; i <= 24; i++) VK['F' + i] = 0x6f + i;

const VK_LOWER = Object.fromEntries(Object.entries(VK).map(([k, v]) => [k.toLowerCase(), v]));
const ALIASES = { esc: 'escape', return: 'enter', control: 'ctrl', windows: 'win', meta: 'win', del: 'delete', ins: 'insert', pgup: 'pageup', pgdn: 'pagedown', menu: 'apps' };

export const MOUSE_BUTTONS = ['left', 'right', 'middle', 'back', 'forward'];

/** Controller buttons that can be mapped, with their XInput bit. */
export const PAD_BUTTONS = {
  up: 0x0001, down: 0x0002, left: 0x0004, right: 0x0008,
  menu: 0x0010, view: 0x0020, ls: 0x0040, rs: 0x0080,
  lb: 0x0100, rb: 0x0200, a: 0x1000, b: 0x2000, x: 0x4000, y: 0x8000,
};
export const ALL_INPUTS = [...Object.keys(PAD_BUTTONS), 'lt', 'rt'];

/**
 * Parse an action string.
 *   none | precision | mouse:left|right|middle|back|forward | key:Ctrl+Shift+T
 * Returns an action object or null when the string is not valid.
 */
export function parseAction(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim();
  if (s === '' || s === 'none') return { type: 'none' };
  if (s === 'precision') return { type: 'precision' };
  const colon = s.indexOf(':');
  if (colon < 1) return null;
  const kind = s.slice(0, colon);
  const rest = s.slice(colon + 1).trim();
  if (kind === 'mouse') return MOUSE_BUTTONS.includes(rest) ? { type: 'mouse', button: rest } : null;
  if (kind === 'key') {
    const parts = rest.split('+').map((p) => p.trim()).filter(Boolean);
    if (!parts.length || parts.length > 4) return null;
    const vks = [];
    for (const p of parts) {
      const name = ALIASES[p.toLowerCase()] || p.toLowerCase();
      const vk = VK_LOWER[name];
      if (vk === undefined) return null;
      vks.push(vk);
    }
    return { type: 'key', vks };
  }
  return null;
}

export function defaultConfig() {
  return {
    version: 1,
    startEnabled: true,
    player: 'auto', // 'auto' or 0..3
    pollMs: 8,
    toggle: { holdMs: 1000, rumble: true }, // hold View + Menu to turn desktop mode on or off
    triggerThreshold: 0.12,
    mouse: { speed: 1400, curve: 2, deadzone: 0.18, cx: 0, cy: 0, precisionFactor: 0.3, invertY: false },
    scroll: { speed: 12, deadzone: 0.2, invertY: false, horizontal: true },
    repeat: { delayMs: 400, rateMs: 60, buttons: ['up', 'down', 'left', 'right'] },
    buttons: {
      a: 'mouse:left', b: 'mouse:right', x: 'key:Enter', y: 'key:Escape',
      lb: 'key:BrowserBack', rb: 'key:BrowserForward', lt: 'precision', rt: 'none',
      view: 'key:Win+Tab', menu: 'key:Win', ls: 'mouse:middle', rs: 'none',
      up: 'key:Up', down: 'key:Down', left: 'key:Left', right: 'key:Right',
    },
  };
}

function num(v, lo, hi, d) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
}

/** Return a clean config. Bad or missing values fall back to defaults. */
export function sanitizeConfig(obj) {
  const d = defaultConfig();
  const o = obj && typeof obj === 'object' ? obj : {};
  const m = o.mouse || {};
  const sc = o.scroll || {};
  const t = o.toggle || {};
  const r = o.repeat || {};
  const buttons = {};
  for (const name of ALL_INPUTS) {
    const v = o.buttons?.[name];
    buttons[name] = typeof v === 'string' && parseAction(v) ? v.trim() : d.buttons[name];
  }
  const player = o.player === 'auto' || o.player === undefined ? 'auto' : num(o.player, 0, 3, 'auto');
  return {
    version: 1,
    startEnabled: o.startEnabled === undefined ? d.startEnabled : !!o.startEnabled,
    player: Number.isInteger(player) ? player : 'auto',
    pollMs: Math.round(num(o.pollMs, 4, 50, d.pollMs)),
    toggle: { holdMs: Math.round(num(t.holdMs, 300, 5000, d.toggle.holdMs)), rumble: t.rumble === undefined ? d.toggle.rumble : !!t.rumble },
    triggerThreshold: num(o.triggerThreshold, 0.02, 0.9, d.triggerThreshold),
    mouse: {
      speed: num(m.speed, 50, 6000, d.mouse.speed),
      curve: num(m.curve, 1, 4, d.mouse.curve),
      deadzone: num(m.deadzone, 0, 0.6, d.mouse.deadzone),
      cx: num(m.cx, -0.5, 0.5, 0),
      cy: num(m.cy, -0.5, 0.5, 0),
      precisionFactor: num(m.precisionFactor, 0.05, 1, d.mouse.precisionFactor),
      invertY: !!m.invertY,
    },
    scroll: {
      speed: num(sc.speed, 1, 60, d.scroll.speed),
      deadzone: num(sc.deadzone, 0, 0.6, d.scroll.deadzone),
      invertY: !!sc.invertY,
      horizontal: sc.horizontal === undefined ? d.scroll.horizontal : !!sc.horizontal,
    },
    repeat: {
      delayMs: Math.round(num(r.delayMs, 100, 2000, d.repeat.delayMs)),
      rateMs: Math.round(num(r.rateMs, 20, 1000, d.repeat.rateMs)),
      buttons: Array.isArray(r.buttons) ? r.buttons.filter((b) => ALL_INPUTS.includes(b)) : d.repeat.buttons,
    },
    buttons,
  };
}
