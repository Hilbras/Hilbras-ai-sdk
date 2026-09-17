/**
 * @hilbras/sdk — PII Detection & Redaction
 *
 * Detects and redacts personally identifiable information (PII) in text.
 * Supports emails, phone numbers, SSNs, credit cards, IP addresses, and
 * custom patterns.
 *
 * Usage:
 *   import { redactPii, detectPii } from "@hilbras/sdk";
 *
 *   const clean = redactPii("Contact john@example.com or call 555-123-4567");
 *   // "Contact [EMAIL] or call [PHONE]"
 *
 *   const found = detectPii("SSN: 123-45-6789");
 *   // [{ type: "ssn", value: "123-45-6789", start: 5, end: 16 }]
 */

/** Types of PII that can be detected */
export type PiiType =
  | "email"
  | "phone"
  | "ssn"
  | "credit_card"
  | "ip_address"
  | "uk_nhs"
  | "eu_iban"
  | "custom";

/** A detected PII occurrence */
export interface PiiMatch {
  type: PiiType;
  value: string;
  start: number;
  end: number;
  /** The redacted replacement text */
  redacted: string;
}

/** Configuration for PII detection */
export interface PiiGuardConfig {
  /** Which PII types to detect (default: all) */
  types?: PiiType[];
  /** Custom patterns to detect */
  customPatterns?: Array<{ type: string; pattern: RegExp; replacement?: string }>;
  /** Custom replacement function per type */
  replacements?: Partial<Record<PiiType, (value: string) => string>>;
  /** Default replacement text (default: "[REDACTED]") */
  defaultReplacement?: string;
  /** Whether to mask instead of replace (e.g., "j***@e***.com") (default: false) */
  mask?: boolean;
}

/** PII detection patterns */
const PII_PATTERNS: Record<PiiType, RegExp> = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phone: /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g,
  ssn: /\b\d{3}[-]\d{2}[-]\d{4}\b/g,
  credit_card: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  ip_address: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
  uk_nhs: /\b\d{3}\s?\d{3}\s?\d{4}\b/g,
  eu_iban: /\b[A-Z]{2}\d{2}[\s]?[\dA-Z]{4}[\s]?(?:[\dA-Z]{4}[\s]?){1,7}[\dA-Z]{1,4}\b/g,
  custom: /(?!.)/, // Never matches — placeholder
};

/** Mask a value by keeping first and last characters */
function maskValue(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  const keep = Math.min(2, Math.floor(value.length / 4));
  return value.slice(0, keep) + "*".repeat(value.length - keep * 2) + value.slice(-keep);
}

/** Default replacement map */
const DEFAULT_REPLACEMENTS: Record<PiiType, string> = {
  email: "[EMAIL]",
  phone: "[PHONE]",
  ssn: "[SSN]",
  credit_card: "[CREDIT_CARD]",
  ip_address: "[IP_ADDRESS]",
  uk_nhs: "[NHS_NUMBER]",
  eu_iban: "[IBAN]",
  custom: "[REDACTED]",
};

/**
 * Detect PII in text without redacting.
 */
export function detectPii(text: string, config?: PiiGuardConfig): PiiMatch[] {
  const types = config?.types ?? (Object.keys(PII_PATTERNS) as PiiType[]).filter((t) => t !== "custom");
  const matches: PiiMatch[] = [];

  for (const type of types) {
    const pattern = PII_PATTERNS[type];
    if (!pattern) continue;

    // Reset lastIndex for global regex
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;

    while ((m = re.exec(text)) !== null) {
      matches.push({
        type,
        value: m[0],
        start: m.index,
        end: m.index + m[0].length,
        redacted: DEFAULT_REPLACEMENTS[type],
      });
    }
  }

  // Custom patterns
  if (config?.customPatterns) {
    for (const cp of config.customPatterns) {
      let m: RegExpExecArray | null;
      const re = new RegExp(cp.pattern.source, cp.pattern.flags);
      while ((m = re.exec(text)) !== null) {
        matches.push({
          type: "custom",
          value: m[0],
          start: m.index,
          end: m.index + m[0].length,
          redacted: cp.replacement ?? "[REDACTED]",
        });
      }
    }
  }

  // Sort by start position
  matches.sort((a, b) => a.start - b.start);

  return matches;
}

/**
 * Redact PII in text, replacing matched values with placeholders.
 */
export function redactPii(text: string, config?: PiiGuardConfig): string {
  const matches = detectPii(text, config);
  if (matches.length === 0) return text;

  const mask = config?.mask ?? false;
  const defaultReplacement = config?.defaultReplacement ?? "[REDACTED]";

  let result = "";
  let lastEnd = 0;

  for (const match of matches) {
    // Skip overlapping matches
    if (match.start < lastEnd) continue;

    result += text.slice(lastEnd, match.start);

    if (config?.replacements?.[match.type]) {
      result += config.replacements[match.type]!(match.value);
    } else if (mask) {
      result += maskValue(match.value);
    } else {
      result += DEFAULT_REPLACEMENTS[match.type] ?? defaultReplacement;
    }

    lastEnd = match.end;
  }

  result += text.slice(lastEnd);
  return result;
}

/**
 * Create a PII redactor function for use in middleware or loggers.
 */
export function createPiiRedactor(config?: PiiGuardConfig): (text: string) => string {
  return (text: string) => redactPii(text, config);
}
