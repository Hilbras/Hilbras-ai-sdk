/**
 * @hilbras/remix — Action Helpers
 *
 * Remix action helpers for streaming chat/completion.
 * Uses the HilbrasClient to generate streaming responses with full protocol support.
 */

import { HilbrasClient } from "../../client/client.js";
import { createSSEResponse } from "../../utils/sse-writer.js";
import type { Tool } from "../../types/tools.js";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ActionOptions {
  provider: string;
  model: string;
  systemPrompt?: string;
  tools?: Tool[];
  maxSteps?: number;
}

/**
 * Create a streaming chat action for Remix.
 *
 * @example
 * ```ts
 * // app/routes/api.chat.ts
 * import { createChatAction } from "@hilbras/remix";
 *
 * export const action = createChatAction({
 *   provider: "OpenAI",
 *   model: "gpt-4o",
 * });
 * ```
 */
export function createChatAction(options: ActionOptions) {
  return async ({ request }: { request: Request }) => {
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
  };
}

/**
 * Create a non-streaming completion action for Remix.
 */
export function createCompletionAction(options: ActionOptions) {
  return async ({ request }: { request: Request }) => {
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
  };
}
