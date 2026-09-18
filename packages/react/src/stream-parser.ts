/**
 * @hilbras/react — Stream Parser
 *
 * Parses the UIMessage protocol from a ReadableStream and yields UIProtocolMessage objects.
 */

import type { UIProtocolMessage } from "@hilbras/sdk";

export async function* parseUIStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<UIProtocolMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const lines = part.split("\n");
        let rawData = "";
        for (const line of lines) {
          if (line.startsWith("data: ")) rawData = line.slice(6).trim();
        }
        if (!rawData || rawData === "[DONE]") continue;

        let msg: UIProtocolMessage;
        try {
          msg = JSON.parse(rawData) as UIProtocolMessage;
        } catch {
          continue;
        }

        yield msg;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
