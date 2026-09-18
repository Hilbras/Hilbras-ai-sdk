/**
 * @hilbras/nextjs — Route Handler Helpers
 *
 * Helpers for Next.js App Router route handlers.
 */

export interface ChatRequest {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  provider?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
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
}) {
  async function POST(req: Request): Promise<Response> {
    const body: ChatRequest = await req.json();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Placeholder streaming response
          const response = `Echo: ${body.messages.map((m) => m.content).join(", ")}`;
          for (const char of response) {
            controller.enqueue(encoder.encode(char));
            await new Promise((r) => setTimeout(r, 5));
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
        "Connection": "keep-alive",
      },
    });
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

    return Response.json({
      id: `cmpl-${Date.now()}`,
      choices: [{
        message: {
          role: "assistant",
          content: `Response to: ${body.prompt || ""}`,
        },
        finishReason: "stop",
      }],
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
    });
  }

  return { POST };
}
