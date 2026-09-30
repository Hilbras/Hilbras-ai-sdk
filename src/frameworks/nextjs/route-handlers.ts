/**
 * @hilbras/nextjs — Next.js Route Handlers
 *
 * Create streaming chat/completion endpoints for the Next.js App Router.
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

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  provider?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: Tool[];
  maxSteps?: number;
  stream?: boolean;
}

export interface ChatHandlerOptions extends FrameworkHandlerBaseOptions {
  tools?: Tool[];
  maxSteps?: number;
}

export interface ChatResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finishReason: string;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Create a streaming chat endpoint for Next.js.
 *
 * @example
 * ```ts
 * // app/api/chat/route.ts
 * import { createChatHandler } from "@hilbras/sdk/nextjs";
 *
 * export const { POST } = createChatHandler({
 *   provider: "openai",
 *   model: "gpt-4o",
 * });
 * ```
 */
export function createChatHandler(options: ChatHandlerOptions) {
  const pool = createFrameworkClientPool({
    provider: options.provider,
    model: options.model,
    apiKey: options.apiKey,
  });

  const limits = resolveLimits(options.limits);
  const trustClientFields = options.trustClientFields ?? true;

  async function POST(req: Request): Promise<Response> {
    try {
      const body = await readJsonBody(req, limits);
      const fields = resolveChatFields(body, {
        model: options.model,
        tools: options.tools,
        maxSteps: options.maxSteps,
        trustClientFields,
        limits,
      });

      // Resolving the client before responding means a bad provider or model
      // produces a real error status instead of an HTTP 200 whose body carries
      // the failure.
      const client = pool.get(fields.model);
      const providerName = pool.providerName;

      const effective = { ...fields, provider: providerName };
      await options.onRequest?.({ request: req, body, effective });

      const allMessages = [
        ...(options.systemPrompt ? [{ role: "system" as const, content: options.systemPrompt }] : []),
        ...(fields.messages as ChatMessage[]),
      ];

      if (!effective.stream) {
        const result = await client.complete({
          provider: providerName,
          model: fields.model,
          messages: allMessages,
          temperature: fields.temperature,
          maxTokens: fields.maxTokens,
          signal: req.signal,
        });
        return Response.json({
          id: `cmpl-${Date.now()}`,
          choices: [{ message: { role: "assistant", content: result }, finishReason: "stop" }],
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
        signal: req.signal,
      });

      return createSSEResponse(chunks);
    } catch (error) {
      if (options.onError) {
        await options.onError(error, {
          request: req,
          phase: isRequestPhaseError(error) ? "request" : "provider",
        });
      }
      return errorResponse(error);
    }
  }

  /** Release the cached clients. Call this on server shutdown. */
  async function dispose(): Promise<void> {
    await pool.dispose();
  }

  return { POST, dispose };
}

export interface CompletionRequest {
  prompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface CompletionHandlerOptions extends FrameworkHandlerBaseOptions {}

/**
 * Create a non-streaming completion endpoint for Next.js.
 */
export function createCompletionHandler(options: CompletionHandlerOptions) {
  const pool = createFrameworkClientPool({
    provider: options.provider,
    model: options.model,
    apiKey: options.apiKey,
  });

  const limits = resolveLimits(options.limits);
  const trustClientFields = options.trustClientFields ?? true;

  async function POST(req: Request): Promise<Response> {
    try {
      const body = await readJsonBody(req, limits);
      const fields = resolveCompletionFields(body, {
        model: options.model,
        trustClientFields,
        limits,
      });

      const client = pool.get(fields.model);
      const effective = { ...fields, provider: pool.providerName };
      await options.onRequest?.({ request: req, body, effective });

      const result = await client.complete({
        provider: pool.providerName,
        model: fields.model,
        messages: [{ role: "user", content: fields.prompt as string }],
        temperature: fields.temperature,
        maxTokens: fields.maxTokens,
        signal: req.signal,
      });

      return Response.json({
        id: `cmpl-${Date.now()}`,
        choices: [{ message: { role: "assistant", content: result }, finishReason: "stop" }],
      });
    } catch (error) {
      if (options.onError) {
        await options.onError(error, {
          request: req,
          phase: isRequestPhaseError(error) ? "request" : "provider",
        });
      }
      return errorResponse(error);
    }
  }

  async function dispose(): Promise<void> {
    await pool.dispose();
  }

  return { POST, dispose };
}
