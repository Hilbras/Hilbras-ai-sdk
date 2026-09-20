import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DevToolsDashboard } from '../src/devtools/dashboard.js';
import { ClientHooks } from '../src/client/hooks.js';
import type {
  RequestStartEvent,
  RequestCompletedEvent,
  RequestFailedEvent,
  RetryEvent,
  RoutingResolvedEvent,
  StreamFirstChunkEvent,
  FallbackEvent,
  ValidationFailEvent,
} from '../src/types/observability.js';

function makeEvent<T extends { type: string; requestId: string; timestamp: number }>(partial: T): T {
  return { ...partial } as T;
}

describe('DevToolsDashboard', () => {
  let hooks: ClientHooks;
  let dashboard: DevToolsDashboard;

  beforeEach(() => {
    hooks = new ClientHooks();
    dashboard = new DevToolsDashboard({ throughputIntervalMs: 60_000 });
    vi.useFakeTimers();
  });

  afterEach(() => {
    dashboard.detach();
    vi.useRealTimers();
  });

  it('creates with default config', () => {
    const d = new DevToolsDashboard();
    expect(d).toBeDefined();
  });

  it('creates with custom config', () => {
    const d = new DevToolsDashboard({ maxTimelineEntries: 10, maxRoutingEntries: 5 });
    expect(d).toBeDefined();
  });

  describe('instrument / detach', () => {
    it('instruments hooks and receives events', () => {
      dashboard.instrument(hooks);

      hooks.emit(makeEvent<RequestStartEvent>({
        type: 'request.start', requestId: 'r1', timestamp: Date.now(),
      }));
      hooks.emit(makeEvent<RequestCompletedEvent>({
        type: 'request.completed', requestId: 'r1', timestamp: Date.now(),
        provider: 'openai', model: 'gpt-4', durationMs: 100, attempts: 1,
        inputTokens: 10, outputTokens: 20, structuredOutput: false,
      }));

      const s = dashboard.snapshot();
      expect(s.summary.totalRequests).toBe(1);
      expect(s.summary.completedRequests).toBe(1);
    });

    it('detach stops receiving events', () => {
      dashboard.instrument(hooks);
      dashboard.detach();

      hooks.emit(makeEvent<RequestStartEvent>({
        type: 'request.start', requestId: 'r1', timestamp: Date.now(),
      }));

      const s = dashboard.snapshot();
      expect(s.summary.totalRequests).toBe(0);
    });

    it('re-instrument replaces previous hooks', () => {
      const hooks2 = new ClientHooks();
      dashboard.instrument(hooks);
      dashboard.instrument(hooks2);

      hooks.emit(makeEvent<RequestStartEvent>({
        type: 'request.start', requestId: 'r1', timestamp: Date.now(),
      }));

      const s = dashboard.snapshot();
      expect(s.summary.activeRequests).toBe(0);

      hooks2.emit(makeEvent<RequestStartEvent>({
        type: 'request.start', requestId: 'r2', timestamp: Date.now(),
      }));

      const s2 = dashboard.snapshot();
      expect(s2.summary.activeRequests).toBe(1);
    });
  });

  describe('request lifecycle', () => {
    beforeEach(() => dashboard.instrument(hooks));

    it('tracks pending requests', () => {
      hooks.emit(makeEvent<RequestStartEvent>({
        type: 'request.start', requestId: 'r1', timestamp: Date.now(),
        provider: 'openai', model: 'gpt-4',
      }));

      const s = dashboard.snapshot();
      expect(s.summary.activeRequests).toBe(1);
      expect(s.summary.totalRequests).toBe(0);
    });

    it('tracks completed requests', () => {
      hooks.emit(makeEvent<RequestStartEvent>({
        type: 'request.start', requestId: 'r1', timestamp: Date.now(),
      }));
      hooks.emit(makeEvent<RequestCompletedEvent>({
        type: 'request.completed', requestId: 'r1', timestamp: Date.now(),
        provider: 'openai', model: 'gpt-4', durationMs: 150, attempts: 1,
        inputTokens: 100, outputTokens: 50, structuredOutput: false,
      }));

      const s = dashboard.snapshot();
      expect(s.summary.activeRequests).toBe(0);
      expect(s.summary.completedRequests).toBe(1);
      expect(s.summary.totalTokens).toBe(150);
      expect(s.summary.avgLatencyMs).toBe(150);
    });

    it('tracks failed requests', () => {
      hooks.emit(makeEvent<RequestStartEvent>({
        type: 'request.start', requestId: 'r1', timestamp: Date.now(),
      }));
      hooks.emit(makeEvent<RequestFailedEvent>({
        type: 'request.failed', requestId: 'r1', timestamp: Date.now(),
        provider: 'openai', model: 'gpt-4', durationMs: 200, attempts: 3,
        error: 'rate limited',
      }));

      const s = dashboard.snapshot();
      expect(s.summary.failedRequests).toBe(1);
      expect(s.summary.errorRate).toBe(1);
    });

    it('calculates error rate correctly', () => {
      hooks.emit(makeEvent<RequestStartEvent>({
        type: 'request.start', requestId: 'r1', timestamp: Date.now(),
      }));
      hooks.emit(makeEvent<RequestCompletedEvent>({
        type: 'request.completed', requestId: 'r1', timestamp: Date.now(),
        provider: 'openai', model: 'gpt-4', durationMs: 100, attempts: 1, structuredOutput: false,
      }));
      hooks.emit(makeEvent<RequestStartEvent>({
        type: 'request.start', requestId: 'r2', timestamp: Date.now(),
      }));
      hooks.emit(makeEvent<RequestFailedEvent>({
        type: 'request.failed', requestId: 'r2', timestamp: Date.now(),
        provider: 'openai', model: 'gpt-4', durationMs: 200, attempts: 1, error: 'fail',
      }));

      const s = dashboard.snapshot();
      expect(s.summary.errorRate).toBe(0.5);
    });
  });

  describe('latency percentiles', () => {
    beforeEach(() => dashboard.instrument(hooks));

    it('calculates p95 and p99', () => {
      for (let i = 0; i < 100; i++) {
        hooks.emit(makeEvent<RequestStartEvent>({
          type: 'request.start', requestId: `r${i}`, timestamp: Date.now(),
        }));
        hooks.emit(makeEvent<RequestCompletedEvent>({
          type: 'request.completed', requestId: `r${i}`, timestamp: Date.now(),
          provider: 'openai', model: 'gpt-4', durationMs: i + 1, attempts: 1, structuredOutput: false,
        }));
      }

      const s = dashboard.snapshot();
      expect(s.summary.avgLatencyMs).toBe(50.5);
      expect(s.summary.p95LatencyMs).toBe(96);
      expect(s.summary.p99LatencyMs).toBe(100);
    });
  });

  describe('TTFT tracking', () => {
    beforeEach(() => dashboard.instrument(hooks));

    it('tracks time to first chunk', () => {
      hooks.emit(makeEvent<StreamFirstChunkEvent>({
        type: 'stream.first_chunk', requestId: 'r1', timestamp: Date.now(), latencyMs: 42,
      }));
      hooks.emit(makeEvent<StreamFirstChunkEvent>({
        type: 'stream.first_chunk', requestId: 'r2', timestamp: Date.now(), latencyMs: 58,
      }));

      const s = dashboard.snapshot();
      expect(s.summary.avgTtftMs).toBe(50);
    });
  });

  describe('routing decisions', () => {
    beforeEach(() => dashboard.instrument(hooks));

    it('tracks routing decisions', () => {
      hooks.emit(makeEvent<RoutingResolvedEvent>({
        type: 'routing.resolved', requestId: 'r1', timestamp: Date.now(),
        provider: 'openai', model: 'gpt-4', score: 85, reasons: ['best fit'],
      }));
      hooks.emit(makeEvent<RoutingResolvedEvent>({
        type: 'routing.resolved', requestId: 'r2', timestamp: Date.now(),
        provider: 'anthropic', model: 'claude-3', score: 72, reasons: ['fallback'],
      }));

      const s = dashboard.snapshot();
      expect(s.routingDecisions).toHaveLength(2);
      expect(s.routingDecisions[0].provider).toBe('openai');
      expect(s.routingDecisions[1].provider).toBe('anthropic');
    });

    it('aggregates routing stats by model', () => {
      for (let i = 0; i < 5; i++) {
        hooks.emit(makeEvent<RoutingResolvedEvent>({
          type: 'routing.resolved', requestId: `r${i}`, timestamp: Date.now(),
          provider: 'openai', model: 'gpt-4', score: 80 + i, reasons: [],
        }));
      }

      const s = dashboard.snapshot();
      expect(s.routingDecisions).toHaveLength(1);
      expect(s.routingDecisions[0].totalDecisions).toBe(5);
      expect(s.routingDecisions[0].avgScore).toBe(82);
    });
  });

  describe('retry tracking', () => {
    beforeEach(() => dashboard.instrument(hooks));

    it('tracks retries', () => {
      hooks.emit(makeEvent<RetryEvent>({
        type: 'request.retrying', requestId: 'r1', timestamp: Date.now(),
        provider: 'openai', attempt: 1, delayMs: 1000, reason: 'rate limit',
      }));

      const s = dashboard.snapshot();
      expect(s.recentRetries).toHaveLength(1);
      expect(s.recentRetries[0].reason).toBe('rate limit');
    });
  });

  describe('fallback tracking', () => {
    beforeEach(() => dashboard.instrument(hooks));

    it('tracks fallbacks', () => {
      hooks.emit(makeEvent<FallbackEvent>({
        type: 'fallback.started', requestId: 'r1', timestamp: Date.now(),
        originalProvider: 'openai', originalModel: 'gpt-4',
        fallbackProvider: 'anthropic', fallbackModel: 'claude-3',
      }));

      const s = dashboard.snapshot();
      expect(s.recentFallbacks).toHaveLength(1);
      expect(s.recentFallbacks[0].fallbackProvider).toBe('anthropic');
    });
  });

  describe('validation failure tracking', () => {
    beforeEach(() => dashboard.instrument(hooks));

    it('tracks validation failures', () => {
      hooks.emit(makeEvent<ValidationFailEvent>({
        type: 'structured.validate.fail', requestId: 'r1', timestamp: Date.now(),
        attempt: 2, error: 'missing required field',
      }));

      const s = dashboard.snapshot();
      expect(s.recentValidationFails).toHaveLength(1);
      expect(s.recentValidationFails[0].attempt).toBe(2);
    });
  });

  describe('circuit breaker states', () => {
    it('reads from registry in snapshot', () => {
      dashboard.instrument(hooks);

      const s = dashboard.snapshot(undefined, {
        getAllStats: () => ({
          openai: { state: 'closed', failureCount: 2, successCount: 10, totalCalls: 12, totalFailures: 2, totalSuccesses: 10 },
          anthropic: { state: 'open', failureCount: 5, successCount: 0, totalCalls: 5, totalFailures: 5, totalSuccesses: 0 },
        }),
      });

      expect(s.circuitBreakerStates.openai.state).toBe('closed');
      expect(s.circuitBreakerStates.anthropic.state).toBe('open');
      expect(s.providers).toHaveLength(2);
    });
  });

  describe('cost tracking', () => {
    it('reads from cost tracker in snapshot', () => {
      dashboard.instrument(hooks);

      const s = dashboard.snapshot({
        report: () => ({
          totalActual: 1.5,
          totalReserved: 0.3,
          committedCost: 1.8,
          remainingBudget: 3.2,
          budgetExceeded: false,
          byProvider: { openai: { estimated: 1.0, actual: 1.5, requests: 5 } },
          byPhase: { estimate: 0.5, execute: 1.0 },
        }),
      });

      expect(s.cost.totalCost).toBe(1.5);
      expect(s.cost.remainingBudget).toBe(3.2);
      expect(s.cost.byProvider.openai.actual).toBe(1.5);
    });
  });

  describe('timeline limits', () => {
    it('respects maxTimelineEntries', () => {
      const d = new DevToolsDashboard({ maxTimelineEntries: 3, throughputIntervalMs: 60_000 });
      d.instrument(hooks);

      for (let i = 0; i < 5; i++) {
        hooks.emit(makeEvent<RequestStartEvent>({
          type: 'request.start', requestId: `r${i}`, timestamp: Date.now(),
        }));
        hooks.emit(makeEvent<RequestCompletedEvent>({
          type: 'request.completed', requestId: `r${i}`, timestamp: Date.now(),
          provider: 'openai', model: 'gpt-4', durationMs: 100, attempts: 1, structuredOutput: false,
        }));
      }

      const s = d.snapshot();
      expect(s.recentRequests).toHaveLength(3);
      expect(s.recentRequests[0].requestId).toBe('r2');
      d.detach();
    });

    it('respects maxRoutingEntries', () => {
      const d = new DevToolsDashboard({ maxRoutingEntries: 2, throughputIntervalMs: 60_000 });
      d.instrument(hooks);

      for (let i = 0; i < 5; i++) {
        hooks.emit(makeEvent<RoutingResolvedEvent>({
          type: 'routing.resolved', requestId: `r${i}`, timestamp: Date.now(),
          provider: 'openai', model: 'gpt-4', score: 80, reasons: [],
        }));
      }

      const s = d.snapshot();
      expect(s.recentRouting).toHaveLength(2);
      d.detach();
    });
  });

  describe('onUpdate', () => {
    it('notifies listeners on events', () => {
      dashboard.instrument(hooks);
      const listener = vi.fn();
      dashboard.onUpdate(listener);

      hooks.emit(makeEvent<RequestStartEvent>({
        type: 'request.start', requestId: 'r1', timestamp: Date.now(),
      }));

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        summary: expect.objectContaining({ activeRequests: 1 }),
      }));
    });

    it('unsubscribe stops notifications', () => {
      dashboard.instrument(hooks);
      const listener = vi.fn();
      const unsub = dashboard.onUpdate(listener);

      hooks.emit(makeEvent<RequestStartEvent>({
        type: 'request.start', requestId: 'r1', timestamp: Date.now(),
      }));
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      hooks.emit(makeEvent<RequestStartEvent>({
        type: 'request.start', requestId: 'r2', timestamp: Date.now(),
      }));
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('swallows listener errors', () => {
      dashboard.instrument(hooks);
      dashboard.onUpdate(() => { throw new Error('boom'); });

      expect(() => {
        hooks.emit(makeEvent<RequestStartEvent>({
          type: 'request.start', requestId: 'r1', timestamp: Date.now(),
        }));
      }).not.toThrow();
    });
  });

  describe('renderText', () => {
    it('renders dashboard text', () => {
      dashboard.instrument(hooks);

      hooks.emit(makeEvent<RequestStartEvent>({
        type: 'request.start', requestId: 'r1', timestamp: Date.now(),
      }));
      hooks.emit(makeEvent<RequestCompletedEvent>({
        type: 'request.completed', requestId: 'r1', timestamp: Date.now(),
        provider: 'openai', model: 'gpt-4', durationMs: 120, attempts: 1,
        inputTokens: 50, outputTokens: 30, structuredOutput: false,
      }));

      const text = dashboard.renderText();
      expect(text).toContain('HILBRAS SDK DEVTOOLS');
      expect(text).toContain('SUMMARY');
      expect(text).toContain('120ms');
    });

    it('renders provider health', () => {
      dashboard.instrument(hooks);

      const text = dashboard.renderText({
        timestamp: Date.now(),
        summary: { totalRequests: 1, activeRequests: 0, completedRequests: 1, failedRequests: 0, errorRate: 0, avgLatencyMs: 100, p95LatencyMs: 100, p99LatencyMs: 100, avgTtftMs: 0, totalTokens: 0, totalCost: 0, remainingBudget: null },
        providers: [{ provider: 'openai', state: 'closed', failureCount: 0, successCount: 10, totalCalls: 10, totalFailures: 0, totalSuccesses: 10, last5minErrorRate: 0, last5minRequestCount: 5 }],
        cost: { totalCost: 0, totalReserved: 0, committedCost: 0, remainingBudget: null, budgetExceeded: false, byProvider: {}, byPhase: {} },
        recentRequests: [],
        recentRouting: [],
        recentRetries: [],
        recentFallbacks: [],
        recentValidationFails: [],
        throughput: [],
        circuitBreakerStates: {},
        routingDecisions: [],
      });

      expect(text).toContain('PROVIDER HEALTH');
      expect(text).toContain('openai');
      expect(text).toContain('closed');
    });

    it('renders cost breakdown', () => {
      const text = dashboard.renderText({
        timestamp: Date.now(),
        summary: { totalRequests: 0, activeRequests: 0, completedRequests: 0, failedRequests: 0, errorRate: 0, avgLatencyMs: 0, p95LatencyMs: 0, p99LatencyMs: 0, avgTtftMs: 0, totalTokens: 0, totalCost: 1.5, remainingBudget: 3.2, budgetExceeded: false },
        providers: [],
        cost: { totalCost: 1.5, totalReserved: 0.3, committedCost: 1.8, remainingBudget: 3.2, budgetExceeded: false, byProvider: { openai: { estimated: 1.0, actual: 1.5, requests: 5 } }, byPhase: { estimate: 0.5, execute: 1.0 } },
        recentRequests: [],
        recentRouting: [],
        recentRetries: [],
        recentFallbacks: [],
        recentValidationFails: [],
        throughput: [],
        circuitBreakerStates: {},
        routingDecisions: [],
      });

      expect(text).toContain('COST BY PROVIDER');
      expect(text).toContain('openai');
      expect(text).toContain('$1.5000');
    });

    it('renders routing decisions', () => {
      const text = dashboard.renderText({
        timestamp: Date.now(),
        summary: { totalRequests: 0, activeRequests: 0, completedRequests: 0, failedRequests: 0, errorRate: 0, avgLatencyMs: 0, p95LatencyMs: 0, p99LatencyMs: 0, avgTtftMs: 0, totalTokens: 0, totalCost: 0, remainingBudget: null, budgetExceeded: false },
        providers: [],
        cost: { totalCost: 0, totalReserved: 0, committedCost: 0, remainingBudget: null, budgetExceeded: false, byProvider: {}, byPhase: {} },
        recentRequests: [],
        recentRouting: [],
        recentRetries: [],
        recentFallbacks: [],
        recentValidationFails: [],
        throughput: [],
        circuitBreakerStates: {},
        routingDecisions: [{ provider: 'openai', model: 'gpt-4', avgScore: 85, totalDecisions: 10, successRate: 0.9 }],
      });

      expect(text).toContain('ROUTING DECISIONS');
      expect(text).toContain('openai/gpt-4');
      expect(text).toContain('85');
    });

    it('renders retries', () => {
      const text = dashboard.renderText({
        timestamp: Date.now(),
        summary: { totalRequests: 0, activeRequests: 0, completedRequests: 0, failedRequests: 0, errorRate: 0, avgLatencyMs: 0, p95LatencyMs: 0, p99LatencyMs: 0, avgTtftMs: 0, totalTokens: 0, totalCost: 0, remainingBudget: null, budgetExceeded: false },
        providers: [],
        cost: { totalCost: 0, totalReserved: 0, committedCost: 0, remainingBudget: null, budgetExceeded: false, byProvider: {}, byPhase: {} },
        recentRequests: [],
        recentRouting: [],
        recentRetries: [{ requestId: 'r1', provider: 'openai', attempt: 2, delayMs: 1000, reason: 'rate limit', timestamp: Date.now() }],
        recentFallbacks: [],
        recentValidationFails: [],
        throughput: [],
        circuitBreakerStates: {},
        routingDecisions: [],
      });

      expect(text).toContain('RECENT RETRIES');
      expect(text).toContain('rate limit');
    });

    it('renders fallbacks', () => {
      const text = dashboard.renderText({
        timestamp: Date.now(),
        summary: { totalRequests: 0, activeRequests: 0, completedRequests: 0, failedRequests: 0, errorRate: 0, avgLatencyMs: 0, p95LatencyMs: 0, p99LatencyMs: 0, avgTtftMs: 0, totalTokens: 0, totalCost: 0, remainingBudget: null, budgetExceeded: false },
        providers: [],
        cost: { totalCost: 0, totalReserved: 0, committedCost: 0, remainingBudget: null, budgetExceeded: false, byProvider: {}, byPhase: {} },
        recentRequests: [],
        recentRouting: [],
        recentRetries: [],
        recentFallbacks: [{ requestId: 'r1', originalProvider: 'openai', originalModel: 'gpt-4', fallbackProvider: 'anthropic', fallbackModel: 'claude-3', timestamp: Date.now() }],
        recentValidationFails: [],
        throughput: [],
        circuitBreakerStates: {},
        routingDecisions: [],
      });

      expect(text).toContain('RECENT FALLBACKS');
      expect(text).toContain('openai/gpt-4');
      expect(text).toContain('anthropic/claude-3');
    });

    it('renders validation failures', () => {
      const text = dashboard.renderText({
        timestamp: Date.now(),
        summary: { totalRequests: 0, activeRequests: 0, completedRequests: 0, failedRequests: 0, errorRate: 0, avgLatencyMs: 0, p95LatencyMs: 0, p99LatencyMs: 0, avgTtftMs: 0, totalTokens: 0, totalCost: 0, remainingBudget: null, budgetExceeded: false },
        providers: [],
        cost: { totalCost: 0, totalReserved: 0, committedCost: 0, remainingBudget: null, budgetExceeded: false, byProvider: {}, byPhase: {} },
        recentRequests: [],
        recentRouting: [],
        recentRetries: [],
        recentFallbacks: [],
        recentValidationFails: [{ requestId: 'r1', attempt: 2, error: 'missing field', timestamp: Date.now() }],
        throughput: [],
        circuitBreakerStates: {},
        routingDecisions: [],
      });

      expect(text).toContain('VALIDATION FAILURES');
      expect(text).toContain('missing field');
    });
  });

  describe('exportJson', () => {
    it('exports valid JSON', () => {
      dashboard.instrument(hooks);

      hooks.emit(makeEvent<RequestStartEvent>({
        type: 'request.start', requestId: 'r1', timestamp: Date.now(),
      }));

      const json = dashboard.exportJson();
      const parsed = JSON.parse(json);
      expect(parsed.summary).toBeDefined();
      expect(parsed.timestamp).toBeDefined();
    });
  });

  describe('clear', () => {
    it('resets all state', () => {
      dashboard.instrument(hooks);

      hooks.emit(makeEvent<RequestStartEvent>({
        type: 'request.start', requestId: 'r1', timestamp: Date.now(),
      }));
      hooks.emit(makeEvent<RequestCompletedEvent>({
        type: 'request.completed', requestId: 'r1', timestamp: Date.now(),
        provider: 'openai', model: 'gpt-4', durationMs: 100, attempts: 1, structuredOutput: false,
      }));

      dashboard.clear();
      const s = dashboard.snapshot();
      expect(s.summary.totalRequests).toBe(0);
      expect(s.summary.completedRequests).toBe(0);
    });
  });

  describe('throughput sampling', () => {
    it('samples throughput on interval', () => {
      dashboard = new DevToolsDashboard({ throughputIntervalMs: 5000, maxThroughputSamples: 3 });
      dashboard.instrument(hooks);

      // Simulate some completed requests
      for (let i = 0; i < 3; i++) {
        hooks.emit(makeEvent<RequestStartEvent>({
          type: 'request.start', requestId: `r${i}`, timestamp: Date.now(),
        }));
        hooks.emit(makeEvent<RequestCompletedEvent>({
          type: 'request.completed', requestId: `r${i}`, timestamp: Date.now(),
          provider: 'openai', model: 'gpt-4', durationMs: 100, attempts: 1, structuredOutput: false,
        }));
      }

      // Advance time to trigger sampling
      vi.advanceTimersByTime(5000);

      const s = dashboard.snapshot();
      expect(s.throughput.length).toBeGreaterThan(0);
    });
  });
});
