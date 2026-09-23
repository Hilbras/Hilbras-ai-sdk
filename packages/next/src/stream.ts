import {
  HilbrasClient,
  type HilbrasClientConfig,
  type Message,
} from "@hilbras/sdk";
import { type NextRequest, NextResponse } from "next/server";

export type ChatMessage = Message;

const ROLES = new Set(["system", "user", "assistant", "tool"]);

function parseMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) throw new Error("Request body must include a messages array");
  return value.map((message) => {
    if (typeof message !== "object" || message === null) {
      throw new Error("Each message must be an object");
    }
    const candidate = message as Record<string, unknown>;
    if (typeof candidate.role !== "string" || !ROLES.has(candidate.role)) {
      throw new Error("Message role is invalid");
    }
    if (typeof candidate.content !== "string" && candidate.content !== null && !Array.isArray(candidate.content)) {
      throw new Error("Message content is invalid");
    }
    return candidate as unknown as ChatMessage;
  });
}

function createRouteClient(options: {
  config?: HilbrasClientConfig;
  client?: HilbrasClient;
  apiKey?: string;
  provider: string;
  model: string;
}): { client: HilbrasClient; provider: string } {
  if (options.client) return { client: options.client, provider: options.provider };
  const client = new HilbrasClient(options.config);
  const provider = client.addProviderFromCatalog(
    options.provider,
    options.model,
    options.apiKey ?? process.env.HILBRAS_API_KEY ?? "",
  );
  return { client, provider };
}

export interface StreamChatOptions {
  /** HilbrasClient config (creates a new client if not provided) */
  config?: HilbrasClientConfig;
  /** Pre-existing client instance */
  client?: HilbrasClient;
  /** Catalog provider id used when this helper creates the client */
  provider: string;
  /** Default model */
  model: string;
  /** Credential for a newly created catalog-backed client */
  apiKey?: string;
  /** System prompt */
  systemPrompt?: string;
  /** Custom error handler */
  onError?: (error: Error) => Response | Promise<Response>;
  /** Called before streaming starts */
  onRequest?: (messages: ChatMessage[]) => void | Promise<void>;
  /** Called after streaming completes */
  onComplete?: (messages: ChatMessage[], usage: { inputTokens: number; outputTokens: number }) => void | Promise<void>;
}

/** Create a streaming chat API route for Next.js App Router. */
export function createStreamHandler(options: StreamChatOptions) {
  const { config, client: existingClient, provider, model, systemPrompt, apiKey, onError, onRequest, onComplete } = options;
  const route = createRouteClient({ config, client: existingClient, apiKey, provider, model });

  async function POST(request: NextRequest) {
    try {
      const body = await request.json() as unknown;
      const record = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
      const messages = parseMessages(record.messages);

      await onRequest?.(messages);

      const apiMessages: ChatMessage[] = [];
      if (systemPrompt) apiMessages.push({ role: "system", content: systemPrompt });
      apiMessages.push(...messages);

      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          let inputTokens = 0;
          let outputTokens = 0;

          try {
            for await (const chunk of route.client.stream({
              messages: apiMessages,
              model,
              provider: route.provider,
              signal: request.signal,
            })) {
              if (chunk.type === "text") {
                controller.enqueue(encoder.encode(`0:${JSON.stringify(chunk.text)}\n`));
              } else if (chunk.type === "usage") {
                inputTokens = chunk.inputTokens;
                outputTokens = chunk.outputTokens;
                controller.enqueue(
                  encoder.encode(`1:${JSON.stringify({ inputTokens, outputTokens })}\n`),
                );
              } else if (chunk.type === "finish") {
                controller.enqueue(encoder.encode(`2:${JSON.stringify(chunk.reason)}\n`));
              }
            }
            await onComplete?.(messages, { inputTokens, outputTokens });
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            await onError?.(error);
            controller.enqueue(encoder.encode(`3:${JSON.stringify("stream_failed")}\n`));
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
        },
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (onError) return onError(error);
      return NextResponse.json({ error: "Request failed" }, { status: 400 });
    }
  }

  return { POST };
}

export interface StreamCompletionOptions {
  config?: HilbrasClientConfig;
  client?: HilbrasClient;
  provider: string;
  model: string;
  apiKey?: string;
  systemPrompt?: string;
  onError?: (error: Error) => Response | Promise<Response>;
}

/** Create a streaming text-completion API route. */
export function createStreamCompletionHandler(options: StreamCompletionOptions) {
  const { config, client: existingClient, provider, model, systemPrompt, apiKey, onError } = options;
  const route = createRouteClient({ config, client: existingClient, apiKey, provider, model });

  async function POST(request: NextRequest) {
    try {
      const body = await request.json() as unknown;
      const record = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
      if (typeof record.prompt !== "string" || !record.prompt.trim()) {
        throw new Error("Request body must include a non-empty prompt");
      }
      const apiMessages: ChatMessage[] = [];
      if (systemPrompt) apiMessages.push({ role: "system", content: systemPrompt });
      apiMessages.push({ role: "user", content: record.prompt });

      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            for await (const chunk of route.client.stream({
              messages: apiMessages,
              model,
              provider: route.provider,
              signal: request.signal,
            })) {
              if (chunk.type === "text") controller.enqueue(encoder.encode(chunk.text));
            }
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            await onError?.(error);
            controller.enqueue(encoder.encode("stream_failed"));
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (onError) return onError(error);
      return NextResponse.json({ error: "Request failed" }, { status: 400 });
    }
  }

  return { POST };
}
