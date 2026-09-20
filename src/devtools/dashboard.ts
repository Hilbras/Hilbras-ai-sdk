import type { ClientHooks } from '../client/hooks.js';
import type {
  RequestStartEvent,
  RequestCompletedEvent,
  RequestFailedEvent,
  RetryEvent,
  RoutingResolvedEvent,
  StreamFirstChunkEvent,
  FallbackEvent,
  ValidationFailEvent,
} from '../types/observability.js';

/**
 * Per-request timeline entry
 */
export interface RequestTimelineEntry {
  requestId: string;
  provider: string;
  model: string;
  task?: string;
  status: 'pending' | 'completed' | 'failed' | 'retrying';
  startTime: number;
  endTime?: number;
  durationMs?: number;
  ttftMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  attempts: number;
  error?: string;
  fallbackProvider?: string;
  fallbackModel?: string;
}

/**
 * Provider health status
 */
export interface ProviderHealth {
  provider: string;
  state: 'closed' | 'open' | 'half_open';
  failureCount: number;
  successCount: number;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  last5minErrorRate: number;
  last5minRequestCount: number;
}

/**
 * Cost summary snapshot
 */
export interface CostSnapshot {
  totalCost: number;
  totalReserved: number;
  committedCost: number;
  remainingBudget: number | null;
  budgetExceeded: boolean;
  byProvider: Record<string, { estimated: number; actual: number; requests: number }>;
  byPhase: Record<string, number>;
}

/**
 * Routing decision record
 */
export interface RoutingDecision {
  requestId: string;
  provider: string;
  model: string;
  score: number;
  reasons: string[];
  timestamp: number;
}

/**
 * Throughput sample for sparkline
 */
export interface ThroughputSample {
  timestamp: number;
  requestsPerSecond: number;
  errorRate: number;
}

/**
 * Aggregated dashboard snapshot
 */
export interface DashboardSnapshot {
  timestamp: number;
  summary: {
    totalRequests: number;
    activeRequests: number;
    completedRequests: number;
    failedRequests: number;
    errorRate: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    avgTtftMs: number;
    totalTokens: number;
    totalCost: number;
    remainingBudget: number | null;
  };
  providers: ProviderHealth[];
  cost: CostSnapshot;
  recentRequests: RequestTimelineEntry[];
  recentRouting: RoutingDecision[];
  recentRetries: { requestId: string; provider: string; attempt: number; delayMs: number; reason: string; timestamp: number }[];
  recentFallbacks: { requestId: string; originalProvider: string; originalModel: string; fallbackProvider: string; fallbackModel: string; timestamp: number }[];
  recentValidationFails: { requestId: string; attempt: number; error: string; timestamp: number }[];
  throughput: ThroughputSample[];
  circuitBreakerStates: Record<string, { state: string; failureCount: number; successCount: number; totalCalls: number }>;
  routingDecisions: { provider: string; model: string; avgScore: number; totalDecisions: number; successRate: number }[];
}

/**
 * Dashboard configuration
 */
export interface DashboardConfig {
  /** Max request timeline entries to retain */
  maxTimelineEntries?: number;
  /** Max routing decisions to retain */
  maxRoutingEntries?: number;
  /** Max retry records to retain */
  maxRetryEntries?: number;
  /** Max fallback records to retain */
  maxFallbackEntries?: number;
  /** Max validation fail records to retain */
  maxValidationFailEntries?: number;
  /** Throughput sample interval in ms (default 5000) */
  throughputIntervalMs?: number;
  /** Max throughput samples */
  maxThroughputSamples?: number;
}

interface InternalRequestState {
  requestId: string;
  provider: string;
  model: string;
  task?: string;
  status: 'pending' | 'completed' | 'failed' | 'retrying';
  startTime: number;
  endTime?: number;
  durationMs?: number;
  ttftMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  attempts: number;
  error?: string;
  fallbackProvider?: string;
  fallbackModel?: string;
}

