/**
 * Internal execution result contracts.
 *
 * Failures retain the original error object so existing public error identity,
 * status, and context behavior remain unchanged when this boundary is used.
 */

import type { RequestContext } from "./request-context.js";

export type ExecutionResult<T> =
  | { ok: true; value: T; context: RequestContext }
  | { ok: false; error: unknown; context: RequestContext };

export function executionSuccess<T>(value: T, context: RequestContext): ExecutionResult<T> {
  return { ok: true, value, context };
}

export function executionFailure(error: unknown, context: RequestContext): ExecutionResult<never> {
  return { ok: false, error, context };
}
