/**
 * @hilbras/nextjs — Signal shim
 */

export interface Signal<T> {
  (): T;
  value: T;
}

export function useSignal<T>(initial: T): Signal<T> {
  let value = initial;
  const signal: Signal<T> = (() => value) as Signal<T>;
  Object.defineProperty(signal, "value", {
    get: () => value,
    set: (v: T) => { value = v; },
    configurable: true,
  });
  return signal;
}
