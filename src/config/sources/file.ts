import type { SDKConfig } from "../schema.js";
import type { ConfigDiagnostic, ConfigSource, ConfigSourceResult } from "../config-schema.js";

export interface FileSourceOptions {
  path: string;
  readFile(path: string): string;
}

export function createFileSource(options: FileSourceOptions): ConfigSource {
  return {
    kind: "file",
    load: (): ConfigSourceResult => {
      const diagnostics: ConfigDiagnostic[] = [];
      let parsed: unknown;
      try {
        parsed = JSON.parse(options.readFile(options.path));
      } catch {
        diagnostics.push({
          code: "CONFIG_FILE_INVALID_JSON",
          message: "configuration file is not valid JSON",
          path: "$",
          severity: "error",
          source: "file",
        });
        return { values: {}, diagnostics };
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        diagnostics.push({
          code: "CONFIG_FILE_INVALID_SHAPE",
          message: "configuration file must contain a JSON object",
          path: "$",
          severity: "error",
          source: "file",
        });
        return { values: {}, diagnostics };
      }
      return { values: parsed as Partial<SDKConfig>, diagnostics };
    },
  };
}
