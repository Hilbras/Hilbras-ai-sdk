/**
 * @hilbras/sdk — Graceful Degradation Chain
 *
 * When a provider request fails (e.g., context overflow, media too large),
 * automatically retry with progressively stripped content while preserving
 * the core task. Mirrors Kimi Code's media degradation ladder.
 */

import type { Message } from "../types/messages.js";
import type { Transport, TransportRequestInit } from "../transport/transport.js";

export interface DegradationLevel {
  name: string;
  description: string;
  transform: (messages: Message[]) => Message[];
}

/**
 * Create a degradation chain that progressively strips content.
 *
 * The chain tries each level in order until one succeeds:
 * 1. Normal: original messages (no changes)
 * 2. Media-degraded: replace media with text markers
 * 3. Media-stripped: remove all media entirely
 * 4. History-truncated: keep only recent messages
 */
export function createDegradationChain(): DegradationLevel[] {
  return [
    {
      name: "normal",
      description: "Original messages without modification",
      transform: (msgs) => msgs,
    },
    {
      name: "media-degraded",
      description: "Replace media content with text placeholders",
      transform: (msgs) => msgs.map((m) => ({
        ...m,
        content: degradeMedia(m.content ?? ""),
      })),
    },
    {
      name: "media-stripped",
      description: "Remove all media content entirely",
      transform: (msgs) => msgs.map((m) => ({
        ...m,
        content: stripMedia(m.content ?? ""),
      })),
    },
    {
      name: "history-truncated",
      description: "Keep only the system prompt and last 10 messages",
      transform: (msgs) => {
        const system = msgs.filter((m) => m.role === "system");
        const recent = msgs.filter((m) => m.role !== "system").slice(-10);
        return [...system, ...recent];
      },
    },
  ];
}

/** Replace media content with text markers */
function degradeMedia(content: string): string {
  // Replace base64-encoded images with a text marker
  return content.replace(
    /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g,
    "[image omitted for size reduction]"
  );
}

/** Remove all media content */
function stripMedia(content: string): string {
  // Remove base64 images
  let result = content.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, "");
  // Remove image references in markdown
  result = result.replace(/!\[[^\]]*\]\([^)]+\)/g, "[image removed]");
  // Remove <image> tags
  result = result.replace(/<image[^>]*\/>/g, "[image removed]");
  result = result.replace(/<image[^>]*>[\s\S]*?<\/image>/g, "[image removed]");
  return result.trim();
}

/**
 * Execute a request with graceful degradation.
 * Tries each level in order until one succeeds.
 */
export async function withDegradation<T>(
  transport: Transport,
  url: string,
  messages: Message[],
  buildRequest: (msgs: Message[]) => TransportRequestInit,
  levels: DegradationLevel[] = createDegradationChain(),
): Promise<{ response: Response; level: string }> {
  let lastError: Error | null = null;

  for (const level of levels) {
    try {
      const transformed = level.transform(messages);
      const init = buildRequest(transformed);
      const response = await transport.request(url, init);
      if (response.ok) {
        return { response, level: level.name };
      }
      // If the response is not ok but not a degradation-recoverable error, throw
      if (response.status !== 413 && response.status !== 400) {
        lastError = new Error(`HTTP ${response.status}`);
        break;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error("All degradation levels failed");
}
