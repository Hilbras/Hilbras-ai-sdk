/**
 * @hilbras/sdk — HMAC Request Signer
 *
 * Signs HTTP requests with HMAC for provider authentication and gateway
 * handshakes.
 *
 * ## Signature profiles
 *
 * - **`"v1"` (default, deprecated).** The pre-v3.4.0 wire format, frozen so
 *   existing verifiers keep working. Its canonical string covers the method,
 *   path, and the headers named in `config.headers`. The body digest is emitted
 *   as `x-content-sha256` but is **not** part of that canonical string, so a
 *   `v1` signature does not authenticate the body. `verify()` trusts a received
 *   digest header when `config.headers` names it. Do not use `v1` for new
 *   integrations.
 * - **`"v2"`.** The body digest, the key id, and a per-request nonce are all
 *   bound into the canonical string. `verify()` recomputes the digest from the
 *   received bytes and never trusts a received digest header, and a mismatched
 *   `x-hilbras-key-id` fails verification.
 *
 * Neither profile provides replay protection. Pair either with
 * {@link ReplayGuard}, or use `RequestSigner.verifyFresh()` which composes
 * signature verification with a freshness window and a seen-signature cache.
 *
 * @example
 * ```ts
 * const signer = new RequestSigner({
 *   secret: process.env.API_SIGNING_SECRET!,
 *   keyId: "key-2026-09",
 *   profile: "v2",
 * });
 *
 * const signed = signer.sign(url, { method: "POST", body, headers });
 * ```
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { ReplayGuard, type ReplayGuardOptions } from "./replay-guard.js";

/** Wire-format version. See the module documentation. */
export type SignatureProfile = "v1" | "v2";

/** Body types that can be content-bound. `Buffer` is a `Uint8Array`. */
export type SignableBody = string | Uint8Array;

/** Configuration for request signing */
export interface RequestSignerConfig {
  /** HMAC signing secret (symmetric key) */
  secret: string;
  /** Optional key ID bound into `v2` signatures */
  keyId?: string;
  /** Headers to include in the signature (default: ["date", "content-type"]) */
  headers?: string[];
  /** Header name for the signature (default: "x-hilbras-signature") */
  signatureHeader?: string;
  /** Header name for the key ID (default: "x-hilbras-key-id") */
  keyIdHeader?: string;
  /** Algorithm (default: "sha256") */
  algorithm?: "sha256" | "sha512";
  /**
   * Signature wire format (default: `"v1"`, which is frozen and does not
   * authenticate the body). Use `"v2"` for new integrations.
   */
  profile?: SignatureProfile;
  /** Header carrying the `v2` nonce (default: "x-hilbras-nonce") */
  nonceHeader?: string;
  /** Header carrying the `v2` body digest (default: "x-hilbras-content-digest") */
  contentDigestHeader?: string;
  /** Clock injection for deterministic timestamps. */
  now?: () => number;
  /** Nonce source injection; defaults to `crypto.getRandomValues`. */
  nonce?: () => string;
}

/** Signed request result */
export interface SignedRequest {
  headers: Record<string, string>;
  signature: string;
  signatureInput: string;
}

interface ResolvedSignerConfig {
  secret: string;
  keyId: string;
  headers: string[];
  signatureHeader: string;
  keyIdHeader: string;
  algorithm: "sha256" | "sha512";
  profile: SignatureProfile;
  nonceHeader: string;
  contentDigestHeader: string;
  now: () => number;
  nonce: () => string;
}

