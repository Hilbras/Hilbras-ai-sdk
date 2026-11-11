/**
 * @hilbras/sdk — Known credential registry
 *
 * Pattern matching has a floor. `redact()` scrubs `\bsk-[A-Za-z0-9\-_]{20,}`,
 * so a short key such as `sk-local-gateway` sails through untouched and lands in
 * error messages and logs.
 *
 * The SDK knows the credentials it was configured with, so it does not have to
 * guess: registering a key lets it be scrubbed by exact value at any length,
 * with no pattern and therefore no false positives.
 */

/** Below this length a "secret" is as likely to be an ordinary word. */
const MIN_SECRET_LENGTH = 8;

const knownSecrets = new Set<string>();

/** Register a credential so it is scrubbed from any text the SDK emits. */
export function registerKnownSecret(value: string | undefined | null): void {
  if (typeof value === "string" && value.length >= MIN_SECRET_LENGTH) {
    knownSecrets.add(value);
  }
}

/** Replace every registered credential in `text` with `[REDACTED]`. */
export function redactKnownSecrets(text: string): string {
  if (!text || knownSecrets.size === 0) return text;

  let result = text;
  for (const secret of knownSecrets) {
    if (result.includes(secret)) result = result.split(secret).join("[REDACTED]");
  }
  return result;
}

/** How many credentials are registered. Test seam. */
export function knownSecretCount(): number {
  return knownSecrets.size;
}

/** Forget every registered credential. Test seam. */
export function clearKnownSecrets(): void {
  knownSecrets.clear();
}
