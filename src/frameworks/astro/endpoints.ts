/**
 * @hilbras/astro — Astro API Endpoint
 *
 * Create API endpoints for streaming chat/completion in Astro.
 * Uses the HilbrasClient to generate streaming responses with full protocol support.
 */

import { HilbrasClient } from "../../client/client.js";
import { createSSEResponse } from "../../utils/sse-writer.js";
import type { Tool } from "../../types/tools.js";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface EndpointOptions {
  provider: string;
  model: string;
  systemPrompt?: string;
  tools?: Tool[];
  maxSteps?: number;
}

/**
 * Create a streaming chat endpoint for Astro.
 *
 * @example
 * ```ts
 * // src/pages/api/chat.ts
 * import { createChatEndpoint } from "@hilbras/astro";
 *
 * export const { POST } = createChatEndpoint({
 *   provider: "OpenAI",
 *   model: "gpt-4o",
 * });
 * ```
 */
export function createChatEndpoint(options: EndpointOptions) {
  async function POST({ request }: { request: Request }): Promise<Response> {
    const body = await request.json();
    const { messages, stream } = body as { messages: ChatMessage[]; stream?: boolean };

    const client = new HilbrasClient();
    client.addProviderFromCatalog(options.provider, options.model, process.env.AI_API_KEY ?? "");

    const allMessages = options.systemPrompt
      ? [{ role: "system" as const, content: options.systemPrompt }, ...messages]
      : messages;

    if (stream === false) {
      const result = await client.complete({
        provider: options.provider,
        model: options.model,
        messages: allMessages,
      });
      return new Response(JSON.stringify({
        id: `cmpl-${Date.now()}`,
        choices: [{ message: { role: "assistant", content: result }, finishReason: "stop" }],
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const chunks = client.streamText({
      provider: options.provider,
      model: options.model,
      messages: allMessages,
      tools: options.tools,
      maxSteps: options.maxSteps,
    });

    return createSSEResponse(chunks);
  }

  return { POST };
}

/**
 * Create a non-streaming completion endpoint for Astro.
 */
export function createCompletionEndpoint(options: EndpointOptions) {
  async function POST({ request }: { request: Request }): Promise<Response> {
    const body = await request.json();

    const client = new HilbrasClient();
    client.addProviderFromCatalog(options.provider, options.model, process.env.AI_API_KEY ?? "");

    const result = await client.complete({
      provider: options.provider,
      model: options.model,
      messages: [{ role: "user", content: body.prompt ?? "" }],
    });

    return new Response(JSON.stringify({
      id: `cmpl-${Date.now()}`,
      choices: [{ message: { role: "assistant", content: result }, finishReason: "stop" }],
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return { POST };
}
