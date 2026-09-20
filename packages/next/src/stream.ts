import { HilbrasClient, type HilbrasClientConfig, type ChatMessage } from "@hilbras/sdk";
import { type NextRequest, NextResponse } from "next/server";

export interface StreamChatOptions {
  /** HilbrasClient config (creates new client if not provided) */
  config?: HilbrasClientConfig;
  /** Pre-existing client instance */
  client?: HilbrasClient;
  /** Default provider */
  provider: string;
  /** Default model */
  model: string;
  /** System prompt */
  systemPrompt?: string;
  /** Custom error handler */
  onError?: (error: Error) => Response | Promise<Response>;
  /** Called before streaming starts */
  onRequest?: (messages: ChatMessage[]) => void | Promise<void>;
  /** Called after streaming completes */
  onComplete?: (messages: ChatMessage[], usage: { inputTokens: number; outputTokens: number }) => void | Promise<void>;
}

/**
 * Create a streaming chat API route for Next.js App Router.
 *
 * @example
 * ```ts
 * // app/api/chat/route.ts
 * import { createStreamHandler } from "@hilbras/next";
 *
 * export const { POST } = createStreamHandler({
 *   provider: "openai",
 *   model: "gpt-4o",
 *   systemPrompt: "You are a helpful assistant.",
 * });
 * ```
 */
export function createStreamHandler(options: StreamChatOptions) {
  const { config, client: existingClient, provider, model, systemPrompt, onError, onRequest, onComplete } = options;

  const client = existingClient ?? new HilbrasClient(config);

  async function POST(request: NextRequest) {
    try {
      const body = await request.json();
      const messages: ChatMessage[] = body.messages ?? [];

      await onRequest?.(messages);

      const apiMessages = [];
      if (systemPrompt) {
        apiMessages.push({ role: "system" as const, content: systemPrompt });
      }
      for (const msg of messages) {
        apiMessages.push({ role: msg.role, content: msg.content });
      }

      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          let inputTokens = 0;
          let outputTokens = 0;

          try {
            for await (const chunk of client.stream({
              messages: apiMessages,
              model,
              provider,
            })) {
              if (chunk.type === "text") {
                controller.enqueue(encoder.encode(`0:${JSON.stringify(chunk.text)}\n`));
              }
              if (chunk.type === "usage") {
                inputTokens = chunk.inputTokens ?? 0;
                outputTokens = chunk.outputTokens ?? 0;
                controller.enqueue(
                  encoder.encode(`1:${JSON.stringify({ inputTokens, outputTokens })}\n`)
                );
              }
              if (chunk.type === "finish") {
                controller.enqueue(encoder.encode(`2:${JSON.stringify(chunk.finishReason ?? "stop")}\n`));
              }
            }

            await onComplete?.(messages, { inputTokens, outputTokens });
          } catch (err) {
            controller.enqueue(
              encoder.encode(`3:${JSON.stringify(err instanceof Error ? err.message : String(err))}\n`)
            );
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (onError) return onError(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return { POST };
}

export interface StreamCompletionOptions {
  config?: HilbrasClientConfig;
  client?: HilbrasClient;
  provider: string;
  model: string;
  systemPrompt?: string;
  onError?: (error: Error) => Response | Promise<Response>;
}

/**
 * Create a streaming completion API route.
 *
 * @example
 * ```ts
 * // app/api/complete/route.ts
 * import { createStreamCompletionHandler } from "@hilbras/next";
 *
 * export const { POST } = createStreamCompletionHandler({
 *   provider: "openai",
 *   model: "gpt-4o",
 * });
 * ```
 */
export function createStreamCompletionHandler(options: StreamCompletionOptions) {
  const { config, client: existingClient, provider, model, systemPrompt, onError } = options;

  const client = existingClient ?? new HilbrasClient(config);

  async function POST(request: NextRequest) {
    try {
      const body = await request.json();
      const { prompt } = body;

      const apiMessages = [];
      if (systemPrompt) {
        apiMessages.push({ role: "system" as const, content: systemPrompt });
      }
      apiMessages.push({ role: "user" as const, content: prompt });

      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();

          try {
            for await (const chunk of client.stream({
              messages: apiMessages,
              model,
              provider,
            })) {
              if (chunk.type === "text") {
                controller.enqueue(encoder.encode(chunk.text));
              }
            }
          } catch (err) {
            controller.enqueue(
              encoder.encode(`Error: ${err instanceof Error ? err.message : String(err)}`)
            );
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (onError) return onError(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return { POST };
}
