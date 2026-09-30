import { DEFAULT_CONFIG } from "../schema.js";
import { cloneConfigValue, type ConfigSource } from "../config-schema.js";

export function createDefaultsSource(): ConfigSource {
  return {
    kind: "defaults",
    load: () => ({
      values: cloneConfigValue(DEFAULT_CONFIG),
    }),
  };
}
