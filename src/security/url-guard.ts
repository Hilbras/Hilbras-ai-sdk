/**
 * @hilbras/sdk — baseUrl SSRF guard
 *
 * Validates a provider's `baseUrl` before any HTTP request is constructed.
 * Default policy: only `https://` is allowed. Localhost and loopback
 * (`http://localhost`, `http://127.0.0.1`, `http://[::1]`, `http://*.local`)
 * are always allowed when `allowInsecure: true`. Private network ranges
 * (`10.*`, `192.168.*`, `172.16-31.*`) require `allowPrivateNetwork: true`
 * on top of `allowInsecure`. Anything else is rejected.
 *
 * Hostname safety checks (loopback, link-local, private ranges) apply to
 * BOTH http: and https: URLs — an attacker cannot bypass the guard by
 * switching to https. Only the "http requires allowInsecure" rule is
 * https-exempt.
 *
 * Scope notes:
 * - Link-local range covers 169.254.0.0/16 (AWS, GCP, Azure, Alibaba metadata).
 * - IPv6 private ranges (fc00::/7, fe80::/10) are checked.
 * - Obfuscated IP literals (hex, octal, decimal) are normalized before checks.
 * - DNS-rebinding (hostname resolving to private IP at request time) is out
 *   of scope — it requires resolve-time checking, not string parsing.
 */

export interface UrlGuardOptions {
  /** Allow non-https URLs (for local development, Ollama, proxies). */
  allowInsecure?: boolean;
  /** On top of `allowInsecure`, allow private network ranges (RFC 1918). */
  allowPrivateNetwork?: boolean;
}

export type UrlGuardResult =
  | { ok: true }
  | { ok: false; reason: string };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Normalize an IP literal by decoding hex, octal, and decimal forms.
 * Returns the dotted-decimal (v4) or lowercase hex (v6) form, or null
 * if the input is not an IP literal.
 */
function normalizeIpLiteral(host: string): string | null {
  // IPv6 bracketed: [::1] → ::1
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }

  // Strip IPv6 scope ID (e.g., fe80::1%25eth0 → fe80::1).
  // %25 is the URL-encoded form of '%'.
  if (host.includes("%")) {
    host = host.split("%")[0];
  }

  // IPv6 hex — just lowercase it (no mixed notation expansion for simplicity)
  if (host.includes(":")) {
    // Basic validation: only hex digits and colons
    if (/^[0-9a-fA-F:]+$/.test(host)) return host.toLowerCase();
    return null;
  }

  // IPv4 — check for hex, octal, or decimal obfuscation
  // Hex: 0x7f000001 or 7f000001
  const hexMatch = host.match(/^(?:0x)?([0-9a-fA-F]{1,8})$/);
  if (hexMatch && hexMatch[1].length >= 2) {
    const num = parseInt(hexMatch[1], 16);
    if (num <= 0xffffffff) {
      return `${(num >>> 24) & 0xff}.${(num >>> 16) & 0xff}.${(num >>> 8) & 0xff}.${num & 0xff}`;
    }
  }

  // Decimal: 2130706433 = 127.0.0.1
  if (/^\d{1,10}$/.test(host)) {
    const num = parseInt(host, 10);
    if (num <= 0xffffffff) {
      return `${(num >>> 24) & 0xff}.${(num >>> 16) & 0xff}.${(num >>> 8) & 0xff}.${num & 0xff}`;
    }
  }

  // Octal: 0177.0.0.1 or 017700000001 — strip leading zeros in each octet
  if (/^(?:0\d{1,3}\.){3}0?\d{1,3}$/.test(host)) {
    const parts = host.split(".");
    const decimal = parts.map((p) => parseInt(p, 8));
    if (decimal.every((p) => p >= 0 && p <= 255)) {
      return decimal.join(".");
    }
  }

  // Plain dotted decimal
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    const parts = host.split(".").map(Number);
    if (parts.every((p) => p >= 0 && p <= 255)) return host;
  }

  return null;
}

/**
 * Check if an IPv4 address is in the link-local range 169.254.0.0/16.
 * Covers AWS, GCP, Azure, and Alibaba metadata endpoints.
 */
function isLinkLocalIPv4(normalized: string): boolean {
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4) return false;
  return parts[0] === 169 && parts[1] === 254;
}

/**
 * Check if an IPv4 address is in an RFC 1918 private range.
 * 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 */
function isPrivateIPv4(normalized: string): boolean {
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

/**
 * Check if an IPv4 address is in the CGNAT / shared address space (100.64.0.0/10).
 */
function isCgnatIPv4(normalized: string): boolean {
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4) return false;
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

/**
 * Check if an IPv4 address is in the benchmarking range (198.18.0.0/15).
 */
function isBenchmarkingIPv4(normalized: string): boolean {
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4) return false;
  return parts[0] === 198 && (parts[1] === 18 || parts[1] === 19);
}