/**
 * Unified DevTools Dashboard
 *
 * Aggregates data from hooks, cost tracker, circuit breaker registry,
 * and model router into a single queryable snapshot.
 *
 * Usage:
 * ```typescript
 * const dashboard = new DevToolsDashboard();
 * dashboard.instrument(client);
 *
 * // Get current state
 * const snapshot = dashboard.snapshot();
 *
 * // Render as text
 * console.log(dashboard.renderText());
 *
 * // Subscribe to updates
 * dashboard.onUpdate((snapshot) => { ... });
 * ```
 */
export class DevToolsDashboard {
  private config: Required<DashboardConfig>;
  private hooks: ClientHooks | null = null;
  private unsubs: (() => void)[] = [];

  private requests = new Map<string, InternalRequestState>();
  private timeline: RequestTimelineEntry[] = [];
  private routingDecisions: RoutingDecision[] = [];
  private retryRecords: { requestId: string; provider: string; attempt: number; delayMs: number; reason: string; timestamp: number }[] = [];
  private fallbackRecords: { requestId: string; originalProvider: string; originalModel: string; fallbackProvider: string; fallbackModel: string; timestamp: number }[] = [];
  private validationFailRecords: { requestId: string; attempt: number; error: string; timestamp: number }[] = [];
  private throughputSamples: ThroughputSample[] = [];

  private listeners: Set<(snapshot: DashboardSnapshot) => void> = new Set();
  private throughputTimer: ReturnType<typeof setInterval> | null = null;
  private completedCount = 0;
  private failedCount = 0;
  private totalTokens = 0;
  private totalCost = 0;
  private latencies: number[] = [];
  private ttfts: number[] = [];

  constructor(config: DashboardConfig = {}) {
    this.config = {
      maxTimelineEntries: config.maxTimelineEntries ?? 500,
      maxRoutingEntries: config.maxRoutingEntries ?? 200,
      maxRetryEntries: config.maxRetryEntries ?? 100,
      maxFallbackEntries: config.maxFallbackEntries ?? 50,
      maxValidationFailEntries: config.maxValidationFailEntries ?? 50,
      throughputIntervalMs: config.throughputIntervalMs ?? 5000,
      maxThroughputSamples: config.maxThroughputSamples ?? 120,
    };
  }

  /**
   * Wire to a client's hook system
   */
  instrument(hooks: ClientHooks): void {
    if (this.hooks) this.detach();
    this.hooks = hooks;

    this.unsubs.push(hooks.on<RequestStartEvent>('request.start', (e) => this.onRequestStart(e)));
    this.unsubs.push(hooks.on<RequestCompletedEvent>('request.completed', (e) => this.onRequestCompleted(e)));
    this.unsubs.push(hooks.on<RequestFailedEvent>('request.failed', (e) => this.onRequestFailed(e)));
    this.unsubs.push(hooks.on<RetryEvent>('request.retrying', (e) => this.onRetry(e)));
    this.unsubs.push(hooks.on('circuit_breaker.open', () => {}));
    this.unsubs.push(hooks.on<RoutingResolvedEvent>('routing.resolved', (e) => this.onRoutingResolved(e)));
    this.unsubs.push(hooks.on<StreamFirstChunkEvent>('stream.first_chunk', (e) => this.onStreamFirstChunk(e)));
    this.unsubs.push(hooks.on<FallbackEvent>('fallback.started', (e) => this.onFallback(e)));
    this.unsubs.push(hooks.on('structured.validate.pass', () => {}));
    this.unsubs.push(hooks.on<ValidationFailEvent>('structured.validate.fail', (e) => this.onValidationFail(e)));

    this.throughputTimer = setInterval(() => this.sampleThroughput(), this.config.throughputIntervalMs);
  }

  /**
   * Detach from hooks and stop timers
   */
  detach(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.hooks = null;
    if (this.throughputTimer) {
      clearInterval(this.throughputTimer);
      this.throughputTimer = null;
    }
  }

