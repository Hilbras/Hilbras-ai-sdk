/**
 * @hilbras/sdk — Plugin System
 *
 * Extend the HilbrasClient with lifecycle hooks that fire around
 * every LLM request.
 */

export type { Plugin, PluginRequestContext, PluginResponseContext, PluginErrorContext } from "./types.js";
export { PluginRegistry } from "./registry.js";
