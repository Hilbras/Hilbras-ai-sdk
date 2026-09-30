/**
 * @hilbras/nextjs — Server Client
 *
 * @deprecated This module is a non-functional stub and will be removed in
 * 4.0.0. `ServerHilbrasClient.streamResponse` never calls a provider: it
 * echoes each user message back character by character, and ignores `apiKey`,
 * `baseUrl`, `adapter`, `provider` and `model` entirely. It is kept only so an
 * existing import resolves.
 *
 * Use `new HilbrasClient()` directly:
 *
 * ```ts
 * import { HilbrasClient } from "@hilbras/sdk";
 *
 * const client = new HilbrasClient();
 * client.addProviderFromCatalog("openai", "gpt-4o", process.env.OPENAI_API_KEY!);
 *
 * export async function POST(req: Request) {
 *   const { messages } = await req.json();
 *   return client.streamText({ provider: "OpenAI", model: "gpt-4o", messages });
 * }
 * ```
 *
 * Or, for a route handler with no client plumbing, use `createChatHandler`.
 */

export interface ServerClientOptions {
  /** API key (defaults to env vars) */
  apiKey?: string;
  /** Base URL for the provider */
  baseUrl?: string;
  /** Provider adapter */
  adapter?: string;
  /** Default provider name */
  provider?: string;
  /** Default model */
  model?: string;
}

/**
 * Create a HilbrasClient for server-side use.
 *
 * @example
 * ```ts
 * // app/api/chat/route.ts
 * import { createServerClient } from "@hilbras/nextjs";
 *
 * const client = createServerClient({
 *   apiKey: process.env.OPENAI_API_KEY,
 *   provider: "OpenAI",
 *   model: "gpt-4o",
 * });
 *
 * export async function POST(req: Request) {
 *   const { messages } = await req.json();
 *   const stream = client.stream({
 *     provider: "OpenAI",
 *     model: "gpt-4o",
 *     messages,
 *   });
 *   return new Response(stream);
 * }
 * ```
 */
export function createServerClient(options: ServerClientOptions = {}): ServerHilbrasClient {
  return new ServerHilbrasClient(options);
}

/**
 * Server-side HilbrasClient wrapper with Next.js helpers.
 */
export class ServerHilbrasClient {
  private _options: ServerClientOptions;

  constructor(options: ServerClientOptions = {}) {
    this._options = options;
  }

  /**
   * Create a streaming response for Next.js App Router.
   *
   * @deprecated Returns a simulated echo of the request, not a provider
   * response. Removed in 4.0.0 — see the module deprecation notice.
   */
  async streamResponse(params: {
    messages: Array<{ role: string; content: string }>;
    model?: string;
    provider?: string;
    systemPrompt?: string;
  }): Promise<Response> {
    const { messages, model, provider, systemPrompt } = params;

    const allMessages = systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages;

    // In a real implementation, this would use the actual SDK client
    // For now, return a placeholder that demonstrates the API
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Simulated streaming response
        for (const msg of allMessages) {
          if (msg.role === "user") {
            const response = `Response to: ${msg.content}`;
            for (const char of response) {
              controller.enqueue(encoder.encode(char));
              await new Promise((r) => setTimeout(r, 10));
            }
          }
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    });
  }

  /**
   * Get configuration for generateMetadata.
   */
  getMetadata(params: {
    title?: string;
    description?: string;
    model?: string;
  }) {
    return {
      title: params.title || "AI Chat",
      description: params.description || `Powered by ${params.model || "AI"}`,
      openGraph: {
        title: params.title,
        description: params.description,
      },
    };
  }
}
