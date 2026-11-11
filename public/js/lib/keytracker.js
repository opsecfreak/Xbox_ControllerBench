// Keyboard test logic: rollover, stuck keys, key chatter and Alt codes. No DOM.

const ALT = new Set(['AltLeft', 'AltRight']);
const NUMPAD_DIGIT = /^Numpad([0-9])$/;

/**
 * Decode a Windows Alt code (digits typed on the numpad while Alt is held).
 * Leading 0 = Windows-1252 code page. No leading 0 = OEM code page; only the
 * printable ASCII part (32-126) is decoded here, other values return null.
 */
export function decodeAltCode(digits) {
  if (!/^[0-9]{1,4}$/.test(digits)) return null;
  const n = Number(digits);
  if (digits.startsWith('0')) {
    if (n > 255) return null;
    if (n < 32 || n === 127) return null; // control characters
    if (typeof TextDecoder !== 'undefined') {
      try {
        const ch = new TextDecoder('windows-1252').decode(new Uint8Array([n]));
        return ch === '�' ? null : ch;
      } catch {
        /* decoder not available */
      }
    }
    return n < 127 ? String.fromCharCode(n) : null;
  }
  return n >= 32 && n <= 126 ? String.fromCharCode(n) : null;
}

/**
 * Chatter = the same key goes down again very soon after it went up.
 * A worn or dirty switch can send two presses for one. The threshold is
 * user-set in the page. Auto-repeat events (holding a key) are ignored.
 *
 * Numpad digits pressed while Alt is held are an Alt code (some keyboards
 * and chatpads type symbols this way, very fast). They are not counted as
 * chatter.
 */
export class KeyTracker {
  constructor({ chatterMs = 30 } = {}) {
    this.chatterMs = chatterMs;
    this.reset();
  }

  reset() {
    this.held = new Map(); // code -> down time
    this.lastUp = new Map(); // code -> up time
    this.counts = new Map(); // code -> press count
    this.tested = new Set();
    this.chatter = []; // {code, gapMs, t}
    this.maxRollover = 0;
    this.maxRolloverKeys = [];
    this.missingUp = 0; // keydown seen while already held, without repeat flag
    this.altDigits = '';
    this.altCodes = []; // {digits, char, t}
  }

  altHeld() {
    for (const c of ALT) if (this.held.has(c)) return true;
    return false;
  }

  down(code, t, repeat = false) {
    if (repeat) return { type: 'repeat' };
    if (this.held.has(code)) {
      this.missingUp++;
      return { type: 'double-down' };
    }
    let result = { type: 'down' };
    const digit = NUMPAD_DIGIT.exec(code);
    if (digit && this.altHeld()) {
      this.altDigits += digit[1];
      result = { type: 'altcode-digit', digits: this.altDigits };
    } else {
      const up = this.lastUp.get(code);
      if (up !== undefined) {
        const gap = t - up;
        if (gap >= 0 && gap < this.chatterMs) {
          this.chatter.push({ code, gapMs: gap, t });
          result = { type: 'chatter', gapMs: gap };
        }
      }
    }
    if (ALT.has(code) && !this.altHeld()) this.altDigits = '';
    this.held.set(code, t);
    this.tested.add(code);
    this.counts.set(code, (this.counts.get(code) || 0) + 1);
    if (this.held.size > this.maxRollover) {
      this.maxRollover = this.held.size;
      this.maxRolloverKeys = [...this.held.keys()];
    }
    return result;
  }

  up(code, t) {
    const downAt = this.held.get(code);
    this.held.delete(code);
    this.lastUp.set(code, t);
    const res = { type: 'up', heldMs: downAt === undefined ? null : t - downAt };
    if (ALT.has(code) && !this.altHeld() && this.altDigits) {
      const entry = { digits: this.altDigits, char: decodeAltCode(this.altDigits), t };
      this.altCodes.push(entry);
      this.altDigits = '';
      res.altCode = entry;
    }
    return res;
  }

  /** Window lost focus: the browser will not send keyup for held keys. */
  releaseAll(t) {
    for (const code of [...this.held.keys()]) this.up(code, t);
    this.altDigits = '';
  }

  summary() {
    return {
      keysTested: this.tested.size,
      maxRollover: this.maxRollover,
      maxRolloverKeys: this.maxRolloverKeys,
      chatterEvents: this.chatter.length,
      chatterKeys: [...new Set(this.chatter.map((c) => c.code))],
      chatterMs: this.chatterMs,
      doubleDowns: this.missingUp,
      altCodes: this.altCodes.map((a) => ({ digits: a.digits, char: a.char })),
      counts: Object.fromEntries(this.counts),
    };
  }
}
