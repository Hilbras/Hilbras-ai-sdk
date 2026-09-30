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
import type { Tool } from "../../types/tools.js";

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
  /**
   * Whether fields in the request body may override the factory's own options.
   *
   * `true` (the default, and the v3.4 behaviour) lets a caller choose
   * `body.model`, `body.temperature`, `body.maxTokens`, `body.tools` and
   * `body.maxSteps`. `false` ignores all of them and uses only the values
   * configured on the factory, which is what a public route wants.
   *
   * The default flips to `false` in 4.0.0.
   */
  trustClientFields?: boolean;
  /** Bounded request limits. Every field is individually overridable. */
  limits?: Partial<FrameworkHandlerLimits>;
  /**
   * Called once per request after the body is validated and before any provider
   * call. Throw to reject the request; `errorResponse` maps the thrown error, so
   * a `RequestValidationError` carrying 401 or 403 becomes that status and
   * anything else becomes a generic 500.
   *
   * This is the authentication and authorization extension point.
   *
   * @example
   * ```ts
   * createChatHandler({
   *   provider: "openai",
   *   model: "gpt-4o",
   *   onRequest({ request }) {
   *     if (request.headers.get("authorization") !== `Bearer ${process.env.SESSION}`) {
   *       throw new RequestValidationError("Unauthorized", undefined, 401);
   *     }
   *   },
   * });
   * ```
   */
  onRequest?: (context: FrameworkRequestContext) => void | Promise<void>;
  /**
   * Called for every request that fails, including one rejected by `onRequest`.
   * This is where the server-side log belongs: `errorResponse` deliberately
   * withholds detail from the response body, so without this hook a provider
   * error is invisible to the operator.
   */
  onError?: (error: unknown, context: FrameworkErrorContext) => void | Promise<void>;
}

/** What an `onRequest` hook receives. */
export interface FrameworkRequestContext {
  /** The incoming request. */
  request: Request;
  /** The parsed JSON body. */
  body: Record<string, unknown>;
  /**
   * The fields the handler will actually use, after `trustClientFields` and the
   * limits have been applied. A hook that authorizes per-model should read this
   * rather than `body`, because these are the values that reach the provider.
   */
  effective: FrameworkEffectiveFields;
}

/** The resolved request parameters, after allowlist and limit handling. */
export interface FrameworkEffectiveFields {
  model: string;
  provider: string;
  messages?: unknown[];
  prompt?: string;
  tools?: Tool[];
  maxSteps?: number;
  maxTokens?: number;
  temperature?: number;
  stream: boolean;
}

/** What an `onError` hook receives. */
export interface FrameworkErrorContext {
  request: Request;
  /** `"request"` for a caller or validation failure, `"provider"` otherwise. */
  phase: "request" | "provider";
}

/**
 * Bounds on what a single request may ask for.
 *
 * The defaults are deliberately generous — no realistic chat request reaches
 * them — so enabling them does not change the behaviour of an existing route,
 * while still bounding the worst case an unauthenticated caller can force.
 */
export interface FrameworkHandlerLimits {
  /** Maximum request body size in bytes. Default 1 MiB. */
  maxBodyBytes: number;
  /** Maximum messages in a chat request. Default 200. */
  maxMessages: number;
  /** Maximum tools in a chat request. Default 64. */
  maxTools: number;
  /** Upper clamp applied to `maxSteps`. Default 25. */
  maxStepsClamp: number;
  /** Upper clamp applied to `maxTokens`. Default 32768. */
  maxTokensClamp: number;
  /** Inclusive clamp applied to `temperature`. Default `[0, 2]`. */
  temperatureClamp: [number, number];
}

export const DEFAULT_HANDLER_LIMITS: Readonly<FrameworkHandlerLimits> = Object.freeze({
  maxBodyBytes: 1024 * 1024,
  maxMessages: 200,
  maxTools: 64,
  maxStepsClamp: 25,
  maxTokensClamp: 32768,
  temperatureClamp: [0, 2] as [number, number],
});

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

/** Merge caller-supplied limits over the defaults. */
export function resolveLimits(
  overrides?: Partial<FrameworkHandlerLimits>,
): FrameworkHandlerLimits {
  if (!overrides) return { ...DEFAULT_HANDLER_LIMITS };
  return {
    ...DEFAULT_HANDLER_LIMITS,
    ...overrides,
    temperatureClamp: [
      overrides.temperatureClamp?.[0] ?? DEFAULT_HANDLER_LIMITS.temperatureClamp[0],
      overrides.temperatureClamp?.[1] ?? DEFAULT_HANDLER_LIMITS.temperatureClamp[1],
    ],
  };
}

/**
 * Read the request body as text, rejecting anything over `maxBodyBytes`.
 *
 * `content-length` is consulted first because it is free, but it is only a hint:
 * a request with no header, or a lying one, is still measured by reading the
 * body. The host normally caps `Content-Length` for us, so it cannot be relied
 * on to reject an oversized body before it is buffered.
 */
