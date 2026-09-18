/**
 * @hilbras/sdk — SSRF guard integration with HilbrasClient.addProvider (v0.9.3)
 */

import { describe, it, expect } from "vitest";
import { HilbrasClient } from "../../src/client/client.js";
import { ConfigurationError } from "../../src/errors/index.js";

function makeProvider(baseUrl: string, allowInsecure?: boolean) {
  return {
    name: "Test",
    baseUrl,
    authentication: { type: "none" as const },
    adapter: "openai" as const,
    models: [{ id: "m", contextWindow: 1000, capabilities: { streaming: true, tools: false, vision: false, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: true } }],
    ...(allowInsecure !== undefined ? { allowInsecure } : {}),
  };
}

describe("HilbrasClient.addProvider SSRF guard (v0.9.3)", () => {
  it("accepts https baseUrl", () => {
    const client = new HilbrasClient();
    expect(() => client.addProvider(makeProvider("https://api.openai.com/v1"))).not.toThrow();
  });

  it("rejects http:// to public host with ConfigurationError", () => {
    const client = new HilbrasClient();
    expect(() => client.addProvider(makeProvider("http://api.example.com")))
      .toThrow(ConfigurationError);
  });

  it("rejects file:// baseUrl", () => {
    const client = new HilbrasClient();
    expect(() => client.addProvider(makeProvider("file:///etc/passwd")))
      .toThrow(ConfigurationError);
  });

  it("rejects AWS metadata IP even with allowInsecureUrls client-wide", () => {
    const client = new HilbrasClient({ allowInsecureUrls: true });
    expect(() => client.addProvider(makeProvider("http://169.254.169.254/")))
      .toThrow(ConfigurationError);
  });

  it("rejects private network without allowPrivateNetwork", () => {
    const client = new HilbrasClient({ allowInsecureUrls: true });
    expect(() => client.addProvider(makeProvider("http://10.0.0.1")))
      .toThrow(ConfigurationError);
  });

  it("accepts private network with allowInsecureUrls + allowPrivateNetwork", () => {
    const client = new HilbrasClient({ allowInsecureUrls: true, allowPrivateNetwork: true });
    expect(() => client.addProvider(makeProvider("http://10.0.0.1"))).not.toThrow();
  });

  it("per-provider allowInsecure overrides default rejection of http", () => {
    const client = new HilbrasClient();
    expect(() => client.addProvider(makeProvider("http://localhost:11434", true))).not.toThrow();
  });

  it("error message names the rejected URL", () => {
    const client = new HilbrasClient();
    let caught: unknown;
    try {
      client.addProvider(makeProvider("http://api.example.com"));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigurationError);
    expect(String(caught)).toContain("http://api.example.com");
  });

  // ─── HTTPS SSRF bypass regression tests ──────────────────────────────

  describe("HTTPS SSRF bypass prevention", () => {
    it("rejects https://169.254.169.254/ (AWS metadata via HTTPS)", () => {
      const client = new HilbrasClient();
      expect(() => client.addProvider(makeProvider("https://169.254.169.254/")))
        .toThrow(ConfigurationError);
    });

    it("rejects https://169.254.169.254/ even with allowInsecureUrls", () => {
      const client = new HilbrasClient({ allowInsecureUrls: true });
      expect(() => client.addProvider(makeProvider("https://169.254.169.254/")))
        .toThrow(ConfigurationError);
    });

    it("rejects https://192.168.1.1/ (private network via HTTPS)", () => {
      const client = new HilbrasClient();
      expect(() => client.addProvider(makeProvider("https://192.168.1.1/")))
        .toThrow(ConfigurationError);
    });

    it("rejects https://192.168.1.1/ even with allowInsecureUrls", () => {
      const client = new HilbrasClient({ allowInsecureUrls: true });
      expect(() => client.addProvider(makeProvider("https://192.168.1.1/")))
        .toThrow(ConfigurationError);
    });

    it("rejects https://10.0.0.1/ (private network via HTTPS)", () => {
      const client = new HilbrasClient();
      expect(() => client.addProvider(makeProvider("https://10.0.0.1/")))
        .toThrow(ConfigurationError);
    });

    it("rejects https://10.0.0.1/ even with allowInsecureUrls", () => {
      const client = new HilbrasClient({ allowInsecureUrls: true });
      expect(() => client.addProvider(makeProvider("https://10.0.0.1/")))
        .toThrow(ConfigurationError);
    });

    it("accepts https://10.0.0.1/ with allowPrivateNetwork", () => {
      const client = new HilbrasClient({ allowPrivateNetwork: true });
      expect(() => client.addProvider(makeProvider("https://10.0.0.1/"))).not.toThrow();
    });

    it("rejects https://[fc00::1] (IPv6 unique-local via HTTPS)", () => {
      const client = new HilbrasClient();
      expect(() => client.addProvider(makeProvider("https://[fc00::1]")))
        .toThrow(ConfigurationError);
    });

    it("rejects https://[fe80::1] (IPv6 link-local via HTTPS)", () => {
      const client = new HilbrasClient();
      expect(() => client.addProvider(makeProvider("https://[fe80::1]")))
        .toThrow(ConfigurationError);
    });
  });
});
