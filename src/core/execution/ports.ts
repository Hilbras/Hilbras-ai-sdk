/**
 * Narrow dependency ports for the internal execution layer.
 *
 * These interfaces keep the execution subsystem independent of HilbrasClient,
 * concrete registries, transports, and test doubles.
 */

import type { GenerateParams, AIProvider } from "../../types/adapter.js";
import type { ExecutionPolicy, ResolvedPolicy } from "../../types/policy.js";
import type { StreamChunk } from "../../types/streams.js";

export interface PolicyPort {
  resolve(policy?: ExecutionPolicy): ResolvedPolicy;
}

export interface CircuitBreakerPort {
  readonly stats: { failureCount: number };
  isAvailable(): boolean;
  recordSuccess(): void;
  recordFailure(error?: Error): void;
}

export interface CircuitBreakerRegistryPort {
  getOrCreate(provider: string, config: ResolvedPolicy["circuitBreaker"]): CircuitBreakerPort;
}

export interface AdapterPort extends Pick<AIProvider, "id"> {
  stream(params: GenerateParams): AsyncGenerator<StreamChunk>;
  complete(params: GenerateParams): Promise<string>;
}

export interface AdapterRegistryPort {
  get(provider: string): AdapterPort | undefined;
}

export interface BudgetPort {
  estimate(model: string, provider: string, inputTokens: number, outputTokens: number): number;
  reserve(requestId: string, estimatedCost: number): unknown;
  settle(requestId: string, actualCost: number, metadata: { provider: string; model: string; phase: string }): void;
  release(requestId: string): void;
  report(): { remainingBudget: number | null };
}

export interface ClockPort {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface ExecutionPorts {
  policy: PolicyPort;
  circuitBreakers: CircuitBreakerRegistryPort;
  adapters: AdapterRegistryPort;
  budget?: BudgetPort;
  clock?: ClockPort;
}