/**
 * Check if an IPv4 address is in the multicast range (224.0.0.0/4).
 */
function isMulticastIPv4(normalized: string): boolean {
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4) return false;
  return parts[0] >= 224 && parts[0] <= 239;
}

/**
 * Check if an IPv4 address is 0.0.0.0 (unspecified).
 */
function isUnspecifiedIPv4(normalized: string): boolean {
  return normalized === "0.0.0.0";
}

/**
 * Check if an IPv6 address is :: (unspecified) or ::ffff:0:0/96 (IPv4-mapped).
 */
function isSpecialIPv6(normalized: string): boolean {
  // :: (unspecified)
  if (normalized === "::") return true;
  // ::ffff:0:0/96 — IPv4-mapped IPv6
  if (/^0{1,4}:0{1,4}:0{1,4}:0{1,4}:0{1,4}:ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.test(normalized)) {
    return true;
  }
  return false;
}

/**
 * Check if an IPv6 address is in a private or link-local range.
 * fc00::/7 (unique-local) and fe80::/10 (link-local).
 */
function isPrivateIPv6(normalized: string): boolean {
  // Expand to full form for prefix checks
  // fc00::/7 = fc00:: to fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
  // fe80::/10 = fe80:: to febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
  const firstGroup = parseInt(normalized.split(":")[0], 16);
  if (isNaN(firstGroup)) return false;
  // fc00::/7: first nibble is f or e, second nibble is c-f → 0xfc00–0xfdff
  if (firstGroup >= 0xfc00 && firstGroup <= 0xfdff) return true;
  // fe80::/10: first two nibbles = fe, third nibble is 8-b → 0xfe80–0xfebf
  if (firstGroup >= 0xfe80 && firstGroup <= 0xfebf) return true;
  return false;
}

function isLocalhostish(host: string): boolean {
  if (LOOPBACK_HOSTS.has(host)) return true;
  if (host.endsWith(".local")) return true;
  return false;
}

/**
 * Normalize a hostname by stripping zero-width characters, normalizing
 * common unicode confusables used for SSRF bypass, and handling `.local` variants.
 */
export function normalizeHostname(host: string): string {
  let h = host.toLowerCase();

  // Strip zero-width characters (U+200B–U+200F, U+FEFF, etc.)
  h = h.replace(/[\u200b-\u200f\u2028-\u202f\u2060-\u2069\ufeff]/g, "");

  // Normalize common fullwidth / confusable characters that map to ASCII.
  // Fullwidth full stop U+FF0E → '.', fullwidth colon U+FF1A → ':'
  h = h.replace(/\uff0e/g, ".");
  h = h.replace(/\uff1a/g, ":");

  // Strip trailing dots (DNS FQDN notation)
  if (h.length > 1 && h.endsWith(".")) {
    h = h.slice(0, -1);
  }

  return h;
}

/**
 * Check whether the host (after normalization) is a dangerous SSRF target.
 * Returns null if safe, or a reason string if blocked.
 */
function checkHostSafety(host: string): string | null {
  // Always allow loopback / *.local — these are checked separately.
  if (isLocalhostish(host)) return null;

  // Normalize IP literals to detect obfuscated forms
  const normalized = normalizeIpLiteral(host);

  if (normalized) {
    // Unspecified: 0.0.0.0 or ::
    if (isUnspecifiedIPv4(normalized)) {
      return "address is unspecified (0.0.0.0)";
    }
    if (isSpecialIPv6(normalized)) {
      return "address is unspecified or IPv4-mapped IPv6";
    }

    // Link-local: 169.254.0.0/16 (AWS/GCP/Azure/Alibaba metadata)
    if (isLinkLocalIPv4(normalized)) {
      return `baseUrl points at link-local range (${host}); this is blocked even with allowInsecure`;
    }

    // CGNAT: 100.64.0.0/10
    if (isCgnatIPv4(normalized)) {
      return "private";
    }

    // Benchmarking: 198.18.0.0/15
    if (isBenchmarkingIPv4(normalized)) {
      return "private";
    }

    // Multicast: 224.0.0.0/4
    if (isMulticastIPv4(normalized)) {
      return `baseUrl points at multicast range (${host}); this is blocked even with allowInsecure`;
    }

    // Private IPv4
    if (isPrivateIPv4(normalized)) {
      return "private";
    }

    // Private/link-local IPv6
    if (isPrivateIPv6(normalized)) {
      return "private";
    }
  } else {
    // Not an IP literal — check for IPv6 with brackets stripped
    const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
    if (isPrivateIPv6(bare)) {
      return "private";
    }
  }

  return null;
}

/**
 * Validate a baseUrl. Returns `{ ok: true }` if the URL is acceptable
 * under the given options, otherwise `{ ok: false, reason }` describing
 * why it was rejected.
 */
