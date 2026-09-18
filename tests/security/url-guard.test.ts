/**
 * @hilbras/sdk — SSRF guard tests (v0.9.3)
 */

import { describe, it, expect } from "vitest";
import { validateBaseUrl } from "../../src/security/url-guard.js";

describe("validateBaseUrl (v0.9.3 SSRF guard)", () => {
  describe("https — public hosts always allowed", () => {
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

  describe("link-local (169.254.0.0/16) is blocked — http", () => {
    it("rejects 169.254.169.254 even with allowInsecure", () => {
      const r = validateBaseUrl("http://169.254.169.254/latest/meta-data/", { allowInsecure: true });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/link-local/);
    });
    it("rejects 169.254.169.254 with allowPrivateNetwork too", () => {
      const r = validateBaseUrl("http://169.254.169.254", { allowInsecure: true, allowPrivateNetwork: true });
      expect(r.ok).toBe(false);
    });
    it("rejects 169.254.0.1 (wide range)", () => {
      expect(validateBaseUrl("http://169.254.0.1", { allowInsecure: true }).ok).toBe(false);
    });
    it("rejects 169.254.255.255 (wide range)", () => {
      expect(validateBaseUrl("http://169.254.255.255", { allowInsecure: true }).ok).toBe(false);
    });
  });

  describe("link-local (169.254.0.0/16) is blocked — https", () => {
    it("rejects https://169.254.169.254/", () => {
      const r = validateBaseUrl("https://169.254.169.254/latest/meta-data/");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/link-local/);
    });
    it("rejects https://169.254.169.254/ with allowInsecure", () => {
      const r = validateBaseUrl("https://169.254.169.254/", { allowInsecure: true });
      expect(r.ok).toBe(false);
    });
    it("rejects https://169.254.0.1", () => {
      expect(validateBaseUrl("https://169.254.0.1").ok).toBe(false);
    });
    it("rejects https://169.254.255.255", () => {
      expect(validateBaseUrl("https://169.254.255.255").ok).toBe(false);
    });
  });

  describe("private network ranges require extra opt-in — http", () => {
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

  describe("private network ranges require extra opt-in — https", () => {
    it("rejects https://10.0.0.1 without allowPrivateNetwork", () => {
      const r = validateBaseUrl("https://10.0.0.1");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/private network/);
    });
    it("accepts https://10.0.0.1 with allowPrivateNetwork", () => {
      expect(validateBaseUrl("https://10.0.0.1", { allowPrivateNetwork: true })).toEqual({ ok: true });
    });
    it("rejects https://192.168.1.10 without allowPrivateNetwork", () => {
      expect(validateBaseUrl("https://192.168.1.10").ok).toBe(false);
    });
    it("accepts https://192.168.1.10 with allowPrivateNetwork", () => {
      expect(validateBaseUrl("https://192.168.1.10", { allowPrivateNetwork: true })).toEqual({ ok: true });
    });
    it("rejects https://172.20.5.1 without allowPrivateNetwork", () => {
      expect(validateBaseUrl("https://172.20.5.1").ok).toBe(false);
    });
    it("accepts https://172.20.5.1 with allowPrivateNetwork", () => {
      expect(validateBaseUrl("https://172.20.5.1", { allowPrivateNetwork: true })).toEqual({ ok: true });
    });
  });

  describe("localhost works for both schemes", () => {
    it("accepts https://localhost with allowInsecure", () => {
      expect(validateBaseUrl("https://localhost", { allowInsecure: true })).toEqual({ ok: true });
    });
    it("accepts https://127.0.0.1 without allowInsecure", () => {
      expect(validateBaseUrl("https://127.0.0.1")).toEqual({ ok: true });
    });
    it("accepts https://[::1] without allowInsecure", () => {
      expect(validateBaseUrl("https://[::1]")).toEqual({ ok: true });
    });
    it("accepts https://*.local without allowInsecure", () => {
      expect(validateBaseUrl("https://myhost.local")).toEqual({ ok: true });
    });
  });

  describe("obfuscated IP literals are normalized", () => {
    it("blocks hex 0x7f000001 (127.0.0.1) — loopback, allowed with allowInsecure", () => {
      expect(validateBaseUrl("http://0x7f000001:8080", { allowInsecure: true })).toEqual({ ok: true });
    });
    it("blocks hex 0xa000001 (10.0.0.1) — private", () => {
      const r = validateBaseUrl("http://0x0a000001", { allowInsecure: true });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/private network/);
    });
    it("blocks decimal 2130706433 (127.0.0.1) — loopback", () => {
      expect(validateBaseUrl("http://2130706433:8080", { allowInsecure: true })).toEqual({ ok: true });
    });
    it("blocks decimal 167772161 (10.0.0.1) — private", () => {
      const r = validateBaseUrl("http://167772161", { allowInsecure: true });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/private network/);
    });
    it("blocks octal 0177.0.0.1 (127.0.0.1) — loopback", () => {
      expect(validateBaseUrl("http://0177.0.0.1:8080", { allowInsecure: true })).toEqual({ ok: true });
    });
    it("blocks octal 012.0.0.1 (10.0.0.1) — private", () => {
      const r = validateBaseUrl("http://012.0.0.1", { allowInsecure: true });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/private network/);
    });
  });

  describe("IPv6 private/link-local ranges", () => {
    it("rejects https://[fc00::1] (unique-local)", () => {
      const r = validateBaseUrl("https://[fc00::1]");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/private network/);
    });
    it("rejects https://[fd00::1] (unique-local)", () => {
      expect(validateBaseUrl("https://[fd00::1]").ok).toBe(false);
    });
    it("rejects https://[fe80::1] (link-local)", () => {
      const r = validateBaseUrl("https://[fe80::1]");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/private network/);
    });
    it("rejects http://[fc00::1] with allowInsecure but no allowPrivateNetwork", () => {
      const r = validateBaseUrl("http://[fc00::1]", { allowInsecure: true });
      expect(r.ok).toBe(false);
    });
    it("accepts https://[fc00::1] with allowPrivateNetwork", () => {
      expect(validateBaseUrl("https://[fc00::1]", { allowPrivateNetwork: true })).toEqual({ ok: true });
    });
    it("accepts https://[fe80::1] with allowPrivateNetwork", () => {
      expect(validateBaseUrl("https://[fe80::1]", { allowPrivateNetwork: true })).toEqual({ ok: true });
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
