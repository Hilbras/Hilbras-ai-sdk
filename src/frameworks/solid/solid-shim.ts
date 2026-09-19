/**
 * @hilbras/solid — Solid Signal shim
 *
 * Minimal signal implementation for non-Solid environments (testing, SSR).
 * When running in Solid, use the real solid-js signals.
 */

export interface Signal<T> {
  (): T;
  set: (value: T | ((prev: T) => T)) => void;
}

export type SignalReturn<T> = [Signal<T>, Signal<T>["set"]];

export function createSignal<T>(initial: T): SignalReturn<T> {
  let value = initial;
  const getter = (() => value) as Signal<T>;
  getter.set = (next) => {
    value = typeof next === "function" ? (next as (prev: T) => T)(value) : next;
  };
  return [getter, getter.set];
}
