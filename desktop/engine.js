// Desktop mode engine: turns controller state into mouse and keyboard
// commands. Pure logic, no I/O. The manager feeds it state from the Windows
// helper and sends the commands it returns back to the helper.
//
// State in:  {connected, buttons: {a: bool, ...}, lt, rt (0..1),
//             lx, ly, rx, ry (-1..1, y down positive like the Gamepad API)}
// Commands out:
//   {t: 'move', dx, dy}           relative mouse move in pixels
//   {t: 'wheel', v} / {t: 'hwheel', h}   wheel units (120 = one notch)
//   {t: 'mouse', button, down}
//   {t: 'key', vk, down}
//   {t: 'rumble', l, r, ms}       short feedback pulse (0..1)

import { ALL_INPUTS, parseAction, sanitizeConfig } from './config.js';

const WHEEL_DELTA = 120;
const TOGGLE_COMBO = ['view', 'menu'];

export class Engine {
  constructor(config) {
    this.held = new Map(); // output id -> count. ids: 'm:left', 'k:13'
    this.prev = {};
    this.last = null;
    this.acc = { x: 0, y: 0, v: 0, h: 0 };
    this.combo = { start: null, fired: false, used: new Set() };
    this.repeatAt = new Map(); // input -> next repeat time
    this.setConfig(config);
    this.enabled = this.config.startEnabled;
  }

  /** Change settings. Releases everything held first. */
  setConfig(config) {
    const out = this.held && this.held.size ? this.releaseAll() : [];
    this.config = sanitizeConfig(config);
    this.actions = {};
    for (const name of ALL_INPUTS) this.actions[name] = parseAction(this.config.buttons[name]) || { type: 'none' };
    this.repeatSet = new Set(this.config.repeat.buttons);
    return out;
  }

  /** Release every held mouse button and key. */
  releaseAll() {
    const out = [];
    for (const id of [...this.held.keys()].reverse()) out.push(this.upCmd(id));
    this.held.clear();
    this.repeatAt.clear();
    return out;
  }

  upCmd(id) {
    return id.startsWith('m:') ? { t: 'mouse', button: id.slice(2), down: false } : { t: 'key', vk: Number(id.slice(2)), down: false };
  }

  press(id, out) {
    const n = this.held.get(id) || 0;
    this.held.set(id, n + 1);
    if (n === 0) out.push(id.startsWith('m:') ? { t: 'mouse', button: id.slice(2), down: true } : { t: 'key', vk: Number(id.slice(2)), down: true });
  }

  release(id, out) {
    const n = this.held.get(id) || 0;
    if (n <= 1) {
      if (n === 1) out.push(this.upCmd(id));
      this.held.delete(id);
    } else this.held.set(id, n - 1);
  }

  actionDown(action, out) {
    if (action.type === 'mouse') this.press('m:' + action.button, out);
    else if (action.type === 'key') for (const vk of action.vks) this.press('k:' + vk, out);
  }

  actionUp(action, out) {
    if (action.type === 'mouse') this.release('m:' + action.button, out);
    else if (action.type === 'key') for (const vk of [...action.vks].reverse()) this.release('k:' + vk, out);
  }

  pressedNow(state) {
    const p = {};
    for (const name of ALL_INPUTS) {
      if (name === 'lt' || name === 'rt') p[name] = (state[name] || 0) > this.config.triggerThreshold;
      else p[name] = !!state.buttons?.[name];
    }
    return p;
  }

  /** Radial deadzone and response curve. Returns {x, y} scaled 0..1 in magnitude. */
  shape(x, y, deadzone, curve) {
    const r = Math.hypot(x, y);
    if (r <= deadzone || r === 0) return { x: 0, y: 0 };
    const n = Math.min(1, (r - deadzone) / Math.max(1e-6, 1 - deadzone));
    const mag = n ** curve;
    return { x: (x / r) * mag, y: (y / r) * mag };
  }

  update(state, now) {
    const out = [];
    const dt = this.last === null ? 0 : Math.min(100, Math.max(0, now - this.last));
    this.last = now;

    if (!state || !state.connected) {
      out.push(...this.releaseAll());
      this.prev = {};
      this.combo = { start: null, fired: false, used: new Set() };
      return out;
    }

    const p = this.pressedNow(state);

    // Toggle: hold View + Menu.
    const comboHeld = TOGGLE_COMBO.every((b) => p[b]);
    if (comboHeld) {
      for (const b of TOGGLE_COMBO) this.combo.used.add(b);
      if (this.combo.start === null) this.combo.start = now;
      if (!this.combo.fired && now - this.combo.start >= this.config.toggle.holdMs) {
        this.combo.fired = true;
        this.enabled = !this.enabled;
        out.push(...this.releaseAll());
        if (this.config.toggle.rumble) out.push(this.enabled ? { t: 'rumble', l: 0, r: 0.6, ms: 120 } : { t: 'rumble', l: 0.6, r: 0, ms: 250 });
      }
    } else {
      this.combo.start = null;
      this.combo.fired = false;
    }

    if (this.enabled) {
      this.pointer(state, p, dt, out);
      this.wheel(state, dt, out);
      this.buttons(p, now, out);
    }

    // Combo buttons: forget the combo once both are up.
    if (!TOGGLE_COMBO.some((b) => p[b])) this.combo.used.clear();
    this.prev = p;
    return out;
  }

