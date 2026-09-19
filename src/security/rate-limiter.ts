/**
 * @hilbras/sdk — Token Bucket Rate Limiter
 *
 * Client-side rate limiter using the token bucket algorithm.
 * Tokens refill at a constant rate; each request consumes tokens.
 * When the bucket is empty, requests are rejected with retry-after info.
 *
 * Usage:
 *   import { createRateLimiter } from "@hilbras/sdk";
 *
 *   const limiter = createRateLimiter({ maxTokens: 100, refillRate: 10 });
 *   if (limiter.acquire().allowed) {
 *     limiter.consume();
 *     await fetch(...);
 *   }
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Configuration for a rate limiter instance */
export interface RateLimiterConfig {
  /** Maximum tokens in the bucket (burst capacity). @default 100 */
  maxTokens?: number;
  /** Tokens added per second. @default 10 */
  refillRate?: number;
  /** Cost per request in tokens. @default 1 */
  costPerRequest?: number;
  /** Cost per token for token-based pricing. @default 0 (fixed cost only) */
  costPerToken?: number;
  /** Callback fired when a request is throttled */
  onThrottled?: (info: ThrottleInfo) => void;
  /** Custom key for multi-tenant rate limiting (e.g., per-provider) */
  key?: string;
}

/** Information provided when a request is throttled */
export interface ThrottleInfo {
  /** Milliseconds until enough tokens will be available */
  retryAfterMs: number;
  /** Current tokens in the bucket */
  tokensAvailable: number;
  /** Tokens needed for the rejected request */
  tokensNeeded: number;
  /** Rate limiter key */
  key: string;
}

/** Current bucket state */
export interface RateLimiterStats {
  tokens: number;
  maxTokens: number;
  refillRate: number;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<
  Pick<RateLimiterConfig, "maxTokens" | "refillRate" | "costPerRequest" | "costPerToken">
> = {
  maxTokens: 100,
  refillRate: 10,
  costPerRequest: 1,
  costPerToken: 0,
};

// ─── Rate Limiter ───────────────────────────────────────────────────────────

export class RateLimiter {
  private readonly _maxTokens: number;
  private readonly _refillRate: number;
  private readonly _costPerRequest: number;
  private readonly _costPerToken: number;
  private readonly _key: string;
  private readonly _onThrottled?: (info: ThrottleInfo) => void;

  private _tokens: number;
  private _lastRefill: number;

  constructor(config?: RateLimiterConfig) {
    this._maxTokens = config?.maxTokens ?? DEFAULT_CONFIG.maxTokens;
    this._refillRate = config?.refillRate ?? DEFAULT_CONFIG.refillRate;
    this._costPerRequest = config?.costPerRequest ?? DEFAULT_CONFIG.costPerRequest;
    this._costPerToken = config?.costPerToken ?? DEFAULT_CONFIG.costPerToken;
    this._key = config?.key ?? "default";
    this._onThrottled = config?.onThrottled;

    this._tokens = this._maxTokens;
    this._lastRefill = Date.now();
  }

  /** Current token count (refills on access) */
  get tokens(): number {
    this._refill();
    return this._tokens;
  }

  /**
   * Check if a request can proceed without consuming tokens.
   * Returns `{ allowed: true }` or `{ allowed: false, retryAfterMs }`.
   */
  acquire(cost?: number): { allowed: boolean; retryAfterMs: number } {
    this._refill();

    const tokensNeeded = this._computeCost(cost);

    if (this._tokens >= tokensNeeded) {
      return { allowed: true, retryAfterMs: 0 };
    }

    const deficit = tokensNeeded - this._tokens;
    const retryAfterMs = Math.ceil((deficit / this._refillRate) * 1000);

    return { allowed: false, retryAfterMs };
  }

  /**
   * Consume tokens for a request. Throws if not enough tokens are available.
   * @throws {Error} when rate limit is exceeded
   */
  consume(cost?: number): void {
    const result = this.acquire(cost);

    if (!result.allowed) {
      const tokensNeeded = this._computeCost(cost);
      const info: ThrottleInfo = {
        retryAfterMs: result.retryAfterMs,
        tokensAvailable: this._tokens,
        tokensNeeded,
        key: this._key,
      };

      this._onThrottled?.(info);

      throw new Error(
        `Rate limit exceeded for key "${this._key}". ` +
          `Retry after ${result.retryAfterMs}ms. ` +
          `Available: ${this._tokens.toFixed(2)} tokens, needed: ${tokensNeeded}.`,
      );
    }

    this._tokens -= this._computeCost(cost);
  }

  /**
   * Get current bucket state (refills on access).
   */
  stats(): RateLimiterStats {
    this._refill();
    return {
      tokens: this._tokens,
      maxTokens: this._maxTokens,
      refillRate: this._refillRate,
    };
  }

  /**
   * Reset the bucket to full capacity.
   */
  reset(): void {
    this._tokens = this._maxTokens;
    this._lastRefill = Date.now();
  }

  /** Refill tokens based on elapsed time since last refill */
  private _refill(): void {
    const now = Date.now();
    const elapsed = (now - this._lastRefill) / 1000;

    if (elapsed <= 0) return;

    this._tokens = Math.min(this._maxTokens, this._tokens + elapsed * this._refillRate);
    this._lastRefill = now;
  }

  /** Compute total cost: fixed cost + variable cost based on token count */
  private _computeCost(requestTokens?: number): number {
    const tokens = requestTokens ?? 0;
    return this._costPerRequest + tokens * this._costPerToken;
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a new rate limiter with the given configuration.
 */
export function createRateLimiter(config?: RateLimiterConfig): RateLimiter {
  return new RateLimiter(config);
}

// ─── Registry ───────────────────────────────────────────────────────────────

/**
 * Manages multiple named rate limiter instances.
 * Useful for per-provider or per-user rate limiting.
 */
export class RateLimiterRegistry {
  private _limiters = new Map<string, RateLimiter>();

  /**
   * Get an existing rate limiter for `key`, or create one with `config`.
   * If the key already exists, the existing limiter is returned (config is ignored).
   */
  getOrCreate(key: string, config?: RateLimiterConfig): RateLimiter {
    let limiter = this._limiters.get(key);
    if (!limiter) {
      limiter = new RateLimiter({ ...config, key });
      this._limiters.set(key, limiter);
    }
    return limiter;
  }

  /**
   * Get a rate limiter by key, or undefined if not registered.
   */
  get(key: string): RateLimiter | undefined {
    return this._limiters.get(key);
  }

  /**
   * Remove a rate limiter by key. Returns true if it existed.
   */
  remove(key: string): boolean {
    return this._limiters.delete(key);
  }

  /**
   * Reset all rate limiters to full capacity.
   */
  resetAll(): void {
    for (const limiter of this._limiters.values()) limiter.reset();
  }
}
