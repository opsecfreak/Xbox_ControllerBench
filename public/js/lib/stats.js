// Pure math helpers. No DOM. Used by the page and by `npm test`.

export function mean(values) {
  if (!values.length) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function stddev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return Math.sqrt(s / (values.length - 1));
}

/**
 * Drift statistics for a stick that the user does not touch.
 * samples: [{x, y}] raw axis values in the range -1..1.
 */
export function driftStats(samples) {
  const xs = samples.map((s) => s.x);
  const ys = samples.map((s) => s.y);
  const meanX = mean(xs);
  const meanY = mean(ys);
  let maxMag = 0;
  let maxResidual = 0;
  for (const s of samples) {
    maxMag = Math.max(maxMag, Math.hypot(s.x, s.y));
    maxResidual = Math.max(maxResidual, Math.hypot(s.x - meanX, s.y - meanY));
  }
  return {
    count: samples.length,
    meanX,
    meanY,
    offset: Math.hypot(meanX, meanY),
    maxMag,
    maxResidual,
    noiseX: stddev(xs),
    noiseY: stddev(ys),
  };
}

/**
 * Records the largest radius reached in each angle bin while the user
 * rotates a stick against its outer edge.
 */
export class RangeRecorder {
  constructor(bins = 72, center = { x: 0, y: 0 }) {
    this.bins = bins;
    this.center = center;
    this.radii = new Array(bins).fill(0);
    this.samples = 0;
  }

  add(x, y) {
    const dx = x - this.center.x;
    const dy = y - this.center.y;
    const r = Math.hypot(dx, dy);
    // Ignore samples near the center. They say nothing about the edge.
    if (r < 0.3) return;
    const a = Math.atan2(dy, dx); // -PI..PI
    let i = Math.floor(((a + Math.PI) / (2 * Math.PI)) * this.bins);
    if (i >= this.bins) i = this.bins - 1;
    if (r > this.radii[i]) this.radii[i] = r;
    this.samples++;
  }

  /** Bin angle (radians) at the middle of bin i. */
  binAngle(i) {
    return -Math.PI + ((i + 0.5) / this.bins) * 2 * Math.PI;
  }

  result() {
    const filled = this.radii.filter((r) => r > 0);
    if (!filled.length) {
      return { coverage: 0, minR: 0, maxR: 0, avgR: 0, circularityError: 0, samples: this.samples };
    }
    const avgR = mean(filled);
    // Mean distance from a perfect unit circle, over the bins that were reached.
    const circularityError = mean(filled.map((r) => Math.abs(Math.min(r, 1.5) - 1)));
    return {
      coverage: filled.length / this.bins,
      minR: Math.min(...filled),
      maxR: Math.max(...filled),
      avgR,
      circularityError,
      samples: this.samples,
    };
  }
}

/** Counts how often the gamepad timestamp changes, as reports per second. */
export class RateMeter {
  constructor(windowMs = 1000) {
    this.windowMs = windowMs;
    this.times = [];
    this.lastStamp = null;
  }

  update(stamp, now) {
    if (stamp !== this.lastStamp) {
      this.lastStamp = stamp;
      this.times.push(now);
    }
    while (this.times.length && now - this.times[0] > this.windowMs) this.times.shift();
    return this.rate();
  }

  rate() {
    return (this.times.length * 1000) / this.windowMs;
  }
}

export function round(v, digits = 3) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
