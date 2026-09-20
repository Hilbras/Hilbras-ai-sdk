import { NextRequest } from "next/server";
import { getClient } from "@/lib/client";

export async function POST(req: NextRequest) {
  const { messages, model = "gpt-4o" } = await req.json();
  const client = getClient();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of client.stream({
          messages,
          model,
          provider: "openai",
        })) {
          if (chunk.type === "text") {
            controller.enqueue(encoder.encode(chunk.text));
          }
          if (chunk.type === "usage") {
            controller.enqueue(
              encoder.encode(`\n\n<!-- tokens: ${chunk.inputTokens}in/${chunk.outputTokens}out -->`)
            );
          }
        }
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`\n\n<!-- error: ${message} -->`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
