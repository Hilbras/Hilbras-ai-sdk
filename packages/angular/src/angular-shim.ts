/**
 * @hilbras/angular — Minimal Angular-compatible signal types
 *
 * These are minimal type definitions that match Angular's signal API.
 * When used with real Angular, the actual @angular/core provides these.
 */

export interface WritableSignal<T> {
  (): T;
  set(value: T): void;
  update(fn: (value: T) => T): void;
  asReadonly(): Signal<T>;
}

export interface Signal<T> {
  (): T;
}

export function signal<T>(initialValue: T): WritableSignal<T> {
  let value = initialValue;
  const fn = () => value;
  fn.set = (v: T) => { value = v; };
  fn.update = (upd: (v: T) => T) => { value = upd(value); };
  fn.asReadonly = () => fn as Signal<T>;
  return fn as WritableSignal<T>;
}

export function computed<T>(fn: () => T): Signal<T> {
  return fn as Signal<T>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Injectable(options?: any): ClassDecorator {
  return () => {};
}
