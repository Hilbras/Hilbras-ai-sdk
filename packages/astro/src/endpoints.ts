/**
 * @hilbras/astro — Astro API Endpoint
 *
 * Create API endpoints for streaming chat/completion in Astro.
 */

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface EndpointOptions {
  provider: string;
  model: string;
  systemPrompt?: string;
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
    const { messages } = body as { messages: ChatMessage[] };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const allMessages = options.systemPrompt
            ? [{ role: "system" as const, content: options.systemPrompt }, ...messages]
            : messages;

          // Placeholder streaming response
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
  }

  return { POST };
}

/**
 * Create a non-streaming completion endpoint for Astro.
 */
export function createCompletionEndpoint(options: EndpointOptions) {
  async function POST({ request }: { request: Request }): Promise<Response> {
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
  }

  return { POST };
}
