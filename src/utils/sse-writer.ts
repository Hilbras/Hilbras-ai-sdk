/**
 * @hilbras/sdk — SSE Writer
 *
 * Server-side utility for writing UIProtocolMessage SSE events to a Response stream.
 * Converts StreamChunk objects from adapters into the wire format expected by useChat hooks.
 *
 * Wire format:
 *   data: {"type":"message_start","messageId":"msg_1"}\n\n
 *   data: {"type":"text_delta","text":"Hello"}\n\n
 *   data: {"type":"tool_call_start","id":"call_1","name":"get_weather"}\n\n
 *   data: {"type":"tool_call_delta","id":"call_1","args":"{\"city\":"}\n\n
 *   data: {"type":"tool_call_end","id":"call_1"}\n\n
 *   data: {"type":"message_end","usage":{...}}\n\n
 *   data: [DONE]\n\n
 */

import type { StreamChunk } from "../types/streams.js";
import type { UIProtocolMessage } from "../types/ui-protocol.js";

/** Options for the SSE writer */
export interface SSEWriterOptions {
  /** Whether to include reasoning deltas in the stream (default: false) */
  includeReasoning?: boolean;
}

/**
 * Create a ReadableStream that yields SSE-encoded Uint8Array chunks
 * from an async iterable of StreamChunk objects.
 *
 * @example
 *   const chunks = client.streamText({ messages, tools, maxSteps: 3 });
 *   const sseStream = createSSEStream(chunks);
 *   return new Response(sseStream, {
 *     headers: { "Content-Type": "text/event-stream" },
 *   });
 */
export function createSSEStream(
  chunks: AsyncIterable<StreamChunk>,
  options?: SSEWriterOptions,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const includeReasoning = options?.includeReasoning ?? false;

  return new ReadableStream({
    async start(controller) {
      try {
        // Write message_start
        const messageId = `msg_${Date.now()}`;
        writeEvent(controller, encoder, { type: "message_start", messageId });

        // Accumulate tool calls across deltas
        const pendingToolCalls = new Map<string, { name: string; argsBuffer: string }>();

        for await (const chunk of chunks) {
          switch (chunk.type) {
            case "text":
              writeEvent(controller, encoder, { type: "text_delta", text: chunk.text });
              break;

            case "reasoning":
              if (includeReasoning) {
                writeEvent(controller, encoder, { type: "reasoning_delta", text: chunk.text });
              }
              break;

            case "tool_call": {
              const id = chunk.id;
              if (!pendingToolCalls.has(id)) {
                pendingToolCalls.set(id, { name: chunk.name ?? "unknown", argsBuffer: "" });
                writeEvent(controller, encoder, { type: "tool_call_start", id, name: chunk.name ?? "unknown" });
              }
              const pending = pendingToolCalls.get(id)!;
              if (chunk.name) pending.name = chunk.name;
              if (chunk.argumentsDelta) {
                pending.argsBuffer += chunk.argumentsDelta;
                writeEvent(controller, encoder, { type: "tool_call_delta", id, args: chunk.argumentsDelta });
              }
              if (chunk.done) {
                writeEvent(controller, encoder, { type: "tool_call_end", id });
                pendingToolCalls.delete(id);
              }
              break;
            }

            case "usage":
              writeEvent(controller, encoder, {
                type: "message_end",
                usage: {
                  inputTokens: chunk.inputTokens,
                  outputTokens: chunk.outputTokens,
                  totalTokens: chunk.totalTokens,
                },
              });
              break;

            case "error":
              writeEvent(controller, encoder, { type: "error", error: chunk.message });
              break;

            case "finish":
              // Yield finish chunk as-is for advanced consumers
              break;

            case "performance":
              // Performance metrics are internal, not sent to client
              break;
          }
        }

        // Flush any remaining pending tool calls
        for (const [id, tc] of pendingToolCalls) {
          writeEvent(controller, encoder, { type: "tool_call_end", id });
        }

        // Write done terminator
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        // Write error event if stream is still writable
        try {
          writeEvent(controller, encoder, {
            type: "error",
            error: err instanceof Error ? err.message : String(err),
          });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch {
          // Stream may already be closed
        }
        controller.close();
      }
    },
  });
}

/**
 * Write a single UIProtocolMessage as an SSE event to the controller.
 */
function writeEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  message: UIProtocolMessage,
): void {
  const data = JSON.stringify(message);
  controller.enqueue(encoder.encode(`data: ${data}\n\n`));
}

/**
 * Create a Response object with SSE headers for streaming.
 *
 * @example
 *   const chunks = client.streamText({ messages });
 *   return createSSEResponse(chunks);
 */
export function createSSEResponse(
  chunks: AsyncIterable<StreamChunk>,
  options?: SSEWriterOptions,
): Response {
  const stream = createSSEStream(chunks, options);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