  pointer(state, p, dt, out) {
    const m = this.config.mouse;
    let { x, y } = this.shape((state.lx || 0) - m.cx, (state.ly || 0) - m.cy, m.deadzone, m.curve);
    if (m.invertY) y = -y;
    let speed = m.speed;
    for (const name of ALL_INPUTS) if (p[name] && this.actions[name].type === 'precision') speed *= m.precisionFactor;
    this.acc.x += (x * speed * dt) / 1000;
    this.acc.y += (y * speed * dt) / 1000;
    if (x === 0) this.acc.x = 0;
    if (y === 0) this.acc.y = 0;
    const dx = Math.trunc(this.acc.x);
    const dy = Math.trunc(this.acc.y);
    if (dx || dy) {
      this.acc.x -= dx;
      this.acc.y -= dy;
      out.push({ t: 'move', dx, dy });
    }
  }

  wheel(state, dt, out) {
    const s = this.config.scroll;
    const { x, y } = this.shape(state.rx || 0, state.ry || 0, s.deadzone, 1.5);
    // Stick up (y negative) scrolls up (positive wheel).
    const vy = (s.invertY ? y : -y) * s.speed * WHEEL_DELTA;
    const vx = s.horizontal ? x * s.speed * WHEEL_DELTA : 0;
    this.acc.v = y === 0 ? 0 : this.acc.v + (vy * dt) / 1000;
    this.acc.h = vx === 0 ? 0 : this.acc.h + (vx * dt) / 1000;
    const v = Math.trunc(this.acc.v);
    const h = Math.trunc(this.acc.h);
    if (v) { this.acc.v -= v; out.push({ t: 'wheel', v }); }
    if (h) { this.acc.h -= h; out.push({ t: 'hwheel', h }); }
  }

  buttons(p, now, out) {
    for (const name of ALL_INPUTS) {
      const action = this.actions[name];
      if (action.type === 'none' || action.type === 'precision') continue;
      const was = !!this.prev[name];
      const is = p[name];
      const isCombo = TOGGLE_COMBO.includes(name);
      if (isCombo) {
        // View and Menu fire on release (tap), and not at all if they were
        // part of the toggle combo. This keeps the toggle from opening Start.
        if (was && !is) {
          const other = TOGGLE_COMBO.find((b) => b !== name);
          const comboUsed = this.combo.used.has(name) && this.combo.used.has(other);
          if (!comboUsed) {
            this.actionDown(action, out);
            this.actionUp(action, out);
          }
        }
        continue;
      }
      if (is && !was) {
        this.actionDown(action, out);
        if (action.type === 'key' && this.repeatSet.has(name)) this.repeatAt.set(name, now + this.config.repeat.delayMs);
      } else if (!is && was) {
        this.actionUp(action, out);
        this.repeatAt.delete(name);
      } else if (is && this.repeatAt.has(name) && now >= this.repeatAt.get(name)) {
        // Injected keys do not auto-repeat. Send the main key down again, like a keyboard does.
        out.push({ t: 'key', vk: action.vks[action.vks.length - 1], down: true });
        this.repeatAt.set(name, now + this.config.repeat.rateMs);
      }
    }
  }
}

/** Convert one helper state line ("S idx packet buttons lt rt lx ly rx ry") into engine state. */
export function parseStateLine(line, PAD_BUTTONS) {
  const f = line.trim().split(/\s+/);
  if (f[0] !== 'S' || f.length !== 10) return null;
  const n = f.slice(1).map(Number);
  if (n.some((v) => !Number.isFinite(v))) return null;
  const [index, packet, bits, lt, rt, lx, ly, rx, ry] = n;
  const axis = (v) => Math.max(-1, Math.min(1, v / 32767));
  const buttons = {};
  for (const [name, bit] of Object.entries(PAD_BUTTONS)) buttons[name] = (bits & bit) !== 0;
  return {
    connected: true, index, packet, buttons,
    lt: lt / 255, rt: rt / 255,
    // XInput Y is up positive. The engine uses the Gamepad API convention (down positive).
    lx: axis(lx), ly: -axis(ly), rx: axis(rx), ry: -axis(ry),
  };
}

/** Convert engine commands into helper protocol lines. */
export function commandToLine(c) {
  const clampInt = (v, lim) => Math.max(-lim, Math.min(lim, Math.trunc(v)));
  switch (c.t) {
    case 'move': return `M ${clampInt(c.dx, 4000)} ${clampInt(c.dy, 4000)}`;
    case 'wheel': return `W ${clampInt(c.v, 1200)}`;
    case 'hwheel': return `H ${clampInt(c.h, 1200)}`;
    case 'mouse': return `B ${{ left: 'L', right: 'R', middle: 'M', back: 'X1', forward: 'X2' }[c.button]} ${c.down ? 'D' : 'U'}`;
    case 'key': return `K ${c.vk & 0xff} ${c.down ? 'D' : 'U'}`;
    case 'rumble': return `V ${Math.round(Math.min(1, Math.max(0, c.l)) * 65535)} ${Math.round(Math.min(1, Math.max(0, c.r)) * 65535)}`;
    default: return null;
  }
}
