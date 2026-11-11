/**
 * @hilbras/sdk — Config snapshot safety (B5)
 *
 * `safeSnapshot()` is the redacted projection used for logs and tooling. It
 * crashed on a malformed `providers` value, and it left credential-bearing
 * URLs in place: the webhook channel URL (keyed `url`, not `webhook`) and the
 * URL echoed inside a rejection diagnostic.
 */

import { describe, it, expect } from "vitest";
import { resolveConfig } from "../../src/config/config-resolver.js";

const WEBHOOK_TOKEN = "SUPERSECRETWEBHOOKTOKEN";
const URL_KEY = "sk-abcdefghijklmnopqrstuvwxyz0123";

function resolve(overrides: Record<string, unknown>) {
  return resolveConfig({ overrides: overrides as never, strict: false });
}

describe("config snapshot safety", () => {
  it("does not throw when providers is not an array", () => {
    const config = resolve({ providers: null });

    expect(() => config.safeSnapshot()).not.toThrow();
    expect(Array.isArray(config.safeSnapshot().providers)).toBe(true);
  });

  it("redacts an alert-channel URL", () => {
    const config = resolve({
      costAlerts: { defaultChannel: { type: "webhook", url: `https://hooks.slack.com/services/${WEBHOOK_TOKEN}` } },
    });

    const snapshot = JSON.stringify(config.safeSnapshot());
    expect(snapshot).not.toContain(WEBHOOK_TOKEN);
  });

  it("still exposes a provider baseUrl, which is not a secret", () => {
    const config = resolve({
      providers: [
        {
          name: "openai",
          baseUrl: "https://api.openai.com/v1",
          authentication: { type: "none" },
          models: [],
          adapter: "openai",
        },
      ],
    });

    expect(JSON.stringify(config.safeSnapshot())).toContain("https://api.openai.com/v1");
  });

  it("does not echo a credential-bearing URL into diagnostics", () => {
    const config = resolve({
      providers: [
        {
          name: "local",
          baseUrl: `http://127.0.0.1/v1?api_key=${URL_KEY}`,
          authentication: { type: "none" },
          models: [],
          adapter: "openai-compatible",
        },
      ],
    });

    const unsafe = config.diagnostics.filter((d) => d.code === "CONFIG_UNSAFE_PROVIDER_URL");
    expect(unsafe.length).toBeGreaterThan(0);
    expect(JSON.stringify(unsafe)).not.toContain(URL_KEY);
  });
});
