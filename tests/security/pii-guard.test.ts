/**
 * @hilbras/sdk — PII guard tests
 */

import { describe, it, expect } from "vitest";
import { detectPii, redactPii } from "../../src/security/pii-guard.js";

describe("PII guard phone number detection", () => {
  describe("real phone numbers are detected", () => {
    it("detects US format with dashes: 555-123-4567", () => {
      const matches = detectPii("Call 555-123-4567", { types: ["phone"] });
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("phone");
    });

    it("detects US format with parens: (555) 123-4567", () => {
      const matches = detectPii("Call (555) 123-4567", { types: ["phone"] });
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("phone");
    });

    it("detects US format with dots: 555.123.4567", () => {
      const matches = detectPii("Call 555.123.4567", { types: ["phone"] });
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("phone");
    });

    it("detects international format: +1-555-123-4567", () => {
      const matches = detectPii("Call +1-555-123-4567", { types: ["phone"] });
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("phone");
    });

    it("detects international format with spaces: +1 555 123 4567", () => {
      const matches = detectPii("Call +1 555 123 4567", { types: ["phone"] });
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("phone");
    });

    it("detects format with country code and parens: +1 (555) 123-4567", () => {
      const matches = detectPii("Call +1 (555) 123-4567", { types: ["phone"] });
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("phone");
    });

    it("detects 10-digit number with dashes: 800-555-0199", () => {
      const matches = detectPii("Toll-free: 800-555-0199", { types: ["phone"] });
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("phone");
    });
  });

  describe("non-phone digit sequences are NOT flagged", () => {
    it("does not flag a 7-digit order ID: 1234567", () => {
      const matches = detectPii("Order ID: 1234567", { types: ["phone"] });
      expect(matches).toHaveLength(0);
    });

    it("does not flag an 8-digit tracking number: 12345678", () => {
      const matches = detectPii("Tracking: 12345678", { types: ["phone"] });
      expect(matches).toHaveLength(0);
    });

    it("does not flag a 9-digit code: 123456789", () => {
      const matches = detectPii("Code: 123456789", { types: ["phone"] });
      expect(matches).toHaveLength(0);
    });

    it("does not flag a plain 10-digit number: 1234567890", () => {
      const matches = detectPii("ID: 1234567890", { types: ["phone"] });
      expect(matches).toHaveLength(0);
    });

    it("does not flag a zip+4: 12345-6789", () => {
      const matches = detectPii("ZIP: 12345-6789", { types: ["phone"] });
      expect(matches).toHaveLength(0);
    });

    it("does not flag a 12-digit number: 123456789012", () => {
      const matches = detectPii("Account: 123456789012", { types: ["phone"] });
      expect(matches).toHaveLength(0);
    });

    it("does not flag a plain 6-digit number: 123456", () => {
      const matches = detectPii("PIN: 123456", { types: ["phone"] });
      expect(matches).toHaveLength(0);
    });
  });

  describe("redaction works correctly", () => {
    it("redacts phone numbers in text", () => {
      const result = redactPii("Call 555-123-4567 for info");
      expect(result).toBe("Call [PHONE] for info");
    });

    it("redacts multiple phone numbers", () => {
      const result = redactPii("Call 555-123-4567 or (800) 555-0199");
      expect(result).toBe("Call [PHONE] or [PHONE]");
    });

    it("does not alter text without phone numbers", () => {
      const result = redactPii("No phone numbers here: 1234567");
      expect(result).toBe("No phone numbers here: 1234567");
    });
  });
});
