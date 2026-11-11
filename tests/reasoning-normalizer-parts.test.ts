/**
 * @hilbras/sdk — Reasoning split across one delta (D1)
 *
 * A delta can carry a complete reasoning block *and* the reply that follows it.
 * The old single-chunk return value emitted everything after the opening tag as
 * reasoning, so the answer was swallowed and the closing tag leaked into the
 * reasoning text.
 */

import { describe, expect, it } from "vitest";
import { ReasoningNormalizer } from "../src/reasoning/normalizer.js";
import { OpenAIAdapter } from "../src/adapters/openai.js";
import type { Transport } from "../src/transport/transport.js";

describe("ReasoningNormalizer.feedText parts", () => {
  it("splits a reasoning block and the reply that shares its delta", () => {
    const normalizer = new ReasoningNormalizer();

    expect(normalizer.feedText("<thinking>2+2=4</thinking>The answer is 4")).toEqual([
      { type: "reasoning", text: "2+2=4" },
      { type: "text", text: "The answer is 4" },
    ]);
  });

  it("splits at a closing tag that arrives mid-delta", () => {
    const normalizer = new ReasoningNormalizer();

    expect(normalizer.feedText("<thinking>")).toEqual([]);
    expect(normalizer.feedText("step one</thinking>answer")).toEqual([
      { type: "reasoning", text: "step one" },
      { type: "text", text: "answer" },
    ]);
  });

  it("emits nothing for plain text and consumes bare tags", () => {
    const normalizer = new ReasoningNormalizer();

    expect(normalizer.feedText("just a question")).toEqual([]);
    expect(normalizer.feedText("<thinking>")).toEqual([]);
    expect(normalizer.feedText("</thinking>")).toEqual([]);
    expect(normalizer.feedText("the reply")).toEqual([]);
  });

  it("returns reasoning for each delta while inside a block", () => {
    const normalizer = new ReasoningNormalizer();

    expect(normalizer.feedText("<reasoning>")).toEqual([]);
    expect(normalizer.feedText("first ")).toEqual([{ type: "reasoning", text: "first " }]);
    expect(normalizer.feedText("second")).toEqual([{ type: "reasoning", text: "second" }]);
    expect(normalizer.feedText("</reasoning>done")).toEqual([{ type: "text", text: "done" }]);
  });
});

describe("adapter surfaces both parts of a mixed delta", () => {
  it("yields the reasoning and then the reply", async () => {
    const sse = (content: string): string =>
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;

    const transport: Transport = {
      async request() {
        return new Response(sse("<thinking>2+2=4</thinking>The answer is 4"), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
      async stream() {
        throw new Error("unused");
      },
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

    const chunks = [];
    for await (const chunk of adapter.stream({
      model: "test",
      messages: [{ role: "user", content: "go" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual({ type: "reasoning", text: "2+2=4" });
    expect(chunks).toContainEqual({ type: "text", text: "The answer is 4" });
    const reasoning = chunks
      .filter((chunk) => chunk.type === "reasoning")
      .map((chunk) => (chunk as { text: string }).text)
      .join("");
    expect(reasoning).not.toContain("</thinking>");
  });
});
