/**
 * @hilbras/sdk — Value-based credential redaction
 *
 * `redact()` matches `\bsk-[A-Za-z0-9\-_]{20,}`, so a short key is invisible to
 * it and leaked into error messages and logs. The SDK knows the keys it was
 * configured with, so they are now registered and scrubbed by exact value —
 * no pattern, no length floor, no false positives.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { HilbrasClient } from "../../src/client/client.js";
import { redact } from "../../src/logging/logger.js";

/** 11 characters: below the 20-after-`sk-` floor the pattern requires. */
const SHORT_KEY = "sk-local123";

afterEach(() => {
  vi.unstubAllGlobals();
});

function clientWithKey(key: string, echoKeyInBody = true): HilbrasClient {
  const client = new HilbrasClient({
    transport: {
      async request() {
        const message = echoKeyInBody ? `bad key ${key}` : "nope";
        return new Response(JSON.stringify({ error: { message } }), { status: 401 });
      },
      async stream() {
        throw new Error("unused");
      },
      abort() {},
    },
  });
  client.addProvider({
    name: "Local",
    baseUrl: "https://local.test",
    authentication: { type: "bearer", apiKey: key },
    adapter: "openai",
    models: [{
      id: "m",
      contextWindow: 1000,
      capabilities: {
        streaming: true, tools: false, vision: false, reasoning: false,
        structuredOutput: false, parallelTools: false, systemPrompts: true,
        embeddings: false, imageGeneration: false, speech: false,
        transcription: false, reranking: false,
      },
    }],
  });
  return client;
}

describe("short credentials are redacted by value", () => {
  it("keeps a short key out of provider error messages", async () => {
    const client = clientWithKey(SHORT_KEY);

    const err = await client
      .complete({ provider: "Local", model: "m", messages: [{ role: "user", content: "hi" }] })
      .then(() => null, (error: unknown) => error);

    expect(err).not.toBeNull();
    expect(String(err)).not.toContain(SHORT_KEY);
  });

  it("keeps a short key out of arbitrary log text", () => {
    clientWithKey(SHORT_KEY, false);

    expect(redact(`upstream rejected ${SHORT_KEY} at 12:00`)).not.toContain(SHORT_KEY);
  });

  it("still redacts long keys by pattern, without registration", () => {
    const longKey = "sk-abcdefghijklmnopqrstuvwxyz012345";

    expect(redact(`key=${longKey}`)).not.toContain(longKey);
    expect(redact(`key=${longKey}`)).toContain("[REDACTED]");
  });

  it("leaves unrelated text alone", () => {
    clientWithKey(SHORT_KEY, false);

    expect(redact("the quick brown fox")).toBe("the quick brown fox");
  });
});
