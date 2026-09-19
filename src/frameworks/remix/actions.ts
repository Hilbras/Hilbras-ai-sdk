/**
 * @hilbras/remix — Action Helpers
 *
 * Remix action helpers for streaming chat/completion.
 */

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ActionOptions {
  provider: string;
  model: string;
  systemPrompt?: string;
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
    const { messages } = body as { messages: ChatMessage[] };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const allMessages = options.systemPrompt
            ? [{ role: "system" as const, content: options.systemPrompt }, ...messages]
            : messages;

          for (const msg of allMessages) {
            if (msg.role === "user") {
              const response = `Response to: ${msg.content}`;
              for (const char of response) {
                controller.enqueue(encoder.encode(char));
                await new Promise((r) => setTimeout(r, 5));
              }
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  };
}

/**
 * Create a non-streaming completion action for Remix.
 */
export function createCompletionAction(options: ActionOptions) {
  return async ({ request }: { request: Request }) => {
    const body = await request.json();

    return new Response(JSON.stringify({
      id: `cmpl-${Date.now()}`,
      choices: [{
        message: { role: "assistant", content: `Response to: ${body.prompt || ""}` },
        finishReason: "stop",
      }],
    }), {
      headers: { "Content-Type": "application/json" },
    });
  };
}
