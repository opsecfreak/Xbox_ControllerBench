// Keyboard test logic: rollover, stuck keys and key chatter. No DOM.

/**
 * Chatter = the same key goes down again very soon after it went up.
 * A worn or dirty switch can send two presses for one. The threshold is
 * user-set in the page. Auto-repeat events (holding a key) are ignored.
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
  }

  down(code, t, repeat = false) {
    if (repeat) return { type: 'repeat' };
    if (this.held.has(code)) {
      this.missingUp++;
      return { type: 'double-down' };
    }
    let result = { type: 'down' };
    const up = this.lastUp.get(code);
    if (up !== undefined) {
      const gap = t - up;
      if (gap >= 0 && gap < this.chatterMs) {
        const ev = { code, gapMs: gap, t };
        this.chatter.push(ev);
        result = { type: 'chatter', gapMs: gap };
      }
    }
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
    return { type: 'up', heldMs: downAt === undefined ? null : t - downAt };
  }

  /** Window lost focus: the browser will not send keyup for held keys. */
  releaseAll(t) {
    for (const code of [...this.held.keys()]) this.up(code, t);
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
      counts: Object.fromEntries(this.counts),
    };
  }
}
