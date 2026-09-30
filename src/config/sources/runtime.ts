import { cloneConfigValue, type ConfigSource } from "../config-schema.js";
import type { SDKConfig } from "../schema.js";

export function createRuntimeSource(overrides: Partial<SDKConfig> = {}): ConfigSource {
  return {
    kind: "runtime",
    load: () => ({ values: cloneConfigValue(overrides) }),
  };
}
