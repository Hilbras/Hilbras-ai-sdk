/**
 * Logical-request pipeline for non-streaming complete operations.
 *
 * The pipeline owns the request lifecycle, budget reservation, retry/fallback
 * decision, and terminal events. Provider invocation remains one attempt at a
 * time inside RequestExecutor.
 */

import { CircuitBreakerOpenError, ConfigurationError, ValidationError } from "../../errors/index.js";
import { calculateBackoff } from "../../reliability/backoff.js";
import { buildJsonSystemInstruction, buildRepairPrompt, extractJson } from "../../output/structured.js";
import { shouldRetry, shouldRetryNetworkError } from "../../reliability/retry.js";
import type { HookEvent } from "../../types/observability.js";
import type { GenerateParams } from "../../types/adapter.js";
import type { ExecutionPolicy } from "../../types/policy.js";
import type { StructuredOutputConfig } from "../../types/schema.js";
import type { Message } from "../../types/messages.js";
import type {
  PluginErrorContext,
  PluginRequestContext,
  PluginResponseContext,
} from "../../plugin/types.js";
import { RequestExecutor, type RequestPreparationInput } from "./request-executor.js";
import type { RequestOperation } from "./request-context.js";
import type { BudgetPort } from "./ports.js";

export interface PipelinePluginPort {
  fireRequest(context: PluginRequestContext): Promise<void>;
  fireResponse(context: PluginResponseContext): Promise<void>;
  fireError(context: PluginErrorContext): Promise<void>;
}

export interface RequestPipelinePorts {
  executor: RequestExecutor;
  budget: BudgetPort;
  plugins: PipelinePluginPort;
  emit(event: HookEvent): void;
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  onCircuitOpen?(requestId: string, provider: string): void;
}

export interface FallbackCandidate {
  provider: string;
  model: string;
}

export interface CompletePipelineInput {
  requestId: string;
  startTime: number;
  provider: string;
  model: string;
  messages: Message[];
  params: Omit<GenerateParams, "signal">;
  estimatedCost: number;
  policy?: ExecutionPolicy;
  providerTimeoutMs?: number;
  callerSignal?: AbortSignal;
  fallbackCandidates(excludeModels: string[]): FallbackCandidate[];
  estimateFallbackCost(candidate: FallbackCandidate): number;
  getProviderTimeout(provider: string): number | undefined;
}

export interface StreamPipelineInput extends Omit<CompletePipelineInput, "params"> {
  params: Omit<GenerateParams, "signal">;
}

export interface StructuredCompletePipelineInput extends Omit<CompletePipelineInput, "params"> {
  params: Omit<GenerateParams, "signal">;
  output: StructuredOutputConfig<unknown>;
  jsonModeParams?(provider: string): Record<string, unknown>;
}

export class RequestPipeline {
  constructor(private readonly ports: RequestPipelinePorts) {}

