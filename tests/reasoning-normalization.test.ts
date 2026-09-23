import { describe, expect, it } from "vitest";
import { OpenAIAdapter } from "../src/adapters/openai.js";
import type { Transport } from "../src/transport/transport.js";

function sse(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

describe("request-local reasoning normalization", () => {
  it("does not carry an unterminated reasoning block into the next stream", async () => {
    let requestCount = 0;
    const transport: Transport = {
      async request() {
        requestCount++;
        const content = requestCount === 1 ? "<thinking>secret" : "ordinary";
        return new Response(sse(content), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new OpenAIAdapter({
      provider: {
        name: "test",
        baseUrl: "https://api.example.com/v1",
        authentication: { type: "none" },
        adapter: "openai",
        models: [],
      },
      transport,
    });

    const first = [];
    for await (const chunk of adapter.stream({
      model: "test",
      messages: [{ role: "user", content: "first" }],
      stream: true,
    })) first.push(chunk);
    expect(first.some((chunk) => chunk.type === "reasoning" && chunk.text === "secret")).toBe(true);

    const second = [];
    for await (const chunk of adapter.stream({
      model: "test",
      messages: [{ role: "user", content: "second" }],
      stream: true,
    })) second.push(chunk);

    expect(second.some((chunk) => chunk.type === "text" && chunk.text === "ordinary")).toBe(true);
    expect(second.some((chunk) => chunk.type === "reasoning")).toBe(false);
  });
});
