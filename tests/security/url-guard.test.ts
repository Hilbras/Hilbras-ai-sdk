/**
 * @hilbras/sdk — SSRF guard tests (v0.9.3)
 */

import { describe, it, expect } from "vitest";
import { validateBaseUrl } from "../../src/security/url-guard.js";

describe("validateBaseUrl (v0.9.3 SSRF guard)", () => {
  describe("https — always allowed", () => {
    it("accepts a normal https URL", () => {
      expect(validateBaseUrl("https://api.openai.com/v1")).toEqual({ ok: true });
    });
    it("accepts an https URL with a port", () => {
      expect(validateBaseUrl("https://api.example.com:8443/v1")).toEqual({ ok: true });
    });
  });

  describe("rejected schemes", () => {
    it("rejects file://", () => {
      const r = validateBaseUrl("file:///etc/passwd");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/file/);
    });
    it("rejects javascript:", () => {
      const r = validateBaseUrl("javascript:alert(1)");
      expect(r.ok).toBe(false);
    });
    it("rejects data:", () => {
      expect(validateBaseUrl("data:text/plain,hello").ok).toBe(false);
    });
    it("rejects ftp:", () => {
      expect(validateBaseUrl("ftp://example.com").ok).toBe(false);
    });
    it("rejects ws://", () => {
      expect(validateBaseUrl("ws://example.com").ok).toBe(false);
    });
    it("rejects wss://", () => {
      expect(validateBaseUrl("wss://example.com").ok).toBe(false);
    });
  });

  describe("http:// requires explicit opt-in", () => {
    it("rejects http by default", () => {
      const r = validateBaseUrl("http://example.com");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/allowInsecure/);
    });
    it("rejects http even to public hosts without allowInsecure", () => {
      expect(validateBaseUrl("http://api.example.com").ok).toBe(false);
    });
    it("accepts http to localhost with allowInsecure", () => {
      expect(validateBaseUrl("http://localhost:11434", { allowInsecure: true })).toEqual({ ok: true });
    });
    it("accepts http to 127.0.0.1 with allowInsecure", () => {
      expect(validateBaseUrl("http://127.0.0.1:8080", { allowInsecure: true })).toEqual({ ok: true });
    });
    it("accepts http to [::1] with allowInsecure", () => {
      expect(validateBaseUrl("http://[::1]:8080", { allowInsecure: true })).toEqual({ ok: true });
    });
    it("accepts http to *.local with allowInsecure", () => {
      expect(validateBaseUrl("http://myhost.local", { allowInsecure: true })).toEqual({ ok: true });
    });
  });

  describe("AWS instance metadata is blocked", () => {
    it("rejects 169.254.169.254 even with allowInsecure", () => {
      const r = validateBaseUrl("http://169.254.169.254/latest/meta-data/", { allowInsecure: true });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/instance metadata/);
    });
    it("rejects 169.254.169.254 with allowPrivateNetwork too", () => {
      const r = validateBaseUrl("http://169.254.169.254", { allowInsecure: true, allowPrivateNetwork: true });
      expect(r.ok).toBe(false);
    });
  });

  describe("private network ranges require extra opt-in", () => {
    it("rejects 10.x without allowPrivateNetwork", () => {
      const r = validateBaseUrl("http://10.0.0.1", { allowInsecure: true });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/private network/);
    });
    it("accepts 10.x with allowPrivateNetwork", () => {
      expect(validateBaseUrl("http://10.0.0.1", { allowInsecure: true, allowPrivateNetwork: true })).toEqual({ ok: true });
    });
    it("rejects 192.168.x without allowPrivateNetwork", () => {
      expect(validateBaseUrl("http://192.168.1.10", { allowInsecure: true }).ok).toBe(false);
    });
    it("accepts 192.168.x with allowPrivateNetwork", () => {
      expect(validateBaseUrl("http://192.168.1.10", { allowInsecure: true, allowPrivateNetwork: true })).toEqual({ ok: true });
    });
    it("rejects 172.16-31.x without allowPrivateNetwork", () => {
      expect(validateBaseUrl("http://172.20.5.1", { allowInsecure: true }).ok).toBe(false);
    });
    it("accepts 172.16-31.x with allowPrivateNetwork", () => {
      expect(validateBaseUrl("http://172.20.5.1", { allowInsecure: true, allowPrivateNetwork: true })).toEqual({ ok: true });
    });
    it("does not block 172.0-15.x (not private)", () => {
      expect(validateBaseUrl("http://172.15.0.1", { allowInsecure: true })).toEqual({ ok: true });
    });
    it("does not block 172.32+ (not private)", () => {
      expect(validateBaseUrl("http://172.32.0.1", { allowInsecure: true })).toEqual({ ok: true });
    });
  });

  describe("input validation", () => {
    it("rejects empty string", () => {
      expect(validateBaseUrl("").ok).toBe(false);
    });
    it("rejects non-string", () => {
      expect(validateBaseUrl(undefined as unknown as string).ok).toBe(false);
    });
    it("rejects malformed URL", () => {
      expect(validateBaseUrl("not a url at all").ok).toBe(false);
    });
  });
});
