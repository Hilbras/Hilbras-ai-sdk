/**
 * @hilbras/sdk — OIDC Credential Provider
 *
 * Fetches and caches short-lived tokens from an OIDC/token endpoint.
 * Supports auto-refresh before expiry and custom token exchange flows.
 *
 * Usage:
 *   import { OidcCredentialProvider } from "@hilbras/sdk";
 *
 *   const provider = new OidcCredentialProvider({
 *     tokenEndpoint: "https://auth.example.com/token",
 *     clientId: "my-app",
 *     clientSecret: process.env.OIDC_SECRET,
 *     scopes: ["api:read", "api:write"],
 *   });
 *
 *   setCredentialProvider(provider);
 */

import { HilbrasSdkError } from "../errors/index.js";

/** Configuration for OIDC token acquisition */
export interface OidcConfig {
  /** Token endpoint URL */
  tokenEndpoint: string;
  /** OAuth2 client ID */
  clientId: string;
  /** OAuth2 client secret (optional for public clients) */
  clientSecret?: string;
  /** Scopes to request */
  scopes?: string[];
  /** Grant type (default: "client_credentials") */
  grantType?: string;
  /** Additional form parameters for the token request */
  extraParams?: Record<string, string>;
  /** Clock skew tolerance in ms (default: 30000 — 30s) */
  clockSkewMs?: number;
  /** Custom fetch function (for testing or custom HTTP clients) */
  fetch?: typeof globalThis.fetch;
}

/** Cached token with expiry info */
interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/** Token endpoint response (RFC 6749 Section 5.1) */
interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

/** Custom error for OIDC failures */
export class OidcError extends HilbrasSdkError {
  constructor(message: string, public readonly endpoint: string) {
    super(message);
    this.name = "OidcError";
  }
}

/**
 * Fetches and caches short-lived tokens from an OIDC/token endpoint.
 * Tokens are auto-refreshed before expiry with configurable clock skew tolerance.
 */
export class OidcCredentialProvider {
  private _config: Required<OidcConfig>;
  private _cache: Map<string, CachedToken> = new Map();
  private _inflight: Map<string, Promise<string>> = new Map();

  constructor(config: OidcConfig) {
    this._config = {
      tokenEndpoint: config.tokenEndpoint,
      clientId: config.clientId,
      clientSecret: config.clientSecret ?? "",
      scopes: config.scopes ?? [],
      grantType: config.grantType ?? "client_credentials",
      extraParams: config.extraParams ?? {},
      clockSkewMs: config.clockSkewMs ?? 30_000,
      fetch: config.fetch ?? globalThis.fetch,
    };
  }

  /**
   * Get a valid access token, fetching or refreshing as needed.
   * Deduplicates concurrent requests to the same endpoint.
   */
  async getToken(): Promise<string> {
    const cacheKey = this._config.tokenEndpoint;
    const cached = this._cache.get(cacheKey);
    const now = Date.now();

    // Return cached token if still valid (with clock skew tolerance)
    if (cached && cached.expiresAt - this._config.clockSkewMs > now) {
      return cached.accessToken;
    }

    // Deduplicate concurrent token requests
    const inflight = this._inflight.get(cacheKey);
    if (inflight) return inflight;

    const promise = this._fetchToken();
    this._inflight.set(cacheKey, promise);

    try {
      const token = await promise;
      return token;
    } finally {
      this._inflight.delete(cacheKey);
    }
  }

  /** Invalidate the cached token, forcing a refresh on next getToken() */
  invalidate(): void {
    this._cache.clear();
  }

  /** Check if a valid token is cached (without fetching) */
  get isCached(): boolean {
    const cached = this._cache.get(this._config.tokenEndpoint);
    return !!cached && cached.expiresAt - this._config.clockSkewMs > Date.now();
  }

  private async _fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: this._config.grantType,
      client_id: this._config.clientId,
    });

    if (this._config.clientSecret) {
      body.set("client_secret", this._config.clientSecret);
    }

    if (this._config.scopes.length > 0) {
      body.set("scope", this._config.scopes.join(" "));
    }

    for (const [key, value] of Object.entries(this._config.extraParams)) {
      body.set(key, value);
    }

    let response: Response;
    try {
      response = await this._config.fetch(this._config.tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
      });
    } catch (err) {
      throw new OidcError(
        `Network error fetching token from ${this._config.tokenEndpoint}: ${err instanceof Error ? err.message : String(err)}`,
        this._config.tokenEndpoint,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new OidcError(
        `Token endpoint returned ${response.status}: ${text.slice(0, 200)}`,
        this._config.tokenEndpoint,
      );
    }

    let data: TokenResponse;
    try {
      data = (await response.json()) as TokenResponse;
    } catch {
      throw new OidcError(
        `Invalid JSON from token endpoint`,
        this._config.tokenEndpoint,
      );
    }

    if (!data.access_token) {
      throw new OidcError(
        `Token response missing access_token`,
        this._config.tokenEndpoint,
      );
    }

    // Cache with expiry (default 60s if not provided)
    const expiresIn = (data.expires_in ?? 60) * 1000;
    this._cache.set(this._config.tokenEndpoint, {
      accessToken: data.access_token,
      expiresAt: Date.now() + expiresIn,
    });

    return data.access_token;
  }
}

/**
 * Creates a CredentialSource for OIDC token-based auth.
 * Use with the credential provider system.
 */
export function oidcSource(endpoint: string, clientId: string, options?: {
  clientSecret?: string;
  scopes?: string[];
  extraParams?: Record<string, string>;
}): { type: "oidc"; endpoint: string; clientId: string; clientSecret?: string; scopes?: string[]; extraParams?: Record<string, string> } {
  return {
    type: "oidc",
    endpoint,
    clientId,
    clientSecret: options?.clientSecret,
    scopes: options?.scopes,
    extraParams: options?.extraParams,
  };
}
