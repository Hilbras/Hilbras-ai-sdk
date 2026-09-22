/**
 * @hilbras/sdk — Plugin Registry
 *
 * Manages plugin lifecycle: registration, deduplication, and
 * hook dispatch. Used internally by HilbrasClient.
 */

import type { Plugin, PluginRequestContext, PluginResponseContext, PluginErrorContext } from "./types.js";

export class PluginRegistry {
  private _plugins: Plugin[] = [];
  private _names = new Set<string>();

  /**
   * Register one or more plugins. Duplicate names are ignored (last one wins
   * if the same name is re-registered, the old one is removed first).
   */
  async add(...plugins: Plugin[]): Promise<void> {
    for (const plugin of plugins) {
      if (this._names.has(plugin.name)) {
        // Remove old instance silently
        await this.remove(plugin.name);
      }
      this._plugins.push(plugin);
      this._names.add(plugin.name);
    }
  }

  /**
   * Remove a plugin by name and call its destroy() hook.
   */
  async remove(name: string): Promise<boolean> {
    const idx = this._plugins.findIndex((p) => p.name === name);
    if (idx === -1) return false;
    const [removed] = this._plugins.splice(idx, 1);
    this._names.delete(name);
    try {
      await removed.destroy?.();
    } catch { /* plugin destroy errors never break the SDK */ }
    return true;
  }

  /**
   * Call setup() on all registered plugins.
   */
  async setupAll(client: { use: (...args: unknown[]) => unknown }): Promise<void> {
    for (const plugin of this._plugins) {
      try {
        await plugin.setup?.(client as never);
      } catch { /* plugin setup errors never break the SDK */ }
    }
  }

  /**
   * Call onRequest on all plugins. If any plugin throws, the error
   * propagates to abort the request.
   */
  async fireRequest(ctx: PluginRequestContext): Promise<void> {
    for (const plugin of this._plugins) {
      if (plugin.onRequest) {
        await plugin.onRequest(ctx);
      }
    }
  }

  /**
   * Call onResponse on all plugins. Errors are swallowed.
   */
  async fireResponse(ctx: PluginResponseContext): Promise<void> {
    for (const plugin of this._plugins) {
      try {
        await plugin.onResponse?.(ctx);
      } catch { /* plugin response errors never break the SDK */ }
    }
  }

  /**
   * Call onError on all plugins. Errors are swallowed.
   */
  async fireError(ctx: PluginErrorContext): Promise<void> {
    for (const plugin of this._plugins) {
      try {
        await plugin.onError?.(ctx);
      } catch { /* plugin error-hook errors never break the SDK */ }
    }
  }

  /**
   * Destroy all plugins (client disposal).
   */
  async destroyAll(): Promise<void> {
    for (const plugin of this._plugins) {
      try {
        await plugin.destroy?.();
      } catch { /* cleanup errors swallowed */ }
    }
    this._plugins.length = 0;
    this._names.clear();
  }

  /** Check if a plugin with the given name is registered */
  has(name: string): boolean {
    return this._names.has(name);
  }

  /** Get all registered plugin names */
  list(): string[] {
    return this._plugins.map((p) => p.name);
  }

  /** Number of registered plugins */
  get size(): number {
    return this._plugins.length;
  }
}
