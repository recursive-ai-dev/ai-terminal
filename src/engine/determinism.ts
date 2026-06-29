// ============================================================
// DETERMINISM PROVIDERS
// Seeded RNG (Mulberry32), UUID provider, fake/real clock
// Injected — never use Math.random() or Date.now() directly
// ============================================================

// ── Seeded RNG: Mulberry32 ─────────────────────────────────
// Deterministic, fast, good statistical properties
export class SeededRNG {
  private state: number;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
    this.state = seed >>> 0;
  }

  // Returns [0, 1)
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let z = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    z = (z ^ (z + Math.imul(z ^ (z >>> 7), 61 | z))) >>> 0;
    return (z ^ (z >>> 14)) / 0x100000000;
  }

  // Box-Muller: N(0,1)
  nextGaussian(): number {
    const u1 = this.next() || 1e-10;
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // Returns new RNG forked from this one (reproducible child)
  fork(offset = 1): SeededRNG {
    return new SeededRNG(this.state ^ (offset * 0xdeadbeef));
  }

  reset(): void {
    this.state = this.seed >>> 0;
  }
}

// Global default RNG (non-deterministic seed by default)
let _globalRNG: SeededRNG = new SeededRNG(
  (typeof performance !== "undefined" ? performance.now() : Date.now()) | 0
);

export function getGlobalRNG(): SeededRNG {
  return _globalRNG;
}

export function seedGlobalRNG(seed: number): void {
  _globalRNG = new SeededRNG(seed);
}

export function resetGlobalRNG(): void {
  _globalRNG.reset();
}

// ── Clock Provider ─────────────────────────────────────────
export interface ClockProvider {
  now(): number; // ms since epoch
  mark(): number; // for latency measurement
  elapsed(since: number): number;
}

class RealClock implements ClockProvider {
  now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }
  mark(): number {
    return this.now();
  }
  elapsed(since: number): number {
    return this.now() - since;
  }
}

class FakeClock implements ClockProvider {
  private _time: number;
  private _increment: number;

  constructor(startTime = 0, increment = 1) {
    this._time = startTime;
    this._increment = increment;
  }

  now(): number {
    return this._time;
  }

  mark(): number {
    const t = this._time;
    this._time += this._increment;
    return t;
  }

  elapsed(since: number): number {
    return this._time - since;
  }

  advance(ms: number): void {
    this._time += ms;
  }

  set(ms: number): void {
    this._time = ms;
  }
}

export const realClock: ClockProvider = new RealClock();
export function makeFakeClock(start = 0, increment = 1): FakeClock {
  return new FakeClock(start, increment);
}

// ── UUID Provider ──────────────────────────────────────────
export interface UUIDProvider {
  generate(): string;
}

class CryptoUUID implements UUIDProvider {
  generate(): string {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback: pseudo-uuid v4
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

class SeededUUID implements UUIDProvider {
  private rng: SeededRNG;
  constructor(rng: SeededRNG) { this.rng = rng; }

  generate(): string {
    const hex = (n: number) => Math.floor(this.rng.next() * n).toString(16).padStart(2, "0");
    return `${hex(256)}${hex(256)}${hex(256)}${hex(256)}-${hex(256)}${hex(256)}-4${hex(16)}${hex(256)}-${((this.rng.next() * 4 | 0) + 8).toString(16)}${hex(256)}-${hex(256)}${hex(256)}${hex(256)}${hex(256)}${hex(256)}${hex(256)}`;
  }
}

export const cryptoUUID: UUIDProvider = new CryptoUUID();
export function makeSeededUUID(rng: SeededRNG): UUIDProvider {
  return new SeededUUID(rng);
}
