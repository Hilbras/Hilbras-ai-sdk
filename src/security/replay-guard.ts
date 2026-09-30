/**
 * @hilbras/sdk — Replay guard
 *
 * An HMAC signature proves a request was produced by a holder of the secret.
 * It does not prove the request is fresh. This module supplies the other half:
 * a bounded window on the signed timestamp and a bounded cache of already-seen
 * signatures.
 *
 * The cache is a fixed-size FIFO, so a long-lived process cannot grow without
 * bound. Eviction means a very old signature could in principle be replayed
 * after falling out of the window, which is why `maxAgeMs` should be the
 * binding limit rather than the cache size.
 */

export interface ReplayGuardOptions {
  /** Maximum age of a signed request. Default: 5 minutes. */
  maxAgeMs?: number;
  /** Tolerance for a request dated slightly in the future. Default: 30 seconds. */
  maxSkewMs?: number;
  /** Maximum number of remembered signatures. Default: 10,000. */
  maxEntries?: number;
  /** Header carrying the signed timestamp. Default: `"date"`. */
  dateHeader?: string;
  /** Clock injection for deterministic tests. */
  now?: () => number;
}

export interface ReplayVerdict {
  valid: boolean;
  reason?: string;
}

const DEFAULTS = {
  maxAgeMs: 5 * 60_000,
  maxSkewMs: 30_000,
  maxEntries: 10_000,
  dateHeader: "date",
} as const;

export class ReplayGuard {
  private readonly _maxAgeMs: number;
  private readonly _maxSkewMs: number;
  private readonly _maxEntries: number;
  private readonly _dateHeader: string;
  private readonly _now: () => number;
  private readonly _seen = new Set<string>();

  constructor(options: ReplayGuardOptions = {}) {
    this._maxAgeMs = options.maxAgeMs ?? DEFAULTS.maxAgeMs;
    this._maxSkewMs = options.maxSkewMs ?? DEFAULTS.maxSkewMs;
    this._maxEntries = Math.max(1, options.maxEntries ?? DEFAULTS.maxEntries);
    this._dateHeader = (options.dateHeader ?? DEFAULTS.dateHeader).toLowerCase();
    this._now = options.now ?? (() => Date.now());
  }

  /**
   * Verify that a request is fresh and has not been seen before. A signature
   * is recorded only when it passes the window, so a flood of stale requests
   * cannot evict live entries from the cache.
   */
  verify(headers: Record<string, string>, signature: string): ReplayVerdict {
    const lower: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) lower[key.toLowerCase()] = value;
    }

    const raw = lower[this._dateHeader];
    if (!raw) return { valid: false, reason: `missing ${this._dateHeader} header` };

    const timestamp = Date.parse(raw);
    if (Number.isNaN(timestamp)) {
      return { valid: false, reason: `unparseable ${this._dateHeader} header` };
    }

    const age = this._now() - timestamp;
    if (age > this._maxAgeMs) {
      return { valid: false, reason: `request is ${Math.round(age / 1000)}s old, older than the ${Math.round(this._maxAgeMs / 1000)}s window` };
    }
    if (age < -this._maxSkewMs) {
      return { valid: false, reason: `request is dated ${Math.round(-age / 1000)}s in the future` };
    }

    if (this._seen.has(signature)) {
      return { valid: false, reason: "signature has already been used" };
    }

    this._remember(signature);
    return { valid: true };
  }

  /** Number of signatures currently remembered. */
  get size(): number {
    return this._seen.size;
  }

  /** Forget every remembered signature. */
  clear(): void {
    this._seen.clear();
  }

  private _remember(signature: string): void {
    this._seen.add(signature);
    while (this._seen.size > this._maxEntries) {
      const oldest = this._seen.values().next();
      if (oldest.done) break;
      this._seen.delete(oldest.value);
    }
  }
}

/** Create a replay guard. */
export function createReplayGuard(options: ReplayGuardOptions = {}): ReplayGuard {
  return new ReplayGuard(options);
}
