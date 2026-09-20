import { Hono } from "hono";
import { cors } from "hono/cors";
import { HilbrasClient } from "@hilbras/sdk";
import { z } from "zod";

const app = new Hono();
app.use("/*", cors());

// --- Client setup ---
const client = new HilbrasClient({
  providers: [
    {
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
      authentication: { type: "bearer", apiKey: process.env.OPENAI_API_KEY! },
      adapter: "openai",
      models: [
        { id: "gpt-4o", contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true },
      ],
    },
  ],
  budget: { sessionBudget: parseFloat(process.env.HILBRAS_BUDGET ?? "5.00") },
});

// --- Streaming chat ---
app.post("/api/chat", async (c) => {
  const { messages, model = "gpt-4o" } = await c.req.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of client.stream({ messages, model, provider: "openai" })) {
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
});

// --- Structured output ---
const AnalysisSchema = z.object({
  summary: z.string(),
  sentiment: z.enum(["positive", "negative", "neutral"]),
  keyPoints: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

app.post("/api/structured", async (c) => {
  const { text, model = "gpt-4o" } = await c.req.json();

  try {
    const result = await client.complete({
      messages: [
        { role: "system", content: "Analyze the given text and return structured analysis." },
        { role: "user", content: text },
      ],
      model,
      provider: "openai",
      output: { schema: AnalysisSchema },
    });

    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

// --- Cost report ---
app.get("/api/costs", (c) => {
  return c.json(client.costReport());
});

// --- Health check ---
app.get("/", (c) => {
  return c.json({
    name: "hilbras-sdk-hono-example",
    version: "0.1.0",
    endpoints: ["/api/chat", "/api/structured", "/api/costs"],
  });
});

const port = parseInt(process.env.PORT ?? "3000");
console.log(`Hono server running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
