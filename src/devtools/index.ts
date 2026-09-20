/**
 * @hilbras/sdk — DevTools Visual Debugging Interface
 *
 * Logs detailed information about LLM calls for debugging.
 * Tracks input/output, token usage, timing, cost, tool calls,
 * and provider details in a structured format.
 */

export { DevToolsDashboard } from './dashboard.js';
export type {
  DashboardConfig,
  DashboardSnapshot,
  RequestTimelineEntry,
  ProviderHealth,
  CostSnapshot,
  RoutingDecision,
  ThroughputSample,
} from './dashboard.js';

export interface DevToolsConfig {
  logLevel?: "minimal" | "detailed" | "verbose";
  maxHistory?: number;
  console?: boolean;
  logger?: (entry: LogEntry) => void;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  type: "request" | "response" | "tool_call" | "error" | "performance";
  provider?: string;
  model?: string;
  input?: string;
  output?: string;
  usage?: { input: number; output: number; total: number };
  cost?: number;
  durationMs?: number;
  ttftMs?: number;
  tokensPerSecond?: number;
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; result?: unknown }>;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface RequestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalTokens: number;
  totalCost: number;
  averageDurationMs: number;
  averageTTFTMs: number;
  averageTokensPerSecond: number;
  byProvider: Record<string, { requests: number; tokens: number; cost: number }>;
  byModel: Record<string, { requests: number; tokens: number; cost: number }>;
}

export class DevTools {
  private _config: Required<DevToolsConfig>;
  private _history: LogEntry[] = [];
  private _activeRequests = new Map<string, { start: number; firstChunk?: number }>();

  constructor(config: DevToolsConfig = {}) {
    this._config = { logLevel: "detailed", maxHistory: 100, console: true, logger: () => {}, ...config };
  }

  onRequestStart(event: { requestId: string; provider?: string; model?: string; input?: string }): void {
    this._activeRequests.set(event.requestId, { start: performance.now() });
    if (this._config.logLevel === "verbose") {
      this._addToHistory({ id: event.requestId, timestamp: Date.now(), type: "request", provider: event.provider, model: event.model, input: this._truncate(event.input, 200) });
    }
  }

  onRequestChunk(event: { requestId: string }): void {
    const active = this._activeRequests.get(event.requestId);
    if (active && !active.firstChunk) active.firstChunk = performance.now();
  }

  onRequestComplete(event: {
    requestId: string; provider?: string; model?: string; input?: string;
    output?: string; usage?: { input: number; output: number; total: number };
    cost?: number; error?: string;
    toolCalls?: Array<{ name: string; args: Record<string, unknown>; result?: unknown }>;
  }): void {
    const active = this._activeRequests.get(event.requestId);
    const durationMs = active ? performance.now() - active.start : 0;
    const ttftMs = active?.firstChunk ? active.firstChunk - active.start : undefined;
    const tokensPerSecond = event.usage?.output && durationMs > 0 ? (event.usage.output / durationMs) * 1000 : undefined;

    const entry: LogEntry = {
      id: event.requestId, timestamp: Date.now(), type: event.error ? "error" : "response",
      provider: event.provider, model: event.model,
      input: this._truncate(event.input, this._config.logLevel === "minimal" ? 50 : 200),
      output: this._truncate(event.output, 500), usage: event.usage, cost: event.cost,
      durationMs: Math.round(durationMs), ttftMs: ttftMs ? Math.round(ttftMs) : undefined,
      tokensPerSecond: tokensPerSecond ? Math.round(tokensPerSecond) : undefined,
      toolCalls: event.toolCalls, error: event.error,
    };

    this._addToHistory(entry);
    this._activeRequests.delete(event.requestId);
    if (this._config.console) this._printEntry(entry);
    this._config.logger(entry);
  }

  getMetrics(): RequestMetrics {
    const entries = this._history.filter((e) => e.type === "response" || e.type === "error");
    const successful = entries.filter((e) => !e.error);
    const byProvider: Record<string, { requests: number; tokens: number; cost: number }> = {};
    const byModel: Record<string, { requests: number; tokens: number; cost: number }> = {};
    let totalTokens = 0, totalCost = 0, totalDuration = 0, totalTTFT = 0, totalTokensPerSecond = 0, ttftCount = 0, tpsCount = 0;

    for (const entry of entries) {
      if (entry.provider) {
        if (!byProvider[entry.provider]) byProvider[entry.provider] = { requests: 0, tokens: 0, cost: 0 };
        byProvider[entry.provider].requests++; byProvider[entry.provider].tokens += entry.usage?.total ?? 0; byProvider[entry.provider].cost += entry.cost ?? 0;
      }
      if (entry.model) {
        if (!byModel[entry.model]) byModel[entry.model] = { requests: 0, tokens: 0, cost: 0 };
        byModel[entry.model].requests++; byModel[entry.model].tokens += entry.usage?.total ?? 0; byModel[entry.model].cost += entry.cost ?? 0;
      }
      totalTokens += entry.usage?.total ?? 0; totalCost += entry.cost ?? 0; totalDuration += entry.durationMs ?? 0;
      if (entry.ttftMs) { totalTTFT += entry.ttftMs; ttftCount++; }
      if (entry.tokensPerSecond) { totalTokensPerSecond += entry.tokensPerSecond; tpsCount++; }
    }

    return {
      totalRequests: entries.length, successfulRequests: successful.length, failedRequests: entries.length - successful.length,
      totalTokens, totalCost,
      averageDurationMs: entries.length ? Math.round(totalDuration / entries.length) : 0,
      averageTTFTMs: ttftCount ? Math.round(totalTTFT / ttftCount) : 0,
      averageTokensPerSecond: tpsCount ? Math.round(totalTokensPerSecond / tpsCount) : 0,
      byProvider, byModel,
    };
  }

  getHistory(): LogEntry[] { return [...this._history]; }
  clear(): void { this._history = []; this._activeRequests.clear(); }
  export(): string { return JSON.stringify({ history: this._history, metrics: this.getMetrics(), exportedAt: new Date().toISOString() }, null, 2); }

  private _addToHistory(entry: LogEntry): void {
    this._history.push(entry);
    if (this._history.length > this._config.maxHistory) this._history.shift();
  }

  private _truncate(text: string | undefined, max: number): string {
    if (!text) return "";
    return text.length > max ? text.slice(0, max) + "…" : text;
  }

  private _printEntry(entry: LogEntry): void {
    const prefix = entry.type === "error" ? "✗" : entry.type === "request" ? "→" : "←";
    const model = entry.model ? ` (${entry.provider}/${entry.model})` : "";
    const usage = entry.usage ? ` [${entry.usage.total} tokens]` : "";
    const cost = entry.cost ? ` [$${entry.cost.toFixed(4)}]` : "";
    const duration = entry.durationMs ? ` ${entry.durationMs}ms` : "";
    const ttft = entry.ttftMs ? ` TTFT: ${entry.ttftMs}ms` : "";
    console.log(`${prefix}${model}${usage}${cost}${duration}${ttft}`);
    if (entry.output && this._config.logLevel === "verbose") console.log(`  Output: ${this._truncate(entry.output, 200)}`);
    if (entry.toolCalls?.length) console.log(`  Tools: ${entry.toolCalls.map((t) => t.name).join(", ")}`);
    if (entry.error) console.log(`  Error: ${entry.error}`);
  }
}
