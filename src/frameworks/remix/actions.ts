/**
 * @hilbras/remix — Action Helpers
 *
 * Remix action helpers for streaming chat/completion.
 * Uses the HilbrasClient to generate streaming responses with full protocol support.
 */

import { createSSEResponse } from "../../utils/sse-writer.js";
import type { Tool } from "../../types/tools.js";
import {
  createFrameworkClientPool,
  errorResponse,
  isRequestPhaseError,
  readJsonBody,
  resolveChatFields,
  resolveCompletionFields,
  resolveLimits,
  type FrameworkHandlerBaseOptions,
} from "../shared/handler-core.js";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ActionOptions extends FrameworkHandlerBaseOptions {
  tools?: Tool[];
  maxSteps?: number;
}

/**
 * Create a streaming chat action for Remix.
 *
 * @example
 * ```ts
 * // app/routes/api.chat.ts
 * import { createChatAction } from "@hilbras/sdk/remix";
 *
 * export const action = createChatAction({
 *   provider: "openai",
 *   model: "gpt-4o",
 * });
 * ```
 */
export function createChatAction(options: ActionOptions) {
  const pool = createFrameworkClientPool({
    provider: options.provider,
    model: options.model,
    apiKey: options.apiKey,
  });

  const limits = resolveLimits(options.limits);
  // This adapter never read `model`/`tools`/`maxSteps` from the body in v3.4, so
  // its default is `false`. Defaulting to `true` would have widened the
  // caller's influence over a route that did not previously have any.
  const trustClientFields = options.trustClientFields ?? false;

  const action = async ({ request }: { request: Request }): Promise<Response> => {
    try {
      const body = await readJsonBody(request, limits);
      const fields = resolveChatFields(body, {
        model: options.model,
        tools: options.tools,
        maxSteps: options.maxSteps,
        trustClientFields,
        limits,
      });

      const client = pool.get(fields.model);
      const providerName = pool.providerName;
      const effective = { ...fields, provider: providerName };
      await options.onRequest?.({ request, body, effective });

      const allMessages = options.systemPrompt
        ? [{ role: "system" as const, content: options.systemPrompt }, ...(fields.messages as ChatMessage[])]
        : (fields.messages as ChatMessage[]);

      if (!effective.stream) {
        const result = await client.complete({
          provider: providerName,
          model: fields.model,
          messages: allMessages,
          temperature: fields.temperature,
          maxTokens: fields.maxTokens,
          signal: request.signal,
        });
        return new Response(JSON.stringify({
          id: `cmpl-${Date.now()}`,
          choices: [{ message: { role: "assistant", content: result }, finishReason: "stop" }],
        }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      const chunks = client.streamText({
        provider: providerName,
        model: fields.model,
        messages: allMessages,
        temperature: fields.temperature,
        maxTokens: fields.maxTokens,
        tools: fields.tools,
        maxSteps: fields.maxSteps,
        signal: request.signal,
      });

      return createSSEResponse(chunks);
    } catch (error) {
      if (options.onError) {
        await options.onError(error, {
          request,
          phase: isRequestPhaseError(error) ? "request" : "provider",
        });
      }
      return errorResponse(error);
    }
  };

  async function dispose(): Promise<void> {
    await pool.dispose();
  }

  return Object.assign(action, { dispose });
}

/**
 * Create a non-streaming completion action for Remix.
 */
export function createCompletionAction(options: ActionOptions) {
  const pool = createFrameworkClientPool({
    provider: options.provider,
    model: options.model,
    apiKey: options.apiKey,
  });

  const limits = resolveLimits(options.limits);
  // This adapter never read `model`/`tools`/`maxSteps` from the body in v3.4, so
  // its default is `false`. Defaulting to `true` would have widened the
  // caller's influence over a route that did not previously have any.
  const trustClientFields = options.trustClientFields ?? false;

  const action = async ({ request }: { request: Request }): Promise<Response> => {
    try {
      const body = await readJsonBody(request, limits);
      const fields = resolveCompletionFields(body, {
        model: options.model,
        trustClientFields,
        limits,
      });

      const client = pool.get(fields.model);
      const effective = { ...fields, provider: pool.providerName };
      await options.onRequest?.({ request, body, effective });

      const result = await client.complete({
        provider: pool.providerName,
        model: fields.model,
        messages: [{ role: "user", content: fields.prompt as string }],
        temperature: fields.temperature,
        maxTokens: fields.maxTokens,
        signal: request.signal,
      });

      return new Response(JSON.stringify({
        id: `cmpl-${Date.now()}`,
        choices: [{ message: { role: "assistant", content: result }, finishReason: "stop" }],
      }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      if (options.onError) {
        await options.onError(error, {
          request,
          phase: isRequestPhaseError(error) ? "request" : "provider",
        });
      }
      return errorResponse(error);
    }
  };

  async function dispose(): Promise<void> {
    await pool.dispose();
  }

  return Object.assign(action, { dispose });
}
