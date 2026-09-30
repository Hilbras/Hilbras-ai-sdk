import { validateBaseUrl } from "../../security/url-guard.js";
import type { ProviderConfig } from "../provider-config.js";
import type { ConfigDiagnostic, ConfigSource, ConfigSourceResult } from "../config-schema.js";
import type { SDKConfig } from "../schema.js";

const ENV_PREFIX = "HILBRAS_";
const LOG_LEVELS = new Set<SDKConfig["logLevel"]>(["none", "error", "info", "debug"]);

type Env = Record<string, string | undefined>;

function defaultEnv(): Env {
  return typeof process !== "undefined" && process.env ? process.env : {};
}

function diagnostic(
  source: "environment",
  code: string,
  path: string,
  message: string,
): ConfigDiagnostic {
  return { code, path, message, severity: "error", source };
}

function parseNumber(
  env: Env,
  name: string,
  diagnostics: ConfigDiagnostic[],
): number | undefined {
  const raw = env[`${ENV_PREFIX}${name}`];
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    diagnostics.push(diagnostic("environment", "CONFIG_INVALID_NUMBER", name, `${name} must be a finite number`));
    return undefined;
  }
  return value;
}

function parseBoolean(
  env: Env,
  name: string,
  diagnostics: ConfigDiagnostic[],
): boolean | undefined {
  const raw = env[`${ENV_PREFIX}${name}`]?.toLowerCase();
  if (raw === undefined || raw === "") return undefined;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  diagnostics.push(diagnostic("environment", "CONFIG_INVALID_BOOLEAN", name, `${name} must be true, false, 1, or 0`));
  return undefined;
}

function inferAdapter(baseUrl: string): ProviderConfig["adapter"] {
  const lower = baseUrl.toLowerCase();
  if (lower.includes("anthropic")) return "anthropic";
  if (lower.includes("googleapis") || lower.includes("generativelanguage")) return "google-genai";
  if (lower.includes("azure")) return "azure";
  if (lower.includes("groq")) return "groq";
  if (lower.includes("localhost") || lower.includes("127.0.0.1") || lower.includes("[::1]")) return "ollama";
  return "openai";
}

export function createEnvironmentSource(env: Env = defaultEnv()): ConfigSource {
  return {
    kind: "environment",
    load: (): ConfigSourceResult => {
      const values: Partial<SDKConfig> = {};
      const diagnostics: ConfigDiagnostic[] = [];
      const stringValue = (name: string): string | undefined => {
        const value = env[`${ENV_PREFIX}${name}`];
        return value === undefined || value === "" ? undefined : value;
      };

      const defaultProvider = stringValue("DEFAULT_PROVIDER");
      const defaultModel = stringValue("DEFAULT_MODEL");
      const logLevel = stringValue("LOG_LEVEL") as SDKConfig["logLevel"] | undefined;
      if (defaultProvider !== undefined) values.defaultProvider = defaultProvider;
      if (defaultModel !== undefined) values.defaultModel = defaultModel;
      if (logLevel !== undefined) {
        if (!LOG_LEVELS.has(logLevel)) {
          diagnostics.push(diagnostic("environment", "CONFIG_INVALID_ENUM", "logLevel", "logLevel must be none, error, info, or debug"));
        } else {
          values.logLevel = logLevel;
        }
      }

      const numericFields: Array<[string, keyof SDKConfig]> = [
        ["TEMPERATURE", "temperature"],
        ["MAX_TOKENS", "maxTokens"],
        ["TIMEOUT", "requestTimeoutMs"],
        ["MAX_RETRIES", "maxRetries"],
      ];
      for (const [envName, configName] of numericFields) {
        const value = parseNumber(env, envName, diagnostics);
        if (value !== undefined) (values as Record<string, unknown>)[configName] = value;
      }
      const stream = parseBoolean(env, "STREAM", diagnostics);
      const promptCaching = parseBoolean(env, "PROMPT_CACHING", diagnostics);
      if (stream !== undefined) values.stream = stream;
      if (promptCaching !== undefined) values.promptCaching = promptCaching;

      const providerUrl = env[`${ENV_PREFIX}PROVIDER_URL`];
      const providerKey = env[`${ENV_PREFIX}PROVIDER_KEY`];
      const providerName = env[`${ENV_PREFIX}PROVIDER_NAME`];
      if ((providerUrl && !providerKey) || (!providerUrl && providerKey)) {
        diagnostics.push(diagnostic("environment", "CONFIG_INCOMPLETE_PROVIDER", "providers", "HILBRAS_PROVIDER_URL and HILBRAS_PROVIDER_KEY must be provided together"));
      } else if (providerUrl && providerKey) {
        const guard = validateBaseUrl(providerUrl, { allowInsecure: true });
        if (!guard.ok) {
          diagnostics.push(diagnostic("environment", "CONFIG_UNSAFE_PROVIDER_URL", "providers[0].baseUrl", `provider URL rejected by security policy: ${guard.reason}`));
        } else {
          values.providers = [{
            name: providerName || "default",
            baseUrl: providerUrl,
            authentication: { type: "bearer", apiKey: providerKey },
            models: [],
            adapter: inferAdapter(providerUrl),
            allowInsecure: providerUrl.startsWith("http://"),
          }];
          values.defaultProvider = providerName || "default";
        }
      }

      return { values, diagnostics };
    },
  };
}