  /**
   * Subscribe to dashboard updates
   */
  onUpdate(listener: (snapshot: DashboardSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get current dashboard snapshot
   */
  snapshot(costTracker?: { report: () => { totalActual: number; totalReserved: number; committedCost: number; remainingBudget: number | null; budgetExceeded: boolean; byProvider: Record<string, { estimated: number; actual: number; requests: number }>; byPhase: Record<string, number> } }, circuitBreakerRegistry?: { getAllStats: () => Record<string, { state: string; failureCount: number; successCount: number; totalCalls: number; totalFailures: number; totalSuccesses: number; lastFailureTime?: number; lastSuccessTime?: number }> }): DashboardSnapshot {
    const costReport = costTracker?.report();
    const cbStats = circuitBreakerRegistry?.getAllStats() ?? {};

    const activeCount = Array.from(this.requests.values()).filter((r) => r.status === 'pending' || r.status === 'retrying').length;

    const avgLatency = this.latencies.length > 0 ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length : 0;
    const sortedLatencies = [...this.latencies].sort((a, b) => a - b);
    const p95 = sortedLatencies.length > 0 ? sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] ?? 0 : 0;
    const p99 = sortedLatencies.length > 0 ? sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] ?? 0 : 0;
    const avgTtft = this.ttfts.length > 0 ? this.ttfts.reduce((a, b) => a + b, 0) / this.ttfts.length : 0;

    const providers = Object.entries(cbStats).map(([provider, stats]) => {
      const recentRequests = Array.from(this.requests.values()).filter(
        (r) => r.provider === provider && r.startTime > Date.now() - 300_000
      );
      const recentFailed = recentRequests.filter((r) => r.status === 'failed').length;
      return {
        provider,
        state: stats.state as 'closed' | 'open' | 'half_open',
        failureCount: stats.failureCount,
        successCount: stats.successCount,
        totalCalls: stats.totalCalls,
        totalFailures: stats.totalFailures,
        totalSuccesses: stats.totalSuccesses,
        lastFailureTime: stats.lastFailureTime,
        lastSuccessTime: stats.lastSuccessTime,
        last5minErrorRate: recentRequests.length > 0 ? recentFailed / recentRequests.length : 0,
        last5minRequestCount: recentRequests.length,
      };
    });

    const routingAgg = new Map<string, { provider: string; model: string; totalScore: number; count: number; successes: number }>();
    for (const d of this.routingDecisions) {
      const key = `${d.provider}:${d.model}`;
      const existing = routingAgg.get(key);
      if (existing) {
        existing.totalScore += d.score;
        existing.count++;
      } else {
        routingAgg.set(key, { provider: d.provider, model: d.model, totalScore: d.score, count: 1, successes: 0 });
      }
    }
    for (const r of this.timeline) {
      if (r.status === 'completed') {
        const key = `${r.provider}:${r.model}`;
        const agg = routingAgg.get(key);
        if (agg) agg.successes++;
      }
    }

    const snapshot: DashboardSnapshot = {
      timestamp: Date.now(),
      summary: {
        totalRequests: this.timeline.length,
        activeRequests: activeCount,
        completedRequests: this.completedCount,
        failedRequests: this.failedCount,
        errorRate: this.completedCount + this.failedCount > 0 ? this.failedCount / (this.completedCount + this.failedCount) : 0,
        avgLatencyMs: avgLatency,
        p95LatencyMs: p95,
        p99LatencyMs: p99,
        avgTtftMs: avgTtft,
        totalTokens: this.totalTokens,
        totalCost: this.totalCost,
        remainingBudget: costReport?.remainingBudget ?? null,
      },
      providers,
      cost: {
        totalCost: costReport?.totalActual ?? this.totalCost,
        totalReserved: costReport?.totalReserved ?? 0,
        committedCost: costReport?.committedCost ?? 0,
        remainingBudget: costReport?.remainingBudget ?? null,
        budgetExceeded: costReport?.budgetExceeded ?? false,
        byProvider: costReport?.byProvider ?? {},
        byPhase: costReport?.byPhase ?? {},
      },
      recentRequests: this.timeline.slice(-50),
      recentRouting: this.routingDecisions.slice(-50),
      recentRetries: this.retryRecords.slice(-50),
      recentFallbacks: this.fallbackRecords.slice(-30),
      recentValidationFails: this.validationFailRecords.slice(-30),
      throughput: this.throughputSamples,
      circuitBreakerStates: Object.fromEntries(
        Object.entries(cbStats).map(([k, v]) => [k, { state: v.state, failureCount: v.failureCount, successCount: v.successCount, totalCalls: v.totalCalls }])
      ),
      routingDecisions: Array.from(routingAgg.values()).map((v) => ({
        provider: v.provider,
        model: v.model,
        avgScore: v.totalScore / v.count,
        totalDecisions: v.count,
        successRate: v.count > 0 ? v.successes / v.count : 0,
      })),
    };

    return snapshot;
  }

