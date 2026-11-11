/**
 * @hilbras/sdk — SSE (Server-Sent Events) Parser
 *
 * Utilities for parsing SSE streams into structured events.
 * Useful for consuming SSE endpoints directly or building custom adapters.
 *
 * Usage:
 *   import { parseJsonEventStream, parseSSEStream } from "@hilbras/sdk";
 *
 *   // Parse a ReadableStream of SSE events
 *   for await (const event of parseSSEStream(response.body)) {
 *     console.log(event.event, event.data);
 *   }
 *
 *   // Parse SSE and auto-parse JSON data
 *   for await (const data of parseJsonEventStream(response.body)) {
 *     console.log(data); // parsed JSON object
 *   }
 */

/** A parsed SSE event */
export interface SSEEvent {
  /** Event type (from "event:" field, defaults to "message") */
  event: string;
  /** Raw data string */
  data: string;
  /** Event ID (from "id:" field, if present) */
  id?: string;
  /** Retry interval (from "retry:" field, if present) */
  retry?: number;
}

/**
 * Parse a ReadableStream<Uint8Array> into SSE events.
 * Handles multi-line data fields and optional fields.
 *
 * @example
 *   const events = parseSSEStream(response.body);
 *   for await (const event of events) {
 *     if (event.event === "message") {
 *       const data = JSON.parse(event.data);
 *       processMessage(data);
 *     }
 *   }
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // Accept CRLF framing as well as LF: `split("\n\n")` never matches a
      // `\r\n\r\n` boundary, so a CRLF upstream yielded no events at all while
      // the buffer grew for the whole response.
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        if (!part.trim()) continue;
        const event = parseSSEBlock(part);
        if (event) yield event;
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const event = parseSSEBlock(buffer);
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parse a single SSE block (between double newlines) into an event.
 */
function parseSSEBlock(block: string): SSEEvent | null {
  const lines = block.split("\n");
  let event = "message";
  let data = "";
  let id: string | undefined;
  let retry: number | undefined;

  for (const rawLine of lines) {
    // Strip a trailing CR so CRLF streams parse the same as LF.
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const field = line.split(":", 1)[0];
    // The spec makes the space after the colon optional.
    const value = line.slice(field.length + 1).replace(/^ /, "");

    if (field === "data") {
      data += (data ? "\n" : "") + value;
    } else if (field === "event") {
      event = value.trim();
    } else if (field === "id") {
      id = value.trim();
    } else if (field === "retry") {
      const n = parseInt(value.trim(), 10);
      if (!isNaN(n)) retry = n;
    }
  }

  // Empty data means skip this event (except for comments)
  if (!data && !id) return null;

  return { event, data, id, retry };
}

/** One complete SSE event, in the shape the adapters consume. */
export interface SseFrame {
  /** Concatenated `data:` payload, with the `data:` prefix removed. */
  data: string;
  /** `event:` field value, or "" when the event carried none. */
  event: string;
}

function splitFrame(block: string): SseFrame {
  let data = "";
  let event = "";

  for (const rawLine of block.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith("data:")) {
      const value = line.slice(5).replace(/^ /, "");
      data += (data ? "\n" : "") + value;
    } else if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    }
  }

  return { data, event };
}

/**
 * Append a decoded chunk to `buffer` and return the SSE events it completes,
 * advancing `buffer` past them.
 *
 * Shared by the adapters, which each hand-rolled this loop. Their copies shared
 * three defects: CRLF framing never matched (a CRLF upstream produced nothing
 * and grew the buffer for the whole response), `data:` without a space was
 * rejected, and a `data:` payload split over several lines kept only the last.
 */
export function splitSseFrames(
  buffer: string,
  chunk: string,
): { buffer: string; frames: SseFrame[] } {
  const parts = (buffer + chunk).split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  const frames: SseFrame[] = [];

  for (const part of parts) {
    if (!part.trim()) continue;
    frames.push(splitFrame(part));
  }

  return { buffer: rest, frames };
}

/**
 * Parse SSE stream and auto-parse JSON data.
 * Yields parsed JSON objects for each event with JSON data.
 *
 * @example
 *   const stream = parseJsonEventStream(response.body);
 *   for await (const data of stream) {
 *     if (data.type === "text") {
 *       processText(data.text);
 *     }
 *   }
 */
export async function* parseJsonEventStream<T = unknown>(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: T; id?: string }> {
  for await (const sseEvent of parseSSEStream(stream)) {
    try {
      const data = JSON.parse(sseEvent.data) as T;
      yield { event: sseEvent.event, data, id: sseEvent.id };
    } catch {
      // Skip events with non-JSON data
      continue;
    }
  }
}

/**
 * Collect all events from an SSE stream into an array.
 * Useful for testing or when you need all events at once.
 *
 * @example
 *   const events = await collectSSEEvents(response.body);
 *   console.log(`Received ${events.length} events`);
 */
export async function collectSSEEvents(
  stream: ReadableStream<Uint8Array>,
): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const event of parseSSEStream(stream)) {
    events.push(event);
  }
  return events;
}

/**
 * Find the first event matching a given event type.
 *
 * @example
 *   const message = await findSSEEvent(response.body, "message");
 *   if (message) {
 *     const data = JSON.parse(message.data);
 *   }
 */
export async function findSSEEvent(
  stream: ReadableStream<Uint8Array>,
  eventType: string,
): Promise<SSEEvent | null> {
  for await (const event of parseSSEStream(stream)) {
    if (event.event === eventType) return event;
  }
  return null;
}