  async runComplete(input: CompletePipelineInput): Promise<string> {
    let prepared: ReturnType<RequestExecutor["prepare"]>;
    try {
      prepared = this.prepare(input);
    } catch (error) {
      throw error;
    }

    try {
      await this.ports.plugins.fireRequest({
        requestId: input.requestId,
        provider: input.provider,
        model: input.model,
        messages: input.messages,
        extra: input.params.extra,
        signal: input.callerSignal,
        timestamp: this.ports.now(),
      });

      const reservation = this.ports.budget.reserve(input.requestId, input.estimatedCost);
      if (!reservation) {
        const remaining = this.ports.budget.report().remainingBudget;
        throw new ConfigurationError(
          `Budget reservation rejected — estimated cost $${input.estimatedCost.toFixed(4)} would exceed budget`,
          `Remaining budget: $${remaining?.toFixed(4) ?? "unknown"}. Options: (1) increase sessionBudget, (2) use a cheaper model, (3) reduce input token count`,
        );
      }

      let attempt = 0;
      let primaryError: unknown;

      for (;;) {
        const result = await this.ports.executor.executeComplete(
          prepared,
          input.params,
          { dispose: false },
        );

        if (result.ok) {
          this.ports.budget.settle(input.requestId, input.estimatedCost, {
            provider: input.provider,
            model: input.model,
            phase: "execute",
          });
          this.emitCompleted(input, attempt + 1, false, input.provider, input.model);
          await this.ports.plugins.fireResponse({
            requestId: input.requestId,
            provider: input.provider,
            model: input.model,
            durationMs: this.ports.now() - input.startTime,
            streaming: false,
          });
          return result.value;
        }

        primaryError = result.error;
        if (input.callerSignal?.aborted) {
          break;
        }

        const status = (primaryError as { status?: number }).status;
        const isNetworkError = primaryError instanceof TypeError
          || (primaryError instanceof Error && primaryError.name === "AbortError");
        const canRetry = (isNetworkError && shouldRetryNetworkError(attempt, prepared.retryConfig))
          || (typeof status === "number" && shouldRetry(status, attempt, prepared.retryConfig));

        if (canRetry) {
          const delay = calculateBackoff(attempt, prepared.context.policy.backoff);
          this.ports.emit({
            type: "request.retrying",
            requestId: input.requestId,
            timestamp: this.ports.now(),
            provider: input.provider,
            attempt,
            delayMs: delay,
            reason: isNetworkError ? "network error" : `HTTP ${status}`,
          });
          try {
            await this.ports.sleep(delay, input.callerSignal);
          } catch (error) {
            primaryError = error;
            break;
          }
          attempt++;
          continue;
        }

        if (prepared.context.policy.allowFallback) {
          this.ports.budget.release(input.requestId);
          const attemptedModels = [input.model];
          const fallbacks = input.fallbackCandidates(attemptedModels);
          for (const fallback of fallbacks) {
            if (attemptedModels.includes(fallback.model)) continue;
            const fallbackCost = input.estimateFallbackCost(fallback);
            if (prepared.context.policy.maxFallbackCost !== null && fallbackCost > prepared.context.policy.maxFallbackCost) continue;
            attemptedModels.push(fallback.model);
            const fallbackId = `${input.requestId}_fb_${fallback.model}`;
            const fallbackReservation = this.ports.budget.reserve(fallbackId, fallbackCost);
            if (!fallbackReservation) continue;

            let fallbackPrepared: ReturnType<RequestExecutor["prepare"]> | undefined;
            try {
              fallbackPrepared = this.prepare({
                ...input,
                provider: fallback.provider,
                model: fallback.model,
                params: { ...input.params, model: fallback.model },
                callerSignal: prepared.signal,
                providerTimeoutMs: 0,
              });
              const fallbackResult = await this.ports.executor.executeComplete(
                fallbackPrepared,
                { ...input.params, model: fallback.model },
              );
              if (!fallbackResult.ok && input.callerSignal?.aborted) {
                primaryError = fallbackResult.error;
              }
              if (fallbackResult.ok) {
                this.ports.budget.settle(fallbackId, fallbackCost, {
                  provider: fallback.provider,
                  model: fallback.model,
                  phase: "fallback",
                });
                this.emitCompleted(input, attempt + 2, false, fallback.provider, fallback.model);
                await this.ports.plugins.fireResponse({
                  requestId: input.requestId,
                  provider: fallback.provider,
                  model: fallback.model,
                  durationMs: this.ports.now() - input.startTime,
                  streaming: false,
                });
                return fallbackResult.value;
              }
            } catch (error) {
              if (input.callerSignal?.aborted) primaryError = error;
            } finally {
              fallbackPrepared?.dispose();
              this.ports.budget.release(fallbackId);
            }
            if (input.callerSignal?.aborted) break;
          }
        }
        break;
      }

      this.ports.budget.release(input.requestId);
      const error = primaryError instanceof Error ? primaryError : new Error(String(primaryError));
      this.ports.emit({
        type: "request.failed",
        requestId: input.requestId,
        timestamp: this.ports.now(),
        provider: input.provider,
        model: input.model,
        durationMs: this.ports.now() - input.startTime,
        attempts: attempt + 1,
        error: error.message,
      });
      await this.ports.plugins.fireError({
        requestId: input.requestId,
        provider: input.provider,
        model: input.model,
        error,
        durationMs: this.ports.now() - input.startTime,
        attempts: attempt + 1,
      });
      throw primaryError;
    } finally {
      prepared.dispose();
    }
  }

