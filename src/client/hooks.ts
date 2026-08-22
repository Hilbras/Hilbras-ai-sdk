/**
 * @hilbras/sdk — Client Hooks (Typed Event Emitter)
 *
 * Lightweight event emitter for observability hooks.
 * Zero overhead when no listeners are attached.
 */

import type { HookEvent, HookEventType, HookListener } from "../types/observability.js";

export class ClientHooks {
  private _listeners = new Map<string, Set<HookListener>>();

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   *
   * @example
   * const unsub = client.on("request.completed", (e) => console.log(e));
   * // later:
   * unsub();
   */
  on<T extends HookEvent = HookEvent>(event: T["type"], listener: HookListener<T>): () => void {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(listener as HookListener);
    return () => set!.delete(listener as HookListener);
  }

  /** Remove a specific listener */
  off(event: HookEventType, listener: HookListener): void {
    this._listeners.get(event)?.delete(listener);
  }

  /** Remove all listeners for an event, or all listeners entirely */
  removeAll(event?: HookEventType): void {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }

  /** Emit an event to all listeners */
  emit(event: HookEvent): void {
    const set = this._listeners.get(event.type);
    if (!set || set.size === 0) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // Swallow listener errors — never break the SDK
      }
    }
  }

  /** Number of listeners for a given event */
  listenerCount(event: HookEventType): number {
    return this._listeners.get(event)?.size ?? 0;
  }

  /** Total listener count across all events */
  get totalListeners(): number {
    let count = 0;
    for (const set of this._listeners.values()) count += set.size;
    return count;
  }
}
