/**
 * @hilbras/sdk — Circuit Breaker
 *
 * Classic state machine: CLOSED → OPEN → HALF_OPEN → CLOSED
 * Prevents hammering a failing provider.
 */

import { CircuitBreakerOpenError } from "../errors/index.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
  halfOpenMaxCalls: number;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
}

const DEFAULT_CB_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeoutMs: 30_000,
  halfOpenMaxCalls: 3,
};

// ─── Circuit Breaker ────────────────────────────────────────────────────────

export class CircuitBreaker {
  private _state: CircuitState = "closed";
  private _failureCount = 0;
  private _successCount = 0;
  private _lastFailureTime: number | null = null;
  private _lastSuccessTime: number | null = null;
  private _totalCalls = 0;
  private _totalFailures = 0;
  private _totalSuccesses = 0;
  private _halfOpenCalls = 0;

  constructor(
    public readonly name: string,
    private readonly config: CircuitBreakerConfig = DEFAULT_CB_CONFIG,
  ) {}

  get state(): CircuitState { return this._state; }

  get stats(): CircuitBreakerStats {
    return {
      state: this._state,
      failureCount: this._failureCount,
      successCount: this._successCount,
      lastFailureTime: this._lastFailureTime,
      lastSuccessTime: this._lastSuccessTime,
      totalCalls: this._totalCalls,
      totalFailures: this._totalFailures,
      totalSuccesses: this._totalSuccesses,
    };
  }

  isAvailable(): boolean {
    if (this._state === "closed") return true;
    if (this._state === "open") {
      if (this._lastFailureTime && Date.now() - this._lastFailureTime >= this.config.timeoutMs) {
        this._transitionTo("half_open");
        return true;
      }
      return false;
    }
    // half_open
    return this._halfOpenCalls < this.config.halfOpenMaxCalls;
  }

  recordSuccess(): void {
    this._totalCalls++;
    this._totalSuccesses++;
    this._lastSuccessTime = Date.now();

    if (this._state === "half_open") {
      this._successCount++;
      this._halfOpenCalls--;
      if (this._successCount >= this.config.successThreshold) {
        this._transitionTo("closed");
      }
    } else {
      this._failureCount = 0;
    }
  }

  recordFailure(error?: Error): void {
    // Skip excluded exceptions (e.g. CircuitBreakerOpenError itself)
    if (error instanceof CircuitBreakerOpenError) return;

    this._totalCalls++;
    this._totalFailures++;
    this._failureCount++;
    this._lastFailureTime = Date.now();

    if (this._state === "half_open") {
      this._halfOpenCalls--;
      this._transitionTo("open");
    } else if (this._failureCount >= this.config.failureThreshold) {
      this._transitionTo("open");
    }
  }

  reset(): void {
    this._transitionTo("closed");
  }

  private _transitionTo(state: CircuitState): void {
    this._state = state;
    if (state === "closed") {
      this._failureCount = 0;
      this._successCount = 0;
      this._halfOpenCalls = 0;
    } else if (state === "half_open") {
      this._successCount = 0;
      this._halfOpenCalls = 0;
    }
  }
}

// ─── Registry ───────────────────────────────────────────────────────────────

export class CircuitBreakerRegistry {
  private _breakers = new Map<string, CircuitBreaker>();

  getOrCreate(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    let breaker = this._breakers.get(name);
    if (!breaker) {
      breaker = new CircuitBreaker(name, { ...DEFAULT_CB_CONFIG, ...config });
      this._breakers.set(name, breaker);
    }
    return breaker;
  }

  get(name: string): CircuitBreaker | undefined {
    return this._breakers.get(name);
  }

  remove(name: string): boolean {
    return this._breakers.delete(name);
  }

  resetAll(): void {
    for (const breaker of this._breakers.values()) breaker.reset();
  }

  getAllStats(): Record<string, CircuitBreakerStats> {
    const out: Record<string, CircuitBreakerStats> = {};
    for (const [name, breaker] of this._breakers) out[name] = breaker.stats;
    return out;
  }
}

// ─── Global Singleton ───────────────────────────────────────────────────────

let _registry: CircuitBreakerRegistry | null = null;

export function getCircuitBreakerRegistry(): CircuitBreakerRegistry {
  if (!_registry) _registry = new CircuitBreakerRegistry();
  return _registry;
}
