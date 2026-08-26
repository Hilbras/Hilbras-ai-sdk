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
 * The intent is to prevent a misconfigured (or malicious) provider config
 * from pointing the SDK at the AWS instance metadata service, internal
 * services, or non-HTTP schemes like `file://` or `javascript:`.
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

function isPrivateIPv4(host: string): boolean {
  // RFC 1918 ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
  if (host.startsWith("10.")) return true;
  if (host.startsWith("192.168.")) return true;
  const m = host.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}

function isLocalhostish(host: string): boolean {
  if (LOOPBACK_HOSTS.has(host)) return true;
  if (host.endsWith(".local")) return true;
  return false;
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

  // https is always allowed.
  if (protocol === "https:") {
    return { ok: true };
  }

  // http:// requires explicit opt-in.
  if (!options.allowInsecure) {
    return {
      ok: false,
      reason: `baseUrl '${url}' uses http:// which is rejected by default; pass 'allowInsecure: true' on the provider or 'allowInsecureUrls: true' on the client to enable (e.g. for local Ollama)`,
    };
  }

  const host = parsed.hostname.toLowerCase();

  // Always allow loopback / *.local when allowInsecure is on.
  if (isLocalhostish(host)) {
    return { ok: true };
  }

  // Block obvious SSRF targets: AWS instance metadata service.
  if (host === "169.254.169.254") {
    return {
      ok: false,
      reason: `baseUrl points at the AWS instance metadata service (${host}); this is blocked even with allowInsecure`,
    };
  }

  // Private network ranges require an additional opt-in.
  if (isPrivateIPv4(host)) {
    if (!options.allowPrivateNetwork) {
      return {
        ok: false,
        reason: `baseUrl points at private network range (${host}); pass 'allowPrivateNetwork: true' on the client to enable`,
      };
    }
    return { ok: true };
  }

  // Public http:// hosts are still allowed with allowInsecure (e.g. proxies
  // in front of an internal service that don't terminate TLS).
  return { ok: true };
}
