/**
 * @hilbras/sdk — Shared framework handler core
 *
 * Every framework adapter (Next.js route handlers, Astro endpoints, Remix
 * actions) previously re-implemented the same request handling. `actions.ts`
 * was byte-for-byte identical to `endpoints.ts` across 33 lines, and all three
 * shared the same defects: they discarded the canonical provider name returned
 * by `addProviderFromCatalog` and then called with the caller's spelling, they
 * built a fresh client per request and never disposed it, they read a hardcoded
 * environment variable, and they reported configuration failures as an HTTP 200
 * with the error buried in the stream body.
 *
 * This module owns the parts that must behave identically everywhere. Framework
 * files keep only what is genuinely framework-specific: how to read the request
 * and how to build a `Response`.
 */

import { HilbrasClient } from "../../client/client.js";
import { getProviderCatalog, listProviders } from "../../catalog/index.js";
import { ConfigurationError, RequestValidationError } from "../../errors/index.js";

/** Options common to every framework handler factory. */
export interface FrameworkHandlerBaseOptions {
  /** Catalog provider id or display name, e.g. `"openai"` or `"OpenAI"`. */
  provider: string;
  /** Model id used when the request does not select one. */
  model: string;
  /** Prepended to the conversation as a system message. */
  systemPrompt?: string;
  /**
   * API key. When omitted, `AI_API_KEY` is tried, then the provider's own
   * catalog `envKey` (for example `OPENAI_API_KEY`).
   */
  apiKey?: string;
}

/** Resolve a provider spelling to its canonical catalog id. */
export function resolveCatalogProviderId(provider: string): string {
  return (
    listProviders().find((id) => id.toLowerCase() === provider.toLowerCase()) ?? provider
  );
}

/**
 * Resolve the API key for a provider.
 *
 * Precedence: an explicit `apiKey`, then the shared `AI_API_KEY`, then the
 * provider's catalog `envKey`. The previous hardcoded `process.env.AI_API_KEY`
 * only meant an operator using the documented `OPENAI_API_KEY` naming got an
 * empty key.
 */
export function resolveApiKey(provider: string, explicit?: string): string {
  if (explicit) return explicit;
  const shared = typeof process !== "undefined" ? process.env?.AI_API_KEY : undefined;
  if (shared) return shared;
  const catalog = getProviderCatalog(resolveCatalogProviderId(provider));
  if (catalog?.envKey && typeof process !== "undefined") {
    return process.env?.[catalog.envKey] ?? "";
  }
  return "";
}

/**
 * A lazily-built, cached `HilbrasClient` per `provider::model` pair.
 *
 * Reusing a client preserves its connection pool and its adapter registry.
 * Building one per request discarded both, and left a live cleanup interval
 * behind for every request served.
 */
export interface FrameworkClientPool {
  /** Get a client with the requested provider and model registered. */
  get(model: string): HilbrasClient;
  /** The canonical registered provider name, for provider-scoped calls. */
  readonly providerName: string;
  /** Release every cached client. */
  dispose(): Promise<void>;
}

export function createFrameworkClientPool(options: {
  provider: string;
  model: string;
  apiKey?: string;
  client?: HilbrasClient;
}): FrameworkClientPool {
  const apiKey = resolveApiKey(options.provider, options.apiKey);
  const owned = new Set<HilbrasClient>();
  const cache = new Map<string, HilbrasClient>();

  // `providerName` is only known once a client has been built, because
  // `addProviderFromCatalog` returns the canonical display name and registers
  // under it. Reading the caller's spelling back is what broke the handlers.
  let providerName = options.provider;

  const pool: FrameworkClientPool = {
    get(model: string): HilbrasClient {
      const key = model;
      const cached = cache.get(key);
      if (cached) return cached;

      const client = options.client ?? new HilbrasClient();
      if (!options.client) owned.add(client);

      // Use the returned canonical name. Registering under the catalog display
      // name and then calling with the caller's id was the root cause of
      // `ProviderNotFoundError` in every shipped framework handler.
      providerName = client.addProviderFromCatalog(options.provider, model, apiKey);
      cache.set(key, client);
      return client;
    },
    get providerName() {
      return providerName;
    },
    async dispose(): Promise<void> {
      cache.clear();
      for (const client of owned) await client.dispose();
      owned.clear();
    },
  };

  return pool;
}

/**
 * Read and parse a JSON request body.
 *
 * Malformed JSON previously threw a bare `SyntaxError` out of the handler, so
 * the response depended entirely on the host framework's error handling.
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    throw new RequestValidationError("Request body could not be read");
  }
  if (raw.trim().length === 0) {
    throw new RequestValidationError("Request body is empty", "Send a JSON object.");
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new RequestValidationError("Request body must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestValidationError) throw error;
    throw new RequestValidationError("Request body is not valid JSON");
  }
}

/** Read a required non-empty string field from a parsed body. */
export function requireString(
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new RequestValidationError(`"${field}" is required and must be a non-empty string`);
  }
  return value;
}

/** Read a required array field from a parsed body. */
export function requireArray(
  body: Record<string, unknown>,
  field: string,
): unknown[] {
  const value = body[field];
  if (!Array.isArray(value)) {
    throw new RequestValidationError(`"${field}" is required and must be an array`);
  }
  return value;
}

/**
 * Map a thrown error to an HTTP response.
 *
 * Two classes of error are reported with their message:
 *
 * - `RequestValidationError`, a caller error, whose message names the offending
 *   field and nothing else.
 * - `ConfigurationError`, an operator-config error. Its text is built from the
 *   handler's own options, so it is safe to return and it is what makes a typo
 *   in `createChatHandler({ provider })` debuggable at all.
 *
 * Everything else — including any provider-side failure — becomes a generic 500
 * with no detail, so an internal message, provider response body, or key cannot
 * leak through a public route. Route the detail to a server-side log or an
 * `onError` hook instead.
 */
export function errorResponse(error: unknown): Response {
  const status = (error as { status?: unknown } | null)?.status;
  if (error instanceof RequestValidationError) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: typeof status === "number" ? status : 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (error instanceof ConfigurationError) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: typeof status === "number" ? status : 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (typeof status === "number" && status >= 400 && status < 600) {
    return new Response(JSON.stringify({ error: "Request failed" }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ error: "Request failed" }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}
