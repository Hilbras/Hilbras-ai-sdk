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
  readJsonBody,
  requireArray,
  requireString,
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

  async function POST(req: Request): Promise<Response> {
    try {
      const body = await readJsonBody(req);
      const messages = requireArray(body, "messages") as ChatMessage[];
      const model = typeof body.model === "string" && body.model.length > 0
        ? body.model
        : options.model;

      // Resolving the client before responding means a bad provider or model
      // produces a real error status instead of an HTTP 200 whose body carries
      // the failure.
      const client = pool.get(model);
      const providerName = pool.providerName;

      const allMessages = [
        ...(options.systemPrompt ? [{ role: "system" as const, content: options.systemPrompt }] : []),
        ...messages,
      ];

      if (body.stream === false) {
        const result = await client.complete({
          provider: providerName,
          model,
          messages: allMessages,
          temperature: typeof body.temperature === "number" ? body.temperature : undefined,
          maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : undefined,
          signal: req.signal,
        });
        return Response.json({
          id: `cmpl-${Date.now()}`,
          choices: [{ message: { role: "assistant", content: result }, finishReason: "stop" }],
        });
      }

      const chunks = client.streamText({
        provider: providerName,
        model,
        messages: allMessages,
        temperature: typeof body.temperature === "number" ? body.temperature : undefined,
        maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : undefined,
        tools: (body.tools as Tool[] | undefined) ?? options.tools,
        maxSteps: typeof body.maxSteps === "number" ? body.maxSteps : options.maxSteps,
        signal: req.signal,
      });

      return createSSEResponse(chunks);
    } catch (error) {
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

  async function POST(req: Request): Promise<Response> {
    try {
      const body = await readJsonBody(req);
      const prompt = requireString(body, "prompt");
      const model = typeof body.model === "string" && body.model.length > 0
        ? body.model
        : options.model;

      const client = pool.get(model);
      const result = await client.complete({
        provider: pool.providerName,
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: typeof body.temperature === "number" ? body.temperature : undefined,
        maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : undefined,
        signal: req.signal,
      });

      return Response.json({
        id: `cmpl-${Date.now()}`,
        choices: [{ message: { role: "assistant", content: result }, finishReason: "stop" }],
      });
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function dispose(): Promise<void> {
    await pool.dispose();
  }

  return { POST, dispose };
}
