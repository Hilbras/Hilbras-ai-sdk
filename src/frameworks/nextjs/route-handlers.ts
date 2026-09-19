/**
 * @hilbras/nextjs — Route Handler Helpers
 *
 * Helpers for Next.js App Router route handlers.
 * Uses the HilbrasClient to generate streaming responses with full protocol support.
 */

import { HilbrasClient } from "../../client/client.js";
import { createSSEResponse } from "../../utils/sse-writer.js";
import type { Tool } from "../../types/tools.js";

export interface ChatRequest {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  provider?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: Tool[];
  maxSteps?: number;
  stream?: boolean;
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
 * Create a streaming chat endpoint handler.
 *
 * @example
 * ```ts
 * // app/api/chat/route.ts
 * import { createChatHandler } from "@hilbras/nextjs";
 *
 * export const { POST } = createChatHandler({
 *   provider: "OpenAI",
 *   model: "gpt-4o",
 * });
 * ```
 */
export function createChatHandler(options: {
  provider: string;
  model: string;
  systemPrompt?: string;
  tools?: Tool[];
  maxSteps?: number;
}) {
  async function POST(req: Request): Promise<Response> {
    const body: ChatRequest = await req.json();

    const client = new HilbrasClient();
    client.addProviderFromCatalog(options.provider, body.model ?? options.model, process.env.AI_API_KEY ?? "");

    const messages = [
      ...(options.systemPrompt ? [{ role: "system", content: options.systemPrompt }] : []),
      ...body.messages,
    ];

    if (body.stream === false) {
      const result = await client.complete({
        provider: options.provider,
        model: body.model ?? options.model,
        messages,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
      });
      return Response.json({
        id: `cmpl-${Date.now()}`,
        choices: [{ message: { role: "assistant", content: result }, finishReason: "stop" }],
      });
    }

    const chunks = client.streamText({
      provider: options.provider,
      model: body.model ?? options.model,
      messages,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
      tools: body.tools ?? options.tools,
      maxSteps: body.maxSteps ?? options.maxSteps,
    });

    return createSSEResponse(chunks);
  }

  return { POST };
}

/**
 * Create a non-streaming completion endpoint handler.
 */
export function createCompletionHandler(options: {
  provider: string;
  model: string;
}) {
  async function POST(req: Request): Promise<Response> {
    const body = await req.json();

    const client = new HilbrasClient();
    client.addProviderFromCatalog(options.provider, body.model ?? options.model, process.env.AI_API_KEY ?? "");

    const result = await client.complete({
      provider: options.provider,
      model: options.model,
      messages: [{ role: "user", content: body.prompt ?? "" }],
    });

    return Response.json({
      id: `cmpl-${Date.now()}`,
      choices: [{
        message: { role: "assistant", content: result },
        finishReason: "stop",
      }],
    });
  }

  return { POST };
}