function defaultNonce(): string {
  const bytes = new Uint8Array(16);
  const webcrypto = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (webcrypto?.getRandomValues) {
    webcrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isByteBody(body: SignableBody | FormData | undefined): body is SignableBody {
  return typeof body === "string" || body instanceof Uint8Array;
}

/**
 * Signs HTTP requests using HMAC. See the module documentation for the
 * difference between the `v1` and `v2` profiles.
 */
export class RequestSigner {
  private _config: ResolvedSignerConfig;

  constructor(config: RequestSignerConfig) {
    this._config = {
      secret: config.secret,
      keyId: config.keyId ?? "",
      headers: config.headers ?? ["date", "content-type"],
      signatureHeader: config.signatureHeader ?? "x-hilbras-signature",
      keyIdHeader: config.keyIdHeader ?? "x-hilbras-key-id",
      algorithm: config.algorithm ?? "sha256",
      profile: config.profile ?? "v1",
      nonceHeader: (config.nonceHeader ?? "x-hilbras-nonce").toLowerCase(),
      contentDigestHeader: (config.contentDigestHeader ?? "x-hilbras-content-digest").toLowerCase(),
      now: config.now ?? (() => Date.now()),
      nonce: config.nonce ?? defaultNonce,
    };
  }

  /** The active wire-format profile. */
  get profile(): SignatureProfile {
    return this._config.profile;
  }

  /** Current RFC 7231 timestamp from the signer's injected clock. */
  timestamp(): string {
    return new Date(this._config.now()).toUTCString();
  }

  /** Header names this signer emits, for callers that normalize headers. */
  get signatureHeader(): string {
    return this._config.signatureHeader;
  }

  private _digest(body: SignableBody): string {
    return createHmac(this._config.algorithm, this._config.secret)
      .update(typeof body === "string" ? body : Buffer.from(body))
      .digest("hex");
  }

  /** Build the canonical string that the HMAC covers. */
  private _canonical(input: {
    method: string;
    path: string;
    headers: Record<string, string>;
    digest?: string;
    nonce?: string;
  }): string {
    const signedHeaderKeys = [...this._config.headers].sort();
    const headerValues = signedHeaderKeys.map((h) => {
      if (h === "(request-target)") return `${input.method.toLowerCase()} ${input.path}`;
      return input.headers[h.toLowerCase()] ?? "";
    });
    const base = `${input.method.toLowerCase()} ${input.path}\n${
      signedHeaderKeys.map((k, i) => `${k}: ${headerValues[i]}`).join("\n")
    }`;

    if (this._config.profile === "v1") return base;
    return [
      base,
      `content-digest: ${input.digest ?? ""}`,
      `key-id: ${this._config.keyId}`,
      `nonce: ${input.nonce ?? ""}`,
    ].join("\n");
  }

  private _hmac(signingString: string): string {
    return createHmac(this._config.algorithm, this._config.secret)
      .update(signingString)
      .digest("hex");
  }

  /**
   * Sign a request. Returns headers to add to the outgoing request.
   *
   * A body that is not a rewindable byte sequence (for example `FormData`)
   * cannot be content-bound, so no digest header is emitted for it rather than
   * a digest of a placeholder string.
   */
  sign(
    url: string,
    request: {
      method?: string;
      body?: SignableBody | FormData;
      headers?: Record<string, string>;
      timestamp?: string;
      nonce?: string;
    },
  ): SignedRequest {
    const method = (request.method ?? "GET").toUpperCase();
    const timestamp = request.timestamp ?? new Date(this._config.now()).toUTCString();
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;

    const hdrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers ?? {})) {
      if (value !== undefined) hdrs[key.toLowerCase()] = value;
    }
    hdrs.date = timestamp;

    const signable = isByteBody(request.body) ? request.body : undefined;
    const digest = signable !== undefined ? this._digest(signable) : undefined;

    let nonce: string | undefined;
    if (this._config.profile === "v2") {
      nonce = request.nonce ?? this._config.nonce();
      hdrs[this._config.nonceHeader] = nonce;
      // A correctly named header, and only when the body is actually readable.
      if (digest !== undefined) hdrs[this._config.contentDigestHeader] = digest;
    } else if (digest !== undefined) {
      // Frozen v1 behavior: the header is emitted but is not signed.
      hdrs["x-content-sha256"] = digest;
    }

    const signingString = this._canonical({ method, path, headers: hdrs, digest, nonce });
    const signature = this._hmac(signingString);

    const signedHeaderKeys = [...this._config.headers].sort().join(" ");
    const signatureInput = `keyId="${this._config.keyId}",algorithm="${this._config.algorithm}",` +
      `headers="${signedHeaderKeys}",profile="${this._config.profile}",signature="${signature}"`;

    const outHeaders: Record<string, string> = { ...hdrs };
    outHeaders[this._config.signatureHeader] = signature;
    if (this._config.keyId) {
      outHeaders[this._config.keyIdHeader] = this._config.keyId;
    }

    return { headers: outHeaders, signature, signatureInput };
  }

  /**
   * Verify a request signature. Returns true if valid.
   *
   * Under `v2` the body digest is recomputed from the supplied bytes, so a
   * modified body fails even when the digest header is modified to match.
   */
  verify(
    url: string,
    request: {
      method?: string;
      body?: SignableBody | FormData;
      headers: Record<string, string>;
      nonce?: string;
    },
    receivedSignature: string,
  ): boolean {
    const method = (request.method ?? "GET").toUpperCase();
    let path: string;
    try {
      const parsed = new URL(url);
      path = parsed.pathname + parsed.search;
    } catch {
      return false;
    }

    const hdrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers ?? {})) {
      if (value !== undefined) hdrs[key.toLowerCase()] = value;
    }

    let digest: string | undefined;
    let nonce: string | undefined;

    if (this._config.profile === "v2") {
      // A key id that does not match this signer is a key-confusion attempt.
      const receivedKeyId = hdrs[this._config.keyIdHeader];
      if (this._config.keyId && receivedKeyId !== undefined && receivedKeyId !== this._config.keyId) {
        return false;
      }
      // Recompute from the received bytes; never trust the received digest.
      if (isByteBody(request.body)) digest = this._digest(request.body);
      nonce = request.nonce ?? hdrs[this._config.nonceHeader];
      if (nonce === undefined) return false;
    }

    const expectedSignature = this._hmac(
      this._canonical({ method, path, headers: hdrs, digest, nonce }),
    );

    return timingSafeEqualHex(expectedSignature, receivedSignature);
  }

  /**
   * Verify a signature and reject replays. Composes {@link verify} with a
   * {@link ReplayGuard}, which enforces a signed-timestamp window and a bounded
   * seen-signature cache.
   */
  verifyFresh(
    url: string,
    request: {
      method?: string;
      body?: SignableBody | FormData;
      headers: Record<string, string>;
    },
    receivedSignature: string,
    options?: ReplayGuardOptions & { guard?: ReplayGuard },
  ): { valid: boolean; reason?: string } {
    const { guard, ...guardOptions } = options ?? {};
    const signatureOk = this.verify(url, request, receivedSignature);
    if (!signatureOk) return { valid: false, reason: "signature does not match" };

    const freshness = (guard ?? new ReplayGuard(guardOptions)).verify(request.headers, receivedSignature);
    if (!freshness.valid) return { valid: false, reason: freshness.reason };

    return { valid: true };
  }
}

function timingSafeEqualHex(expected: string, received: string): boolean {
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(received, "hex");
    if (a.length !== b.length || a.length === 0) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Create a middleware that signs every outgoing request.
 *
 * The outgoing header bag is normalized to a single lowercase key per name, so
 * merging signed headers cannot produce both `Content-Type` and `content-type`.
 */
export function signingMiddleware(signer: RequestSigner): import("../middleware/middleware.js").Middleware {
  return async (ctx) => {
    const timestamp = signer.timestamp();
    const existing = ctx.init.headers ?? {};
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(existing)) {
      if (value === undefined) continue;
      normalized[key.toLowerCase()] = value;
    }

    const body = ctx.init.body;
    const signed = signer.sign(ctx.url, {
      method: ctx.init.method ?? "GET",
      // FormData and other non-rewindable bodies are passed through so the
      // signer can report "no digest" instead of hashing a placeholder.
      body: body as SignableBody | FormData | undefined,
      headers: normalized,
      timestamp,
    });

    ctx.init.headers = { ...normalized, ...signed.headers };
    return ctx.next();
  };
}
