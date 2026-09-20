import { describe, it, expect, vi } from "vitest";
import { hilbrasMiddleware } from "../src/middleware.js";

function createRequest(path = "/api/chat", ip = "127.0.0.1") {
  return {
    nextUrl: { pathname: path },
    headers: new Map([["x-forwarded-for", ip]]),
    ip,
  } as any;
}

describe("hilbrasMiddleware", () => {
  it("allows requests within limit", () => {
    const mw = hilbrasMiddleware({ maxRequests: 5, windowSeconds: 60 });
    const req = createRequest();

    for (let i = 0; i < 5; i++) {
      const res = mw(req);
      expect(res.status ?? 200).not.toBe(429);
    }
  });

  it("blocks requests over limit", () => {
    const mw = hilbrasMiddleware({ maxRequests: 2, windowSeconds: 60 });
    const req = createRequest();

    mw(req); // 1st
    mw(req); // 2nd
    const res = mw(req); // 3rd — should block

    expect(res.status).toBe(429);
  });

  it("excludes configured paths", () => {
    const mw = hilbrasMiddleware({ excludePaths: ["/api/health"] });
    const req = createRequest("/api/health");

    const res = mw(req);
    expect(res.status ?? 200).not.toBe(429);
  });

  it("tracks different IPs separately", () => {
    const mw = hilbrasMiddleware({ maxRequests: 1, windowSeconds: 60 });

    const req1 = createRequest("/api/chat", "1.1.1.1");
    const req2 = createRequest("/api/chat", "2.2.2.2");

    mw(req1); // 1st from IP1 — ok
    const res2 = mw(req2); // 1st from IP2 — ok
    expect(res2.status ?? 200).not.toBe(429);

    const res3 = mw(req1); // 2nd from IP1 — blocked
    expect(res3.status).toBe(429);
  });

  it("returns Retry-After header", () => {
    const mw = hilbrasMiddleware({ maxRequests: 1, windowSeconds: 60 });
    const req = createRequest();

    mw(req);
    const res = mw(req);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});
