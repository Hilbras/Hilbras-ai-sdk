/**
 * @hilbras/qwik — Signal shim
 *
 * Minimal signal for non-Qwik environments (testing, SSR).
 */

export interface QwikSignal<T> {
  (): T;
  value: T;
}

export function useSignal<T>(initial: T): QwikSignal<T> {
  let value = initial;
  const signal: QwikSignal<T> = (() => value) as QwikSignal<T>;
  Object.defineProperty(signal, "value", {
    get: () => value,
    set: (v: T) => { value = v; },
  });
  return signal;
}