export async function readBodyText(
  request: Request,
  limits: FrameworkHandlerLimits = DEFAULT_HANDLER_LIMITS,
): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > limits.maxBodyBytes) {
    throw new RequestValidationError(
      `Request body exceeds the ${limits.maxBodyBytes} byte limit`,
      "Raise `limits.maxBodyBytes` on the handler factory if this is expected.",
      413,
    );
  }

  let raw: string;
  try {
    if (typeof request.text === "function") {
      raw = await request.text();
    } else {
      raw = new TextDecoder().decode(await request.arrayBuffer());
    }
  } catch {
    throw new RequestValidationError("Request body could not be read");
  }

  // `text()` yields a UTF-16 string, so measure the encoded byte length rather
  // than the character count: a body of multi-byte characters has fewer
  // characters than bytes, and comparing lengths would under-count it.
  if (new TextEncoder().encode(raw).byteLength > limits.maxBodyBytes) {
    throw new RequestValidationError(
      `Request body exceeds the ${limits.maxBodyBytes} byte limit`,
      "Raise `limits.maxBodyBytes` on the handler factory if this is expected.",
      413,
    );
  }

  if (raw.trim().length === 0) {
    throw new RequestValidationError("Request body is empty", "Send a JSON object.");
  }
  return raw;
}

/**
 * Read and parse a JSON request body, enforcing `maxBodyBytes`.
 *
 * Malformed JSON previously threw a bare `SyntaxError` out of the handler, so
 * the response depended entirely on the host framework's error handling.
 */
export async function readJsonBody(
  request: Request,
  limits: FrameworkHandlerLimits = DEFAULT_HANDLER_LIMITS,
): Promise<Record<string, unknown>> {
  const raw = await readBodyText(request, limits);
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

/** Clamp a number into `[min, max]`. */
function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Resolve the fields a chat request may contribute.
 *
 * This is the single place that decides what a caller is allowed to influence,
 * which is why all four chat-shaped handlers share it. `trustClientFields`
 * selects *whether* the body is consulted; the limits bound *how far* it is
 * trusted.
 */
export function resolveChatFields(
  body: Record<string, unknown>,
  options: {
    model: string;
    tools?: Tool[];
    maxSteps?: number;
    trustClientFields: boolean;
    limits: FrameworkHandlerLimits;
  },
): Omit<FrameworkEffectiveFields, "provider"> {
  const messages = requireArray(body, "messages");
  if (messages.length > options.limits.maxMessages) {
    throw new RequestValidationError(
      `Request has ${messages.length} messages, exceeding the limit of ${options.limits.maxMessages}`,
      "Raise `limits.maxMessages` on the handler factory if this is expected.",
    );
  }

  const trust = options.trustClientFields;
  const model =
    trust && typeof body.model === "string" && body.model.length > 0
      ? body.model
      : options.model;

  let tools = options.tools;
  if (tools && tools.length > options.limits.maxTools) {
    throw new RequestValidationError(
      `Handler is configured with ${tools.length} tools, exceeding the limit of ${options.limits.maxTools}`,
      "Raise `limits.maxTools` on the handler factory if this is expected.",
    );
  }
  if (trust && Array.isArray(body.tools)) {
    if (body.tools.length > options.limits.maxTools) {
      throw new RequestValidationError(
        `Request has ${body.tools.length} tools, exceeding the limit of ${options.limits.maxTools}`,
        "Raise `limits.maxTools` on the handler factory if this is expected.",
      );
    }
    tools = body.tools as Tool[];
  }

  const [tempMin, tempMax] = options.limits.temperatureClamp;
  const maxStepsRaw =
    trust && typeof body.maxSteps === "number" ? body.maxSteps : options.maxSteps;

  return {
    model,
    messages,
    tools,
    maxSteps: typeof maxStepsRaw === "number" ? Math.min(maxStepsRaw, options.limits.maxStepsClamp) : undefined,
    maxTokens:
      trust && typeof body.maxTokens === "number"
        ? Math.min(body.maxTokens, options.limits.maxTokensClamp)
        : undefined,
    temperature:
      trust && typeof body.temperature === "number"
        ? clampNumber(body.temperature, tempMin, tempMax)
        : undefined,
    stream: body.stream !== false,
  };
}

/**
 * Resolve the fields a completion request may contribute.
 *
 * `stream` is resolved but not yet acted on: the completion handlers answer with
 * a JSON body either way, so a caller sending `stream: true` is served the same
 * documented shape rather than a half-implemented stream.
 */
export function resolveCompletionFields(
  body: Record<string, unknown>,
  options: {
    model: string;
    trustClientFields: boolean;
    limits: FrameworkHandlerLimits;
  },
): Omit<FrameworkEffectiveFields, "provider" | "messages" | "tools" | "maxSteps"> {
  const prompt = requireString(body, "prompt");
  const trust = options.trustClientFields;
  const [tempMin, tempMax] = options.limits.temperatureClamp;

  return {
    model:
      trust && typeof body.model === "string" && body.model.length > 0
        ? body.model
        : options.model,
    prompt,
    maxTokens:
      trust && typeof body.maxTokens === "number"
        ? Math.min(body.maxTokens, options.limits.maxTokensClamp)
        : undefined,
    temperature:
      trust && typeof body.temperature === "number"
        ? clampNumber(body.temperature, tempMin, tempMax)
        : undefined,
    stream: body.stream !== false,
  };
}

/**
 * Classify an error for the `onError` hook.
 *
 * A validation failure — including one raised by `onRequest` — is the caller's
 * fault and is not worth an error-level log; anything else is.
 */
export function isRequestPhaseError(error: unknown): boolean {
  return error instanceof RequestValidationError;
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
