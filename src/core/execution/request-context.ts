/**
 * Internal request context contracts for the execution subsystem.
 *
 * This module deliberately has no dependency on HilbrasClient or the root
 * barrel. It is an internal boundary until the v3.2 execution migration has
 * completed and public API stability has been reviewed.
 */

import type { BudgetConfig } from "../../cost/types.js";
import type { ResolvedPolicy } from "../../types/policy.js";
import type { RoutingResult } from "../../types/router.js";

/** Operations handled by the execution subsystem. */
export type RequestOperation =
  | "stream"
  | "complete"
  | "embed"
  | "image"
  | "speech"
  | "transcribe"
  | "rerank";

/** The role of a candidate within one logical request. */
export type RequestPhase = "primary" | "retry" | "fallback";

/** Fields supplied when a logical request is created. */
export interface RequestContextInit {
  requestId: string;
  operation: RequestOperation;
  provider: string;
  model: string;
  policy: ResolvedPolicy;
  budget?: BudgetConfig;
  callerSignal?: AbortSignal;
  executionSignal?: AbortSignal;
  metadata?: Record<string, unknown>;
  routing?: RoutingResult;
  attempt?: number;
  phase?: RequestPhase;
  startedAt?: number;
}

/** Internal state shared by all attempts for one logical request. */
export interface RequestContext {
  requestId: string;
  operation: RequestOperation;
  provider: string;
  model: string;
  policy: ResolvedPolicy;
  retry: ResolvedPolicy["retry"];
  timeout: ResolvedPolicy["timeout"];
  circuitBreaker: ResolvedPolicy["circuitBreaker"];
  budget?: BudgetConfig;
  callerSignal?: AbortSignal;
  executionSignal?: AbortSignal;
  metadata: Record<string, unknown>;
  routing?: RoutingResult;
  attempt: number;
  phase: RequestPhase;
  startedAt: number;
}

/** Create the initial context for a resolved provider/model pair. */
export function createRequestContext(init: RequestContextInit): RequestContext {
  return {
    requestId: init.requestId,
    operation: init.operation,
    provider: init.provider,
    model: init.model,
    policy: init.policy,
    retry: init.policy.retry,
    timeout: init.policy.timeout,
    circuitBreaker: init.policy.circuitBreaker,
    budget: init.budget,
    callerSignal: init.callerSignal,
    executionSignal: init.executionSignal,
    metadata: { ...(init.metadata ?? {}) },
    routing: init.routing,
    attempt: init.attempt ?? 0,
    phase: init.phase ?? "primary",
    startedAt: init.startedAt ?? Date.now(),
  };
}

/** Derive an attempt context without mutating the logical request context. */
export function deriveRequestContext(
  context: RequestContext,
  changes: Partial<Pick<RequestContext, "provider" | "model" | "executionSignal" | "routing" | "attempt" | "phase" | "metadata">>,
): RequestContext {
  return {
    ...context,
    ...changes,
    metadata: changes.metadata
      ? { ...context.metadata, ...changes.metadata }
      : context.metadata,
  };
}

/** Minimal, non-sensitive projection suitable for telemetry adapters. */
export interface TelemetryRequestContext {
  requestId: string;
  operation: RequestOperation;
  provider: string;
  model: string;
  attempt: number;
  phase: RequestPhase;
}

export function toTelemetryContext(context: RequestContext): TelemetryRequestContext {
  return {
    requestId: context.requestId,
    operation: context.operation,
    provider: context.provider,
    model: context.model,
    attempt: context.attempt,
    phase: context.phase,
  };
}
