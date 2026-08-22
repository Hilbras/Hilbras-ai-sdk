import { describe, it, expect } from "vitest";
import {
  createDegradationChain,
  withDegradation,
} from "../src/reliability/degradation.js";
import type { Message } from "../src/types/messages.js";
import type { Transport } from "../src/transport/transport.js";

describe("createDegradationChain", () => {
  it("returns 4 levels in order", () => {
    const chain = createDegradationChain();
    expect(chain).toHaveLength(4);
    expect(chain.map((l) => l.name)).toEqual(["normal", "media-degraded", "media-stripped", "history-truncated"]);
  });

  it("normal level returns messages unchanged", () => {
    const chain = createDegradationChain();
    const msgs: Message[] = [{ role: "user", content: "hello" }];
    expect(chain[0].transform(msgs)).toEqual(msgs);
  });

  it("media-degraded replaces base64 images with placeholder", () => {
    const chain = createDegradationChain();
    const msgs: Message[] = [{ role: "user", content: "Look at this: data:image/png;base64,iVBORw0KGgo" }];
    const result = chain[1].transform(msgs);
    expect(result[0].content).toContain("[image omitted for size reduction]");
    expect(result[0].content).not.toContain("base64");
  });

  it("media-stripped removes base64 images entirely", () => {
    const chain = createDegradationChain();
    const msgs: Message[] = [{ role: "user", content: "Image: data:image/jpeg;base64,abc123 and text" }];
    const result = chain[2].transform(msgs);
    expect(result[0].content).toBe("Image:  and text");
  });

  it("media-stripped removes markdown images", () => {
    const chain = createDegradationChain();
    const msgs: Message[] = [{ role: "user", content: "See ![photo](https://example.com/img.png) here" }];
    const result = chain[2].transform(msgs);
    expect(result[0].content).toContain("[image removed]");
    expect(result[0].content).not.toContain("![");
  });

  it("history-truncated keeps system prompt and last 10 messages", () => {
    const chain = createDegradationChain();
    const msgs: Message[] = [
      { role: "system", content: "You are helpful" },
      ...Array.from({ length: 20 }, (_, i) => ({ role: "user" as const, content: `msg ${i}` })),
    ];
    const result = chain[3].transform(msgs);
    expect(result[0].role).toBe("system");
    expect(result[0].content).toBe("You are helpful");
    expect(result.length).toBe(11);
    expect(result[10].content).toBe("msg 19");
  });
});

describe("withDegradation", () => {
  it("returns on first successful level", async () => {
    const transport: Transport = {
      async request() { return new Response("success", { status: 200 }); },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const msgs: Message[] = [{ role: "user", content: "hi" }];
    const { response, level } = await withDegradation(
      transport,
      "https://api.example.com",
      msgs,
      (m) => ({ method: "POST", body: JSON.stringify(m) }),
    );
    expect(await response.text()).toBe("success");
    expect(level).toBe("normal");
  });

  it("degrades on 413 and tries next level", async () => {
    let callCount = 0;
    const transport: Transport = {
      async request() {
        callCount++;
        if (callCount === 1) return new Response("too large", { status: 413 });
        return new Response("ok after degradation", { status: 200 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const msgs: Message[] = [{ role: "user", content: "hi" }];
    const { response, level } = await withDegradation(
      transport,
      "https://api.example.com",
      msgs,
      (m) => ({ method: "POST", body: JSON.stringify(m) }),
    );
    expect(await response.text()).toBe("ok after degradation");
    expect(level).not.toBe("normal");
    expect(callCount).toBe(2);
  });

  it("throws on non-degradation errors (401)", async () => {
    const transport: Transport = {
      async request() { return new Response("unauthorized", { status: 401 }); },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const msgs: Message[] = [{ role: "user", content: "hi" }];
    await expect(withDegradation(
      transport,
      "https://api.example.com",
      msgs,
      (m) => ({ method: "POST", body: JSON.stringify(m) }),
    )).rejects.toThrow("HTTP 401");
  });

  it("throws when all levels fail", async () => {
    const transport: Transport = {
      async request() { return new Response("too large", { status: 413 }); },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const msgs: Message[] = [{ role: "user", content: "hi" }];
    await expect(withDegradation(
      transport,
      "https://api.example.com",
      msgs,
      (m) => ({ method: "POST", body: JSON.stringify(m) }),
    )).rejects.toThrow("All degradation levels failed");
  });
});
