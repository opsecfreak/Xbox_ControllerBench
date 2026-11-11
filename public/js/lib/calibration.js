// Software calibration. These values only change how this page reads the
// controller. Nothing is sent to the controller and nothing is written to
// firmware. Values are stored in the browser (localStorage) per controller id.

export const LIMITS = {
  center: 0.5, // max allowed center offset on each axis
  innerMax: 0.5,
  outerMin: 0.5,
  outerMax: 1,
};

export function defaultStick() {
  return { cx: 0, cy: 0, inner: 0, outer: 1 };
}

export function defaultTrigger() {
  return { min: 0, max: 1 };
}

export function defaultCalibration() {
  return {
    version: 1,
    left: defaultStick(),
    right: defaultStick(),
    lt: defaultTrigger(),
    rt: defaultTrigger(),
  };
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function sanitizeStick(s) {
  const d = defaultStick();
  s = s && typeof s === 'object' ? s : {};
  const out = {
    cx: clamp(num(s.cx, d.cx), -LIMITS.center, LIMITS.center),
    cy: clamp(num(s.cy, d.cy), -LIMITS.center, LIMITS.center),
    inner: clamp(num(s.inner, d.inner), 0, LIMITS.innerMax),
    outer: clamp(num(s.outer, d.outer), LIMITS.outerMin, LIMITS.outerMax),
  };
  if (out.outer - out.inner < 0.1) out.inner = Math.max(0, out.outer - 0.1);
  return out;
}

function sanitizeTrigger(t) {
  const d = defaultTrigger();
  t = t && typeof t === 'object' ? t : {};
  const out = {
    min: clamp(num(t.min, d.min), 0, 0.5),
    max: clamp(num(t.max, d.max), 0.5, 1),
  };
  return out;
}

/** Returns a clean calibration object. Unknown or bad values fall back to defaults. */
export function sanitizeCalibration(obj) {
  obj = obj && typeof obj === 'object' ? obj : {};
  return {
    version: 1,
    left: sanitizeStick(obj.left),
    right: sanitizeStick(obj.right),
    lt: sanitizeTrigger(obj.lt),
    rt: sanitizeTrigger(obj.rt),
  };
}

/**
 * Apply center offset, inner (radial) deadzone and outer deadzone to a stick.
 * Output stays inside the unit circle.
 */
export function applyStick(x, y, cal) {
  const dx = x - cal.cx;
  const dy = y - cal.cy;
  const r = Math.hypot(dx, dy);
  if (r <= cal.inner || r === 0) return { x: 0, y: 0 };
  const span = Math.max(1e-6, cal.outer - cal.inner);
  const scaled = Math.min(1, (r - cal.inner) / span);
  return { x: (dx / r) * scaled, y: (dy / r) * scaled };
}

export function applyTrigger(v, cal) {
  const span = Math.max(1e-6, cal.max - cal.min);
  return clamp((v - cal.min) / span, 0, 1);
}

function ceilTo(v, step) {
  return Math.ceil(v / step) * step;
}

/**
 * Suggest a stick calibration from a drift test and/or a range test.
 * Fields with no test result keep their value from `base`.
 * This is a heuristic starting point, not a manufacturer value. Edit as needed.
 * - center = mean resting position
 * - inner  = largest resting wobble around that center + 0.02 margin
 * - outer  = smallest edge radius reached in the range test (so every
 *            direction can reach full output)
 */
export function suggestStick(drift, range, base = defaultStick()) {
  const s = { ...defaultStick(), ...base };
  if (drift && drift.count > 0) {
    s.cx = drift.meanX;
    s.cy = drift.meanY;
    s.inner = ceilTo(drift.maxResidual + 0.02, 0.01);
  }
  if (range && range.coverage >= 0.9) {
    s.outer = Math.floor(range.minR * 100) / 100;
  }
  return sanitizeStick(s);
}

/** Suggest trigger limits from the lowest resting value and highest pressed value seen. */
export function suggestTrigger(restMax, pressMax) {
  return sanitizeTrigger({
    min: ceilTo(Math.max(0, restMax) + 0.01, 0.01),
    max: Math.floor(Math.min(1, pressMax) * 100) / 100,
  });
}

export function storageKey(gamepadId) {
  return 'controllerbench.cal.' + String(gamepadId || 'unknown');
}

export function loadCalibration(storage, gamepadId) {
  try {
    const raw = storage.getItem(storageKey(gamepadId));
    return raw ? sanitizeCalibration(JSON.parse(raw)) : defaultCalibration();
  } catch {
    return defaultCalibration();
  }
}

export function saveCalibration(storage, gamepadId, cal) {
  try {
    storage.setItem(storageKey(gamepadId), JSON.stringify(sanitizeCalibration(cal)));
    return true;
  } catch {
    return false;
  }
}