  /**
   * Render dashboard as monospace text
   */
  renderText(snapshot?: DashboardSnapshot): string {
    const s = snapshot ?? this.snapshot();
    const lines: string[] = [];

    lines.push('╔══════════════════════════════════════════════════════════════╗');
    lines.push('║                  HILBRAS SDK DEVTOOLS                       ║');
    lines.push('╚══════════════════════════════════════════════════════════════╝');
    lines.push('');

    // Summary
    lines.push('┌─ SUMMARY ────────────────────────────────────────────────────┐');
    lines.push(`│ Requests:  ${s.summary.totalRequests} total, ${s.summary.activeRequests} active, ${s.summary.completedRequests} done, ${s.summary.failedRequests} failed`);
    lines.push(`│ Error:     ${(s.summary.errorRate * 100).toFixed(1)}%`);
    lines.push(`│ Latency:   avg ${s.summary.avgLatencyMs.toFixed(0)}ms  p95 ${s.summary.p95LatencyMs.toFixed(0)}ms  p99 ${s.summary.p99LatencyMs.toFixed(0)}ms`);
    lines.push(`│ TTFT:      avg ${s.summary.avgTtftMs.toFixed(0)}ms`);
    lines.push(`│ Tokens:    ${s.summary.totalTokens.toLocaleString()}`);
    lines.push(`│ Cost:      $${s.summary.totalCost.toFixed(4)}${s.summary.remainingBudget != null ? ` / $${s.summary.remainingBudget.toFixed(2)} remaining` : ''}`);
    lines.push('└──────────────────────────────────────────────────────────────┘');
    lines.push('');

    // Provider health
    if (s.providers.length > 0) {
      lines.push('┌─ PROVIDER HEALTH ────────────────────────────────────────────┐');
      for (const p of s.providers) {
        const icon = p.state === 'closed' ? '●' : p.state === 'open' ? '○' : '◐';
        const errRate = (p.last5minErrorRate * 100).toFixed(0);
        lines.push(`│ ${icon} ${p.provider.padEnd(20)} ${p.state.padEnd(9)} err:${errRate}% req:${p.last5minRequestCount} total:${p.totalCalls}`);
      }
      lines.push('└──────────────────────────────────────────────────────────────┘');
      lines.push('');
    }

    // Cost breakdown by provider
    if (Object.keys(s.cost.byProvider).length > 0) {
      lines.push('┌─ COST BY PROVIDER ───────────────────────────────────────────┐');
      for (const [provider, data] of Object.entries(s.cost.byProvider)) {
        lines.push(`│ ${provider.padEnd(20)} $${data.actual.toFixed(4)} (${data.requests} reqs)`);
      }
      lines.push(`│ Total: $${s.cost.totalCost.toFixed(4)}`);
      if (s.cost.totalReserved > 0) lines.push(`│ Reserved: $${s.cost.totalReserved.toFixed(4)}`);
      if (s.cost.budgetExceeded) lines.push('│ ⚠ BUDGET EXCEEDED');
      lines.push('└──────────────────────────────────────────────────────────────┘');
      lines.push('');
    }

    // Routing decisions
    if (s.routingDecisions.length > 0) {
      lines.push('┌─ ROUTING DECISIONS ──────────────────────────────────────────┐');
      for (const r of s.routingDecisions.slice(0, 10)) {
        const score = r.avgScore.toFixed(0).padStart(3);
        lines.push(`│ ${r.provider}/${r.model}  score:${score}  reqs:${r.totalDecisions}  ok:${(r.successRate * 100).toFixed(0)}%`);
      }
      lines.push('└──────────────────────────────────────────────────────────────┘');
      lines.push('');
    }

    // Recent retries
    if (s.recentRetries.length > 0) {
      lines.push('┌─ RECENT RETRIES ─────────────────────────────────────────────┐');
      for (const r of s.recentRetries.slice(-5)) {
        lines.push(`│ ${r.provider} attempt #${r.attempt} delay ${r.delayMs}ms — ${r.reason}`);
      }
      lines.push('└──────────────────────────────────────────────────────────────┘');
      lines.push('');
    }

    // Recent fallbacks
    if (s.recentFallbacks.length > 0) {
      lines.push('┌─ RECENT FALLBACKS ───────────────────────────────────────────┐');
      for (const f of s.recentFallbacks.slice(-5)) {
        lines.push(`│ ${f.originalProvider}/${f.originalModel} → ${f.fallbackProvider}/${f.fallbackModel}`);
      }
      lines.push('└──────────────────────────────────────────────────────────────┘');
      lines.push('');
    }

    // Recent validation failures
    if (s.recentValidationFails.length > 0) {
      lines.push('┌─ VALIDATION FAILURES ────────────────────────────────────────┐');
      for (const v of s.recentValidationFails.slice(-5)) {
        lines.push(`│ attempt #${v.attempt}: ${v.error.slice(0, 60)}`);
      }
      lines.push('└──────────────────────────────────────────────────────────────┘');
      lines.push('');
    }

    // Throughput sparkline
    if (s.throughput.length > 1) {
      lines.push('┌─ THROUGHPUT ─────────────────────────────────────────────────┐');
      const maxRps = Math.max(...s.throughput.map((t) => t.requestsPerSecond), 1);
      const barWidth = 40;
      for (const sample of s.throughput.slice(-15)) {
        const barLen = Math.round((sample.requestsPerSecond / maxRps) * barWidth);
        const bar = '█'.repeat(barLen) + '░'.repeat(barWidth - barLen);
        lines.push(`│ ${bar} ${sample.requestsPerSecond.toFixed(1)} rps`);
      }
      lines.push('└──────────────────────────────────────────────────────────────┘');
    }

    return lines.join('\n');
  }

