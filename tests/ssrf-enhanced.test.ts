import { describe, it, expect } from "vitest";
import { validateBaseUrl, validateResolvedAddress, normalizeHostname, validateUrlForTransport } from "../src/security/url-guard.js";

describe("Enhanced SSRF Validation", () => {
  describe("normalizeHostname", () => {
    it("strips trailing dots", () => {
      expect(normalizeHostname("example.com.")).toBe("example.com");
    });

    it("normalizes fullwidth dots", () => {
      expect(normalizeHostname("example\uFF0Ecom")).toBe("example.com");
    });

    it("normalizes fullwidth colons in IPv6", () => {
      expect(normalizeHostname("[\uFF1A\uFF1A1]")).toBe("[::1]");
    });

    it("handles normal hostnames unchanged", () => {
      expect(normalizeHostname("api.openai.com")).toBe("api.openai.com");
    });

    it("handles localhost", () => {
      expect(normalizeHostname("localhost")).toBe("localhost");
    });
  });

  describe("validateResolvedAddress", () => {
    it("allows public IPs", () => {
      const result = validateResolvedAddress("203.0.113.1", "api.openai.com");
      expect(result.ok).toBe(true);
    });

    it("blocks 169.254.x.x (link-local / metadata)", () => {
      const result = validateResolvedAddress("169.254.169.254", "metadata.aws.com");
      expect(result.ok).toBe(false);
    });

    it("blocks 10.x.x.x (private)", () => {
      const result = validateResolvedAddress("10.0.0.1", "internal.corp");
      expect(result.ok).toBe(false);
    });

    it("blocks IPv4 loopback resolved addresses", () => {
      const result = validateResolvedAddress("127.0.0.1", "localhost");
      expect(result.ok).toBe(false);
    });

    it("blocks 0.0.0.0 (unspecified)", () => {
      const result = validateResolvedAddress("0.0.0.0", "example.com");
      expect(result.ok).toBe(false);
    });

    it("blocks multicast 224.x.x.x", () => {
      const result = validateResolvedAddress("224.0.0.1", "example.com");
      expect(result.ok).toBe(false);
    });

    it("blocks CGNAT 100.64.x.x", () => {
      const result = validateResolvedAddress("100.64.0.1", "example.com");
      expect(result.ok).toBe(false);
    });

    it("blocks benchmarking 198.18.x.x", () => {
      const result = validateResolvedAddress("198.18.0.1", "example.com");
      expect(result.ok).toBe(false);
    });

    it("blocks IPv6 link-local", () => {
      const result = validateResolvedAddress("fe80::1", "example.com");
      expect(result.ok).toBe(false);
    });

    it("blocks IPv6 unique-local", () => {
      const result = validateResolvedAddress("fd00::1", "example.com");
      expect(result.ok).toBe(false);
    });

    it("blocks IPv4-mapped IPv6 addresses", () => {
      const result = validateResolvedAddress("::ffff:127.0.0.1", "example.com");
      expect(result.ok).toBe(false);
    });

    it("blocks 192.168.x.x (private)", () => {
      const result = validateResolvedAddress("192.168.1.1", "example.com");
      expect(result.ok).toBe(false);
    });

    it("blocks 172.16-31.x.x (private)", () => {
      const result = validateResolvedAddress("172.16.0.1", "example.com");
      expect(result.ok).toBe(false);
    });
  });

  describe("validateUrlForTransport", () => {
    it("passes valid https URL", () => {
      const result = validateUrlForTransport("https://api.openai.com/v1/chat");
      expect(result.ok).toBe(true);
    });

    it("blocks invalid URL", () => {
      const result = validateUrlForTransport("not-a-url");
      expect(result.ok).toBe(false);
    });

    it("blocks private network URL", () => {
      const result = validateUrlForTransport("https://10.0.0.1/api");
      expect(result.ok).toBe(false);
    });

    it("allows private network with allowPrivateNetwork", () => {
      const result = validateUrlForTransport("https://10.0.0.1/api", { allowPrivateNetwork: true });
      expect(result.ok).toBe(true);
    });

    it("blocks empty URL", () => {
      const result = validateUrlForTransport("");
      expect(result.ok).toBe(false);
    });

    it("blocks file:// protocol", () => {
      const result = validateUrlForTransport("file:///etc/passwd");
      expect(result.ok).toBe(false);
    });
  });

  describe("IPv6 scope ID handling", () => {
    it("requires an explicit opt-in for IPv6 loopback", () => {
      expect(validateBaseUrl("https://[::1]/api").ok).toBe(false);
      expect(validateBaseUrl("https://[::1]/api", { allowInsecure: true }).ok).toBe(true);
    });

    it("validates plain IPv6 link-local as private", () => {
      const result = validateBaseUrl("https://[fe80::1]/api", { allowInsecure: true });
      expect(result.ok).toBe(false); // fe80::1 is link-local, needs allowPrivateNetwork
    });

    it("never allows IPv6 link-local, even with private-network opt-in", () => {
      const result = validateBaseUrl("https://[fe80::1]/api", { allowInsecure: true, allowPrivateNetwork: true });
      expect(result.ok).toBe(false);
    });

    it("requires explicit opt-in for localhost and .local hosts", () => {
      expect(validateBaseUrl("https://localhost/api").ok).toBe(false);
      expect(validateBaseUrl("https://foo.local/api").ok).toBe(false);
      expect(validateBaseUrl("https://foo.local/api", { allowInsecure: true, allowPrivateNetwork: true }).ok).toBe(true);
    });

    it("blocks loopback addresses outside the exact local development targets", () => {
      expect(validateBaseUrl("https://127.0.0.2/api", { allowInsecure: true }).ok).toBe(false);
      expect(validateBaseUrl("https://[::ffff:169.254.169.254]/api").ok).toBe(false);
    });
  });
});
