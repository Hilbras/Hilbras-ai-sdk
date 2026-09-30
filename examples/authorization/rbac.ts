import { AuditLogger, HilbrasClient, createRBACMiddleware } from "@hilbras/sdk";

/** Application-supplied identity, e.g. from a session or AsyncLocalStorage. */
declare function currentUserId(): string | null;

/**
 * Authorization runs at the transport layer, so a denied request never reaches
 * a provider. The client resolves provider identity from its own registry, so
 * this middleware only needs to map the caller onto a role.
 */
const auditLogger = new AuditLogger({ serviceName: "my-app" });

const rbac = createRBACMiddleware(
  {
    roles: {
      viewer: {
        name: "viewer",
        allowedProviders: ["openai"],
        allowedModels: ["gpt-4o", "gpt-4o-mini"],
        maxTokensPerRequest: 4096,
        rateLimit: { maxRequests: 10, windowMs: 60_000 },
        allowedTools: ["search"],
        deniedTools: ["shell"],
      },
      admin: { name: "admin" },
    },
    defaultRole: "viewer",
    // Opt in to fail-closed behavior once the diagnostic log is clean.
    enforcement: "strict",
  },
  // The caller's identity, extracted from a header, cookie, or session.
  (ctx) => (ctx.init.headers?.["x-user-id"] as string | undefined) ?? null,
  {
    // Map identity to role. Without this, `defaultRole` is always applied.
    resolveRole: (ctx) => {
      const id = ctx.init.headers?.["x-user-id"];
      return id === "root" ? "admin" : "viewer";
    },
    auditLogger,
  },
);

/**
 * The same policy wired through client configuration. Note the
 * `authorization` block: without an identity resolver the client cannot select
 * a per-user role or key a per-role rate limit, and reports
 * `RBAC_RATE_LIMIT_UNKEYED` instead of applying one.
 */
const configured = new HilbrasClient({
  config: {
    rbac: {
      roles: { viewer: { name: "viewer", allowedProviders: ["openai"] } },
      defaultRole: "viewer",
    },
  },
  authorization: {
    resolveUserId: () => currentUserId(),
    resolveRole: (userId) => (userId === "root" ? "admin" : "viewer"),
  },
});

console.log(configured.getAuthorizationDiagnostics());

const client = new HilbrasClient({ middleware: rbac });

// A denied request never reaches the provider.
await client.complete({
  provider: "anthropic",
  model: "claude-3",
  messages: [{ role: "user", content: "hi" }],
}).catch((error) => console.error(`denied: ${error.message}`));

// Redacted decision log, safe to log.
console.log(client.getAuthorizationDiagnostics());