  /**
   * Export full state as JSON
   */
  exportJson(snapshot?: DashboardSnapshot): string {
    return JSON.stringify(snapshot ?? this.snapshot(), null, 2);
  }

  /**
   * Clear all accumulated data
   */
  clear(): void {
    this.requests.clear();
    this.timeline = [];
    this.routingDecisions = [];
    this.retryRecords = [];
    this.fallbackRecords = [];
    this.validationFailRecords = [];
    this.throughputSamples = [];
    this.completedCount = 0;
    this.failedCount = 0;
    this.totalTokens = 0;
    this.totalCost = 0;
    this.latencies = [];
    this.ttfts = [];
  }

  // ── Hook handlers ──

  private onRequestStart(e: RequestStartEvent): void {
    this.requests.set(e.requestId, {
      requestId: e.requestId,
      provider: e.provider ?? 'unknown',
      model: e.model ?? 'unknown',
      task: e.task,
      status: 'pending',
      startTime: Date.now(),
      attempts: 1,
    });
    this.emitUpdate();
  }

  private onRequestCompleted(e: RequestCompletedEvent): void {
    const state = this.requests.get(e.requestId);
    if (state) {
      state.status = 'completed';
      state.endTime = Date.now();
      state.durationMs = e.durationMs;
      state.inputTokens = e.inputTokens;
      state.outputTokens = e.outputTokens;
      state.attempts = e.attempts;
    }

    this.completedCount++;
    this.totalTokens += (e.inputTokens ?? 0) + (e.outputTokens ?? 0);
    if (e.durationMs != null) this.latencies.push(e.durationMs);

    this.timeline.push({
      requestId: e.requestId,
      provider: e.provider,
      model: e.model,
      task: state?.task,
      status: 'completed',
      startTime: state?.startTime ?? Date.now() - (e.durationMs ?? 0),
      endTime: Date.now(),
      durationMs: e.durationMs,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      attempts: e.attempts,
    });
    this.trimTimeline();
    this.emitUpdate();
  }

