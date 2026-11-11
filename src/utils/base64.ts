/**
 * @hilbras/sdk — Base64 encoding
 */

/**
 * Base64-encode bytes.
 *
 * `btoa(String.fromCharCode(...bytes))` — the obvious form, and the one the
 * Google adapters used — spreads every element into one call, which exceeds the
 * engine's argument limit at roughly 100 kB. Audio clips and images cross that
 * easily, so the encoding throws `RangeError: Maximum call stack size exceeded`.
 * Chunking keeps each call small.
 */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}
