/**
 * @hilbras/astro — Astro API Endpoint
 *
 * Create API endpoints for streaming chat/completion in Astro.
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

export interface EndpointOptions extends FrameworkHandlerBaseOptions {
  tools?: Tool[];
  maxSteps?: number;
}

/**
 * Create a streaming chat endpoint for Astro.
 *
 * @example
 * ```ts
 * // src/pages/api/chat.ts
 * import { createChatEndpoint } from "@hilbras/sdk/astro";
 *
 * export const { POST } = createChatEndpoint({
 *   provider: "openai",
 *   model: "gpt-4o",
 * });
 * ```
 */
export function createChatEndpoint(options: EndpointOptions) {
  const pool = createFrameworkClientPool({
    provider: options.provider,
    model: options.model,
    apiKey: options.apiKey,
  });

  async function POST({ request }: { request: Request }): Promise<Response> {
    try {
      const body = await readJsonBody(request);
      const messages = requireArray(body, "messages") as ChatMessage[];

      const client = pool.get(options.model);
      const providerName = pool.providerName;

      const allMessages = options.systemPrompt
        ? [{ role: "system" as const, content: options.systemPrompt }, ...messages]
        : messages;

      if (body.stream === false) {
        const result = await client.complete({
          provider: providerName,
          model: options.model,
          messages: allMessages,
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
        model: options.model,
        messages: allMessages,
        tools: options.tools,
        maxSteps: options.maxSteps,
        signal: request.signal,
      });

      return createSSEResponse(chunks);
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function dispose(): Promise<void> {
    await pool.dispose();
  }

  return { POST, dispose };
}

/**
 * Create a non-streaming completion endpoint for Astro.
 */
export function createCompletionEndpoint(options: EndpointOptions) {
  const pool = createFrameworkClientPool({
    provider: options.provider,
    model: options.model,
    apiKey: options.apiKey,
  });

  async function POST({ request }: { request: Request }): Promise<Response> {
    try {
      const body = await readJsonBody(request);
      const prompt = requireString(body, "prompt");

      const client = pool.get(options.model);
      const result = await client.complete({
        provider: pool.providerName,
        model: options.model,
        messages: [{ role: "user", content: prompt }],
        signal: request.signal,
      });

      return new Response(JSON.stringify({
        id: `cmpl-${Date.now()}`,
        choices: [{ message: { role: "assistant", content: result }, finishReason: "stop" }],
      }), {
        headers: { "Content-Type": "application/json" },
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
