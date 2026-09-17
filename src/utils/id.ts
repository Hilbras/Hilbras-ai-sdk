/**
 * @hilbras/sdk — ID Generation Utilities
 *
 * Generate unique IDs for requests, tool calls, and other entities.
 * Uses crypto.randomUUID() when available, falls back to a simple counter.
 *
 * Usage:
 *   import { generateId, createIdGenerator } from "@hilbras/sdk";
 *
 *   const id = generateId();          // "a1b2c3d4-e5f6-..."
 *   const gen = createIdGenerator("req");
 *   const id1 = gen();                // "req_001"
 *   const id2 = gen();                // "req_002"
 */

/** Generate a unique ID (UUID v4 when available, fallback to random hex) */
export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: generate a random hex string
  const arr = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < 16; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
  }
  // Set version 4 and variant bits
  arr[6] = (arr[6] & 0x0f) | 0x40;
  arr[8] = (arr[8] & 0x3f) | 0x80;
  const hex = Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Create a sequential ID generator with a prefix.
 *
 * @param prefix - Optional prefix for generated IDs
 * @param start - Starting number (default: 1)
 * @returns A function that returns incrementing IDs
 *
 * @example
 *   const gen = createIdGenerator("req");
 *   gen(); // "req_001"
 *   gen(); // "req_002"
 *   gen(); // "req_003"
 *
 *   const gen2 = createIdGenerator("call", 100);
 *   gen2(); // "call_100"
 *   gen2(); // "call_101"
 */
export function createIdGenerator(prefix = "id", start = 1): () => string {
  let counter = start;
  return () => `${prefix}_${String(counter++).padStart(6, "0")}`;
}

/**
 * Generate a short random ID (8 characters).
 * Useful for correlation IDs, request tags, etc.
 *
 * @example
 *   const tag = shortId(); // "a1b2c3d4"
 */
export function shortId(): string {
  const arr = new Uint8Array(4);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < 4; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}