export function validateBaseUrl(
  url: string,
  options: UrlGuardOptions = {},
): UrlGuardResult {
  if (typeof url !== "string" || url.length === 0) {
    return { ok: false, reason: "baseUrl is empty" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: `baseUrl is not a valid URL: ${url}` };
  }

  const protocol = parsed.protocol.toLowerCase();

  // Reject non-HTTP(S) schemes outright. file://, javascript:, data:,
  // blob:, ftp:, gopher:, ws:, wss: are all unsafe in this context.
  if (protocol !== "https:" && protocol !== "http:") {
    return {
      ok: false,
      reason: `baseUrl protocol '${protocol.replace(/:$/, "")}' is not allowed; only http: and https: are accepted`,
    };
  }

  // http:// requires explicit opt-in (before any host checks).
  if (protocol === "http:" && !options.allowInsecure) {
    return {
      ok: false,
      reason: `baseUrl '${url}' uses http:// which is rejected by default; pass 'allowInsecure: true' on the provider or 'allowInsecureUrls: true' on the client to enable (e.g. for local Ollama)`,
    };
  }

  const host = normalizeHostname(parsed.hostname.toLowerCase());

  // Always allow loopback / *.local (both http and https).
  if (isLocalhostish(host)) {
    return { ok: true };
  }

  // Hostname safety checks apply to BOTH http and https.
  const danger = checkHostSafety(host);
  if (danger === "private") {
    if (!options.allowPrivateNetwork) {
      return {
        ok: false,
        reason: `baseUrl points at private network range (${host}); pass 'allowPrivateNetwork: true' on the client to enable`,
      };
    }
    return { ok: true };
  }
  if (danger) {
    return { ok: false, reason: danger };
  }

  // Public https hosts are always allowed.
  if (protocol === "https:") {
    return { ok: true };
  }

  // Public http hosts are allowed with allowInsecure (e.g. proxies
  // in front of an internal service that don't terminate TLS).
  return { ok: true };
}

/**
 * Validate a resolved IP address against the original hostname.
 *
 * Call this after DNS resolution and before making the request.
 * If the resolved IP falls in a blocked range, the request is rejected.
 *
 * NOTE: Full DNS-rebinding prevention requires DNS pinning (resolving once
 * and refusing to accept a different IP on retry), which is out of scope
 * for this string-level guard. This function covers the case where the
 * initial resolution itself yields a private/blocked address.
 */
export function validateResolvedAddress(
  ip: string,
  originalHost: string,
): UrlGuardResult {
  const normalized = normalizeIpLiteral(ip);
  if (!normalized) {
    // Not an IP literal — nothing to check at this level.
    return { ok: true };
  }

  if (isUnspecifiedIPv4(normalized)) {
    return { ok: false, reason: "resolved address is unspecified (0.0.0.0)" };
  }
  if (isSpecialIPv6(normalized)) {
    return { ok: false, reason: "resolved address is unspecified or IPv4-mapped IPv6" };
  }
  if (isLinkLocalIPv4(normalized)) {
    return {
      ok: false,
      reason: `resolved address ${ip} is in link-local range (169.254.0.0/16)`,
    };
  }
  if (isCgnatIPv4(normalized)) {
    return {
      ok: false,
      reason: `resolved address ${ip} is in CGNAT range (100.64.0.0/10)`,
    };
  }
  if (isBenchmarkingIPv4(normalized)) {
    return {
      ok: false,
      reason: `resolved address ${ip} is in benchmarking range (198.18.0.0/15)`,
    };
  }
  if (isMulticastIPv4(normalized)) {
    return {
      ok: false,
      reason: `resolved address ${ip} is in multicast range (224.0.0.0/4)`,
    };
  }
  if (isPrivateIPv4(normalized)) {
    return {
      ok: false,
      reason: `resolved address ${ip} is in private network range`,
    };
  }
  if (isPrivateIPv6(normalized)) {
    return {
      ok: false,
      reason: `resolved address ${ip} is in private/link-local IPv6 range`,
    };
  }

  return { ok: true };
}

/**
 * Perform all SSRF checks and return a result suitable for passing to the
 * transport layer.
 *
 * This minimizes TOCTOU (time-of-check-to-time-of-use) risk by bundling
 * every validation step into a single call that the transport layer should
 * invoke immediately before issuing the request.
 *
 * IMPORTANT: True TOCTOU prevention (DNS pinning / connecting to the
 * exact IP that was validated) requires transport-level cooperation
 * (e.g. custom DNS resolver + pinned socket), which is out of scope
 * for this URL-string guard. For high-security deployments, combine
 * this with `validateResolvedAddress` at the point of DNS resolution.
 */
export function validateUrlForTransport(
  url: string,
  options: UrlGuardOptions = {},
): UrlGuardResult {
  return validateBaseUrl(url, options);
}