  async *runStream(input: StreamPipelineInput): AsyncGenerator<import("../../types/streams.js").StreamChunk> {
    const prepared = this.prepare(input, "stream");
    let reservationActive = false;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let firstChunkEmitted = false;
    let attempt = 0;
    let primaryError: unknown;

    try {
      await this.ports.plugins.fireRequest({
        requestId: input.requestId,
        provider: input.provider,
        model: input.model,
        messages: input.messages,
        extra: input.params.extra,
        signal: input.callerSignal,
        timestamp: this.ports.now(),
      });

      const reservation = this.ports.budget.reserve(input.requestId, input.estimatedCost);
      if (!reservation) {
        const remaining = this.ports.budget.report().remainingBudget;
        throw new ConfigurationError(
          `Budget reservation rejected — estimated cost $${input.estimatedCost.toFixed(4)} would exceed budget`,
          `Remaining budget: $${remaining?.toFixed(4) ?? "unknown"}. Options: (1) increase sessionBudget, (2) use a cheaper model, (3) reduce input token count`,
        );
      }
      reservationActive = true;

      for (;;) {
        try {
          for await (const chunk of this.ports.executor.executeStream(
            prepared,
            input.params,
            { dispose: false },
          )) {
            if (!firstChunkEmitted) {
              firstChunkEmitted = true;
              this.ports.emit({
                type: "stream.first_chunk",
                requestId: input.requestId,
                timestamp: this.ports.now(),
                latencyMs: 0,
              });
            }
            if (chunk.type === "usage") {
              inputTokens = chunk.inputTokens;
              outputTokens = chunk.outputTokens;
              if (reservationActive) {
                const actualCost = this.ports.budget.estimate(
                  input.model,
                  input.provider,
                  chunk.inputTokens,
                  chunk.outputTokens,
                );
                this.ports.budget.settle(input.requestId, actualCost, {
                  provider: input.provider,
                  model: input.model,
                  phase: "execute",
                });
                reservationActive = false;
              }
            }
            yield chunk;
          }

          if (reservationActive) {
            this.ports.budget.settle(input.requestId, input.estimatedCost, {
              provider: input.provider,
              model: input.model,
              phase: "execute",
            });
            reservationActive = false;
          }
          this.ports.emit({
            type: "request.completed",
            requestId: input.requestId,
            timestamp: this.ports.now(),
            provider: input.provider,
            model: input.model,
            durationMs: this.ports.now() - input.startTime,
            attempts: attempt + 1,
            inputTokens,
            outputTokens,
            structuredOutput: false,
          });
          await this.ports.plugins.fireResponse({
            requestId: input.requestId,
            provider: input.provider,
            model: input.model,
            durationMs: this.ports.now() - input.startTime,
            inputTokens,
            outputTokens,
            streaming: true,
          });
          return;
        } catch (error) {
          primaryError = error;
          const callerAborted = input.callerSignal?.aborted === true;
          const internalTimeout = prepared.signal?.aborted === true;
          if (callerAborted || firstChunkEmitted || internalTimeout) {
            if (reservationActive) {
              this.ports.budget.release(input.requestId);
              reservationActive = false;
            }
            const terminalError = error instanceof Error ? error : new Error(String(error));
            this.ports.emit({
              type: "request.failed",
              requestId: input.requestId,
              timestamp: this.ports.now(),
              provider: input.provider,
              model: input.model,
              durationMs: this.ports.now() - input.startTime,
              attempts: attempt + 1,
              error: terminalError.message,
            });
            await this.ports.plugins.fireError({
              requestId: input.requestId,
              provider: input.provider,
              model: input.model,
              error: terminalError,
              durationMs: this.ports.now() - input.startTime,
              attempts: attempt + 1,
            });
            throw error;
          }

          const status = (error as { status?: number }).status;
          const isNetworkError = error instanceof TypeError
            || (error instanceof Error && error.name === "AbortError");
          const canRetry = (isNetworkError && shouldRetryNetworkError(attempt, prepared.retryConfig))
            || (typeof status === "number" && shouldRetry(status, attempt, prepared.retryConfig));
          if (!canRetry) {
            if (prepared.context.policy.allowFallback) {
              this.ports.budget.release(input.requestId);
              reservationActive = false;
              const attemptedModels = [input.model];
              const fallbacks = input.fallbackCandidates(attemptedModels);
              for (const fallback of fallbacks) {
                if (attemptedModels.includes(fallback.model)) continue;
                const fallbackCost = input.estimateFallbackCost(fallback);
                if (prepared.context.policy.maxFallbackCost !== null && fallbackCost > prepared.context.policy.maxFallbackCost) continue;
                attemptedModels.push(fallback.model);
                this.ports.emit({
                  type: "fallback.started",
                  requestId: input.requestId,
                  timestamp: this.ports.now(),
                  originalProvider: input.provider,
                  originalModel: input.model,
                  fallbackProvider: fallback.provider,
                  fallbackModel: fallback.model,
                });
                const fallbackId = `${input.requestId}_fb_${fallback.model}`;
                const fallbackReservation = this.ports.budget.reserve(fallbackId, fallbackCost);
                if (!fallbackReservation) continue;
                let fallbackPrepared: ReturnType<RequestExecutor["prepare"]> | undefined;
                let fallbackVisible = false;
                let fallbackInputTokens: number | undefined;
                let fallbackOutputTokens: number | undefined;
                let fallbackReservationActive = true;
                try {
                  fallbackPrepared = this.prepare({
                    ...input,
                    provider: fallback.provider,
                    model: fallback.model,
                    params: { ...input.params, model: fallback.model },
                    callerSignal: prepared.signal,
                    providerTimeoutMs: 0,
                  }, "stream");
                  for await (const chunk of this.ports.executor.executeStream(
                    fallbackPrepared,
                    { ...input.params, model: fallback.model },
                  )) {
                    fallbackVisible = true;
                    if (chunk.type === "usage") {
                      fallbackInputTokens = chunk.inputTokens;
                      fallbackOutputTokens = chunk.outputTokens;
                      if (fallbackReservationActive) {
                        const actualCost = this.ports.budget.estimate(
                          fallback.model,
                          fallback.provider,
                          chunk.inputTokens,
                          chunk.outputTokens,
                        );
                        this.ports.budget.settle(fallbackId, actualCost, {
                          provider: fallback.provider,
                          model: fallback.model,
                          phase: "fallback",
                        });
                        fallbackReservationActive = false;
                      }
                    }
                    yield chunk;
                  }
                  if (fallbackReservationActive) {
                    this.ports.budget.settle(fallbackId, fallbackCost, {
                      provider: fallback.provider,
                      model: fallback.model,
                      phase: "fallback",
                    });
                    fallbackReservationActive = false;
                  }
                  this.ports.emit({
                    type: "request.completed",
                    requestId: input.requestId,
                    timestamp: this.ports.now(),
                    provider: fallback.provider,
                    model: fallback.model,
                    durationMs: this.ports.now() - input.startTime,
                    attempts: attempt + 2,
                    inputTokens: fallbackInputTokens,
                    outputTokens: fallbackOutputTokens,
                    structuredOutput: false,
                  });
                  await this.ports.plugins.fireResponse({
                    requestId: input.requestId,
                    provider: fallback.provider,
                    model: fallback.model,
                    durationMs: this.ports.now() - input.startTime,
                    inputTokens: fallbackInputTokens,
                    outputTokens: fallbackOutputTokens,
                    streaming: true,
                  });
                  return;
                } catch (fallbackError) {
                  if (input.callerSignal?.aborted || prepared.signal?.aborted || fallbackVisible) {
                    primaryError = fallbackError;
                    break;
                  }
                } finally {
                  fallbackPrepared?.dispose();
                  if (fallbackReservationActive) this.ports.budget.release(fallbackId);
                }
                if (input.callerSignal?.aborted || prepared.signal?.aborted) break;
              }
            }
          }

          if (!canRetry) {
            if (reservationActive) {
              this.ports.budget.release(input.requestId);
              reservationActive = false;
            }
            const terminalError = error instanceof Error ? error : new Error(String(error));
            this.ports.emit({
              type: "request.failed",
              requestId: input.requestId,
              timestamp: this.ports.now(),
              provider: input.provider,
              model: input.model,
              durationMs: this.ports.now() - input.startTime,
              attempts: attempt + 1,
              error: terminalError.message,
            });
            await this.ports.plugins.fireError({
              requestId: input.requestId,
              provider: input.provider,
              model: input.model,
              error: terminalError,
              durationMs: this.ports.now() - input.startTime,
              attempts: attempt + 1,
            });
            throw error;
          }

          const delay = calculateBackoff(attempt, prepared.context.policy.backoff);
          this.ports.emit({
            type: "request.retrying",
            requestId: input.requestId,
            timestamp: this.ports.now(),
            provider: input.provider,
            attempt,
            delayMs: delay,
            reason: isNetworkError ? "network error" : `HTTP ${status}`,
          });
          try {
            await this.ports.sleep(delay, input.callerSignal);
          } catch (sleepError) {
            if (reservationActive) {
              this.ports.budget.release(input.requestId);
              reservationActive = false;
            }
            const terminalError = sleepError instanceof Error ? sleepError : new Error(String(sleepError));
            this.ports.emit({
              type: "request.failed",
              requestId: input.requestId,
              timestamp: this.ports.now(),
              provider: input.provider,
              model: input.model,
              durationMs: this.ports.now() - input.startTime,
              attempts: attempt + 1,
              error: terminalError.message,
            });
            await this.ports.plugins.fireError({
              requestId: input.requestId,
              provider: input.provider,
              model: input.model,
              error: terminalError,
              durationMs: this.ports.now() - input.startTime,
              attempts: attempt + 1,
            });
            throw sleepError;
          }
          attempt++;
        }
      }
    } finally {
      if (reservationActive) this.ports.budget.release(input.requestId);
      prepared.dispose();
    }
  }