  private onRequestFailed(e: RequestFailedEvent): void {
    const state = this.requests.get(e.requestId);
    if (state) {
      state.status = 'failed';
      state.endTime = Date.now();
      state.durationMs = e.durationMs;
      state.error = e.error;
      state.attempts = e.attempts;
    }

    this.failedCount++;
    if (e.durationMs != null) this.latencies.push(e.durationMs);

    this.timeline.push({
      requestId: e.requestId,
      provider: e.provider,
      model: e.model,
      task: state?.task,
      status: 'failed',
      startTime: state?.startTime ?? Date.now() - (e.durationMs ?? 0),
      endTime: Date.now(),
      durationMs: e.durationMs,
      error: e.error,
      attempts: e.attempts,
    });
    this.trimTimeline();
    this.emitUpdate();
  }

  private onRetry(e: RetryEvent): void {
    const state = this.requests.get(e.requestId);
    if (state) state.status = 'retrying';

    this.retryRecords.push({
      requestId: e.requestId,
      provider: e.provider,
      attempt: e.attempt,
      delayMs: e.delayMs,
      reason: e.reason,
      timestamp: Date.now(),
    });
    if (this.retryRecords.length > this.config.maxRetryEntries) {
      this.retryRecords = this.retryRecords.slice(-this.config.maxRetryEntries);
    }
    this.emitUpdate();
  }

  private onRoutingResolved(e: RoutingResolvedEvent): void {
    this.routingDecisions.push({
      requestId: '',
      provider: e.provider,
      model: e.model,
      score: e.score,
      reasons: e.reasons,
      timestamp: Date.now(),
    });
    if (this.routingDecisions.length > this.config.maxRoutingEntries) {
      this.routingDecisions = this.routingDecisions.slice(-this.config.maxRoutingEntries);
    }
    this.emitUpdate();
  }

  private onStreamFirstChunk(e: StreamFirstChunkEvent): void {
    this.ttfts.push(e.latencyMs);
    this.emitUpdate();
  }

  private onFallback(e: FallbackEvent): void {
    this.fallbackRecords.push({
      requestId: '',
      originalProvider: e.originalProvider,
      originalModel: e.originalModel,
      fallbackProvider: e.fallbackProvider,
      fallbackModel: e.fallbackModel,
      timestamp: Date.now(),
    });
    if (this.fallbackRecords.length > this.config.maxFallbackEntries) {
      this.fallbackRecords = this.fallbackRecords.slice(-this.config.maxFallbackEntries);
    }
    this.emitUpdate();
  }

  private onValidationFail(e: ValidationFailEvent): void {
    this.validationFailRecords.push({
      requestId: '',
      attempt: e.attempt,
      error: e.error,
      timestamp: Date.now(),
    });
    if (this.validationFailRecords.length > this.config.maxValidationFailEntries) {
      this.validationFailRecords = this.validationFailRecords.slice(-this.config.maxValidationFailEntries);
    }
    this.emitUpdate();
  }

  private sampleThroughput(): void {
    const now = Date.now();
    const windowMs = this.config.throughputIntervalMs;
    const recentCompleted = this.completedCount;
    const recentFailed = this.failedCount;
    const rps = ((recentCompleted + recentFailed) / (windowMs / 1000));

    const recentRequests = Array.from(this.requests.values()).filter(
      (r) => r.startTime > now - windowMs
    );
    const recentErrors = recentRequests.filter((r) => r.status === 'failed').length;

    this.throughputSamples.push({
      timestamp: now,
      requestsPerSecond: rps,
      errorRate: recentRequests.length > 0 ? recentErrors / recentRequests.length : 0,
    });
    if (this.throughputSamples.length > this.config.maxThroughputSamples) {
      this.throughputSamples = this.throughputSamples.slice(-this.config.maxThroughputSamples);
    }
  }

  private trimTimeline(): void {
    if (this.timeline.length > this.config.maxTimelineEntries) {
      this.timeline = this.timeline.slice(-this.config.maxTimelineEntries);
    }
  }

  private emitUpdate(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.snapshot();
    this.notifyListeners(snapshot);
  }

  private notifyListeners(snapshot: DashboardSnapshot): void {
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch { /* swallow */ }
    }
  }
}
