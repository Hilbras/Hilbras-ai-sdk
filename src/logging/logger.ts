/**
 * @hilbras/sdk — Secret Redaction
 *
 * Redacts common credential formats from text before it reaches errors,
 * telemetry, or logs.
 */

const SENSITIVE_PATTERNS: RegExp[] = [
  /api[_-]?key\s*[=:]\s*["']?[A-Za-z0-9\-_]{20,}["']?/gi,
  /bearer\s+[A-Za-z0-9\-_.]{20,}/gi,
  /x-api-key\s*[=:]\s*["']?[A-Za-z0-9\-_]{20,}["']?/gi,
  /\bsk-[A-Za-z0-9\-_]{20,}/g,
  /"(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|refresh[_-]?token|id[_-]?token|session[_-]?token|secret|password|token|apiKey|accessToken|authToken)"\s*:\s*"[^"]*"/gi,
  /\b(?:client[_-]?secret|refresh[_-]?token|id[_-]?token|session[_-]?token)\s*[=:]\s*["']?[^\s"',}]{8,}["']?/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bToken\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

/** Redact common credentials from arbitrary text. */
export function redact(text: string): string {
  if (!text) return text;
  let result = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, (match) => {
      if (match.startsWith('"')) {
        return match.replace(/("[^"]*"\s*:\s*)"[^"]*"/, '$1"[REDACTED]"');
      }
      return "[REDACTED]";
    });
  }
  return result;
}