  async runStructuredComplete(input: StructuredCompletePipelineInput): Promise<unknown> {
    const prepared = this.prepare(input);
    try {
      await this.ports.plugins.fireRequest({
        requestId: input.requestId,
        provider: input.provider,
        model: input.model,
        messages: input.messages,
        extra: input.params.extra,
        signal: input.callerSignal,
        timestamp: this.ports.now(),
      });

      const reservation = this.ports.budget.reserve(input.requestId, input.estimatedCost);
      if (!reservation) {
        const remaining = this.ports.budget.report().remainingBudget;
        throw new ConfigurationError(
          `Budget reservation rejected — estimated cost $${input.estimatedCost.toFixed(4)} would exceed budget`,
          `Remaining budget: $${remaining?.toFixed(4) ?? "unknown"}. Options: (1) increase sessionBudget, (2) use a cheaper model, (3) reduce input token count`,
        );
      }

      const maxRepairAttempts = input.output.maxRepairAttempts ?? 2;
      let structuredMessages: Message[] = [
        { role: "system", content: buildJsonSystemInstruction(input.output.schema as never) },
        ...input.messages,
      ];
      let structuredExtra = {
        ...input.params.extra,
        ...(input.jsonModeParams?.(input.provider) ?? {}),
      };
      let attempt = 0;
      let primaryError: unknown;

      for (;;) {
        const result = await this.ports.executor.executeComplete(
          prepared,
          { ...input.params, messages: structuredMessages, extra: structuredExtra },
          { dispose: false },
        );

        if (result.ok) {
          let parsed: unknown;
          let validation: ReturnType<typeof input.output.schema.safeParse>;
          try {
            parsed = JSON.parse(extractJson(result.value));
            validation = input.output.schema.safeParse(parsed);
          } catch (error) {
            validation = { success: false, error };
          }

          if (validation.success) {
            this.ports.budget.settle(input.requestId, input.estimatedCost, {
              provider: input.provider,
              model: input.model,
              phase: "execute",
            });
            this.ports.emit({
              type: "structured.validate.pass",
              requestId: input.requestId,
              timestamp: this.ports.now(),
            });
            this.emitCompleted(input, attempt + 1, true, input.provider, input.model);
            await this.ports.plugins.fireResponse({
              requestId: input.requestId,
              provider: input.provider,
              model: input.model,
              durationMs: this.ports.now() - input.startTime,
              streaming: false,
            });
            return validation.data;
          }

          this.ports.emit({
            type: "structured.validate.fail",
            requestId: input.requestId,
            timestamp: this.ports.now(),
            attempt,
            error: validation.error instanceof Error ? validation.error.message : String(validation.error),
          });

          if (attempt < maxRepairAttempts) {
            const repairPrompt = buildRepairPrompt(
              validation.error,
              result.value,
              buildJsonSystemInstruction(input.output.schema as never),
              input.output.repairInstructions,
            );
            const lastUserIdx = structuredMessages.map((m) => m.role).lastIndexOf("user");
            structuredMessages = lastUserIdx >= 0
              ? [...structuredMessages.slice(0, lastUserIdx), { role: "user", content: repairPrompt }]
              : [...structuredMessages, { role: "user", content: repairPrompt }];
            attempt++;
            continue;
          }

          const validationError = new ValidationError(
            maxRepairAttempts + 1,
            validation.error,
            result.value,
            { requestId: input.requestId, model: input.model },
          );
          this.ports.budget.release(input.requestId);
          this.ports.emit({
            type: "request.failed",
            requestId: input.requestId,
            timestamp: this.ports.now(),
            provider: input.provider,
            model: input.model,
            durationMs: this.ports.now() - input.startTime,
            attempts: attempt + 1,
            error: validationError.message,
          });
          await this.ports.plugins.fireError({
            requestId: input.requestId,
            provider: input.provider,
            model: input.model,
            error: validationError,
            durationMs: this.ports.now() - input.startTime,
            attempts: attempt + 1,
          });
          throw validationError;
        }

        primaryError = result.error;
        if (input.callerSignal?.aborted) break;

        const status = (primaryError as { status?: number }).status;
        const isNetworkError = primaryError instanceof TypeError
          || (primaryError instanceof Error && primaryError.name === "AbortError");
        const canRetry = (isNetworkError && shouldRetryNetworkError(attempt, prepared.retryConfig))
          || (typeof status === "number" && shouldRetry(status, attempt, prepared.retryConfig));
        if (canRetry) {
          const delay = calculateBackoff(attempt, prepared.context.policy.backoff);
          this.ports.emit({
            type: "request.retrying",
            requestId: input.requestId,
            timestamp: this.ports.now(),
            provider: input.provider,
            attempt,
            delayMs: delay,
            reason: isNetworkError ? "network error" : `HTTP ${status}`,
          });
          try {
            await this.ports.sleep(delay, input.callerSignal);
          } catch (error) {
            primaryError = error;
            break;
          }
          attempt++;
          continue;
        }

        if (prepared.context.policy.allowFallback) {
          this.ports.budget.release(input.requestId);
          const attemptedModels = [input.model];
          const fallbacks = input.fallbackCandidates(attemptedModels);
          for (const fallback of fallbacks) {
            if (attemptedModels.includes(fallback.model)) continue;
            const fallbackCost = input.estimateFallbackCost(fallback);
            if (prepared.context.policy.maxFallbackCost !== null && fallbackCost > prepared.context.policy.maxFallbackCost) continue;
            attemptedModels.push(fallback.model);
            const fallbackId = `${input.requestId}_fb_${fallback.model}`;
            const fallbackReservation = this.ports.budget.reserve(fallbackId, fallbackCost);
            if (!fallbackReservation) continue;

            let fallbackPrepared: ReturnType<RequestExecutor["prepare"]> | undefined;
            try {
              fallbackPrepared = this.prepare({
                ...input,
                provider: fallback.provider,
                model: fallback.model,
                params: { ...input.params, model: fallback.model },
                callerSignal: prepared.signal,
                providerTimeoutMs: 0,
              });
              const fallbackResult = await this.ports.executor.executeComplete(fallbackPrepared, {
                ...input.params,
                model: fallback.model,
                messages: structuredMessages,
                extra: { ...structuredExtra, ...(input.jsonModeParams?.(fallback.provider) ?? {}) },
              });
              if (!fallbackResult.ok && input.callerSignal?.aborted) {
                primaryError = fallbackResult.error;
              }
              if (fallbackResult.ok) {
                const parsed = JSON.parse(extractJson(fallbackResult.value));
                const validation = input.output.schema.safeParse(parsed);
                if (validation.success) {
                  this.ports.budget.settle(fallbackId, fallbackCost, {
                    provider: fallback.provider,
                    model: fallback.model,
                    phase: "fallback",
                  });
                  this.emitCompleted(input, attempt + 2, true, fallback.provider, fallback.model);
                  await this.ports.plugins.fireResponse({
                    requestId: input.requestId,
                    provider: fallback.provider,
                    model: fallback.model,
                    durationMs: this.ports.now() - input.startTime,
                    streaming: false,
                  });
                  return validation.data;
                }
              }
            } catch (error) {
              if (input.callerSignal?.aborted) primaryError = error;
            } finally {
              fallbackPrepared?.dispose();
              this.ports.budget.release(fallbackId);
            }
            if (input.callerSignal?.aborted) break;
          }
        }
        break;
      }

      this.ports.budget.release(input.requestId);
      const error = primaryError instanceof Error ? primaryError : new Error(String(primaryError));
      this.ports.emit({
        type: "request.failed",
        requestId: input.requestId,
        timestamp: this.ports.now(),
        provider: input.provider,
        model: input.model,
        durationMs: this.ports.now() - input.startTime,
        attempts: attempt + 1,
        error: error.message,
      });
      await this.ports.plugins.fireError({
        requestId: input.requestId,
        provider: input.provider,
        model: input.model,
        error,
        durationMs: this.ports.now() - input.startTime,
        attempts: attempt + 1,
      });
      throw primaryError;
    } finally {
      prepared.dispose();
    }
  }

  private prepare(
    input: CompletePipelineInput | StreamPipelineInput | StructuredCompletePipelineInput | (RequestPreparationInput & { params: Omit<GenerateParams, "signal"> }),
    operation: RequestOperation = "complete",
  ): ReturnType<RequestExecutor["prepare"]> {
    try {
      return this.ports.executor.prepare({
        requestId: input.requestId,
        operation,
        provider: input.provider,
        model: input.model,
        policy: input.policy,
        providerTimeoutMs: input.providerTimeoutMs,
        callerSignal: input.callerSignal,
      });
    } catch (error) {
      if (error instanceof CircuitBreakerOpenError) {
        this.ports.onCircuitOpen?.(input.requestId, input.provider);
      }
      throw error;
    }
  }

  private emitCompleted(
    input: CompletePipelineInput,
    attempts: number,
    structuredOutput: boolean,
    provider: string,
    model: string,
  ): void {
    this.ports.emit({
      type: "request.completed",
      requestId: input.requestId,
      timestamp: this.ports.now(),
      provider,
      model,
      durationMs: this.ports.now() - input.startTime,
      attempts,
      structuredOutput,
    });
  }
}
