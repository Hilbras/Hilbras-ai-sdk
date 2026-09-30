/**
 * @hilbras/sdk — Configuration schema compatibility exports
 *
 * The canonical schema now lives in `config-schema.ts`; this module preserves
 * the historical `@hilbras/sdk` and internal import paths.
 */

export type { SDKConfig } from "./config-schema.js";
export { DEFAULT_CONFIG } from "./config-schema.js";
