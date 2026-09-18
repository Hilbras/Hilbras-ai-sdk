/**
 * @hilbras/sdk — HMAC Request Signer
 *
 * Signs HTTP requests with HMAC-SHA256 for provider authentication.
 * Supports custom headers and timestamp inclusion for request integrity.
 *
 * Note: This signer provides integrity and authentication only — it does NOT
 * provide replay protection. Callers must independently enforce timestamp
 * freshness (e.g. reject requests with a `date` header older than 5 minutes)
 * and/or nonce tracking to prevent replay attacks.
 *
 * Usage:
 *   import { RequestSigner } from "@hilbras/sdk";
 *
 *   const signer = new RequestSigner({
 *     secret: process.env.API_SIGNING_SECRET,
 *     keyId: "key-2026-09",
 *     headers: ["date", "content-type"],
 *   });
 *
 *   const signed = await signer.sign(url, { method: "POST", body, headers });
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Configuration for request signing */
export interface RequestSignerConfig {
  /** HMAC signing secret (symmetric key) */
  secret: string;
  /** Optional key ID included in the signature header */
  keyId?: string;
  /** Headers to include in the signature (default: ["date", "content-type"]) */
  headers?: string[];
  /** Header name for the signature (default: "x-hilbras-signature") */
  signatureHeader?: string;
  /** Header name for the key ID (default: "x-hilbras-key-id") */
  keyIdHeader?: string;
  /** Algorithm (default: "sha256") */
  algorithm?: "sha256" | "sha512";
}

/** Signed request result */
export interface SignedRequest {
  headers: Record<string, string>;
  signature: string;
  signatureInput: string;
}

/**
 * Signs HTTP requests using HMAC-SHA256.
 * Provides request integrity and authentication for provider communication.
 */
export class RequestSigner {
  private _config: Required<RequestSignerConfig>;

  constructor(config: RequestSignerConfig) {
    this._config = {
      secret: config.secret,
      keyId: config.keyId ?? "",
      headers: config.headers ?? ["date", "content-type"],
      signatureHeader: config.signatureHeader ?? "x-hilbras-signature",
      keyIdHeader: config.keyIdHeader ?? "x-hilbras-key-id",
      algorithm: config.algorithm ?? "sha256",
    };
  }

  /**
   * Sign a request. Returns headers to add to the outgoing request.
   * The timestamp is included in the signing string for integrity, but
   * callers must independently verify freshness to prevent replay.
   */
  sign(
    url: string,
    request: {
      method?: string;
      body?: string | Buffer;
      headers?: Record<string, string>;
      timestamp?: string;
    },
  ): SignedRequest {
    const method = (request.method ?? "GET").toUpperCase();
    const timestamp = request.timestamp ?? new Date().toUTCString();

    // Parse URL for path
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;

    // Build headers record (lowercase keys)
    const hdrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers ?? {})) {
      if (value !== undefined) hdrs[key.toLowerCase()] = value;
    }
    hdrs.date = timestamp;

    // Compute body hash if present
    let bodyHash = "";
    if (request.body) {
      const bodyStr = typeof request.body === "string" ? request.body : request.body.toString("utf-8");
      bodyHash = createHmac(this._config.algorithm, this._config.secret)
        .update(bodyStr)
        .digest("hex");
      hdrs["x-content-sha256"] = bodyHash;
    }

    // Build signing string: method + path + sorted signed headers
    const signedHeaderKeys = [...this._config.headers].sort();
    const headerValues = signedHeaderKeys.map((h) => {
      if (h === "(request-target)") return `${method.toLowerCase()} ${path}`;
      return hdrs[h.toLowerCase()] ?? "";
    });

    const signingString = `${method.toLowerCase()} ${path}\n${signedHeaderKeys.map((k, i) => `${k}: ${headerValues[i]}`).join("\n")}`;

    // Compute HMAC
    const signature = createHmac(this._config.algorithm, this._config.secret)
      .update(signingString)
      .digest("hex");

    // Build signature-input header value (SF-style)
    const signatureInput = `keyId="${this._config.keyId}",algorithm="${this._config.algorithm}",headers="${signedHeaderKeys.join(" ")}",signature="${signature}"`;

    // Build output headers
    const outHeaders: Record<string, string> = { ...hdrs };
    outHeaders[this._config.signatureHeader] = signature;
    if (this._config.keyId) {
      outHeaders[this._config.keyIdHeader] = this._config.keyId;
    }

    return {
      headers: outHeaders,
      signature,
      signatureInput,
    };
  }

  /**
   * Verify a request signature. Returns true if valid.
   */
  verify(
    url: string,
    request: {
      method?: string;
      body?: string | Buffer;
      headers: Record<string, string>;
    },
    receivedSignature: string,
  ): boolean {
    const method = (request.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;

    const hdrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) hdrs[key.toLowerCase()] = value;
    }

    const signedHeaderKeys = [...this._config.headers].sort();
    const headerValues = signedHeaderKeys.map((h) => {
      if (h === "(request-target)") return `${method.toLowerCase()} ${path}`;
      return hdrs[h.toLowerCase()] ?? "";
    });

    const signingString = `${method.toLowerCase()} ${path}\n${signedHeaderKeys.map((k, i) => `${k}: ${headerValues[i]}`).join("\n")}`;

    const expectedSignature = createHmac(this._config.algorithm, this._config.secret)
      .update(signingString)
      .digest("hex");

    // Timing-safe comparison
    try {
      const a = Buffer.from(expectedSignature, "hex");
      const b = Buffer.from(receivedSignature, "hex");
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}

/**
 * Creates a middleware that signs every outgoing request.
 */
export function signingMiddleware(signer: RequestSigner): import("../middleware/middleware.js").Middleware {
  return async (ctx) => {
    const body = ctx.init.body ? String(ctx.init.body) : undefined;
    const timestamp = new Date().toUTCString();

    const signed = signer.sign(ctx.url, {
      method: ctx.init.method ?? "GET",
      body,
      headers: ctx.init.headers as Record<string, string> | undefined,
      timestamp,
    });

    ctx.init.headers = { ...ctx.init.headers, ...signed.headers };
    return ctx.next();
  };
}
