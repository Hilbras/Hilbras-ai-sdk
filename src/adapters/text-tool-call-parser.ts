/**
 * @hilbras/sdk — Text-embedded tool call parser
 *
 * Some OpenAI-compatible providers serve models whose chat template
 * serialises tool calls as plain text instead of native `tool_calls`
 * deltas. This parser detects <tool_call>...</tool_call> blocks in the
 * content stream — across arbitrary delta boundaries — and converts
 * them into structured tool calls so callers never see the raw markup.
 *
 * Supported block bodies:
 *   1. XML variant:  <function=NAME><parameter=KEY>VALUE</parameter>...</function>
 *   2. JSON variant: {"name": NAME, "arguments": {...}} (also "parameters"/"args")
 */

export interface ParsedToolCall {
  name: string;
  input: Record<string, unknown>;
}

export type TextToolCallItem =
  | { kind: "text"; text: string }
  | ({ kind: "tool_call" } & ParsedToolCall);

const OPEN_TAG = "<tool_call>";
const CLOSE_TAG = "</tool_call>";

/**
 * Length of the longest suffix of `s` that is a proper prefix of `tag`.
 * That suffix must be held back until the next delta arrives, because it
 * may turn out to be an incomplete opening tag split across chunks.
 */
function holdbackLength(s: string, tag: string): number {
  const max = Math.min(s.length, tag.length - 1);
  for (let len = max; len > 0; len--) {
    if (tag.startsWith(s.slice(s.length - len))) return len;
  }
  return 0;
}

/** Parse the body of one <tool_call> block. Returns null if unrecognised. */
export function parseToolCallBlock(body: string): ParsedToolCall | null {
  const trimmed = body.trim();

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof parsed.name !== "string" || parsed.name.length === 0) return null;
      const rawInput = parsed.arguments ?? parsed.parameters ?? parsed.args;
      const input =
        rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
          ? (rawInput as Record<string, unknown>)
          : {};
      return { name: parsed.name, input };
    } catch {
      return null;
    }
  }

  const fnMatch = /^<function=([A-Za-z0-9_.\-]+)>\s*([\s\S]*?)\s*<\/function>$/.exec(trimmed);
  if (fnMatch) {
    const input: Record<string, unknown> = {};
    const paramRe = /<parameter=([A-Za-z0-9_.\-]+)>([\s\S]*?)<\/parameter>/g;
    for (let m = paramRe.exec(fnMatch[2]); m != null; m = paramRe.exec(fnMatch[2])) {
      input[m[1]] = m[2];
    }
    return { name: fnMatch[1], input };
  }

  return null;
}

export class TextToolCallParser {
  private _buffer = "";
  private _inBlock = false;
  private _emittedCalls = 0;

  /** Number of tool calls emitted so far (for generating stable ids). */
  get emittedCalls(): number {
    return this._emittedCalls;
  }

  /** Feed a content delta; returns completed items (text and/or tool calls). */
  feed(text: string): TextToolCallItem[] {
    this._buffer += text;
    return this._drain();
  }

  /** Call once at end of stream; surfaces anything still buffered as text. */
  flush(): TextToolCallItem[] {
    const items: TextToolCallItem[] = [];
    if (this._buffer.length > 0) {
      // A block still open at end of stream was truncated — show it as text
      // rather than silently dropping model output.
      items.push({
        kind: "text",
        text: this._inBlock ? OPEN_TAG + this._buffer : this._buffer,
      });
    }
    this._buffer = "";
    this._inBlock = false;
    return items;
  }

  private _drain(): TextToolCallItem[] {
    const items: TextToolCallItem[] = [];

    for (;;) {
      if (!this._inBlock) {
        const idx = this._buffer.indexOf(OPEN_TAG);
        if (idx === -1) {
          const hold = holdbackLength(this._buffer, OPEN_TAG);
          const emit = this._buffer.slice(0, this._buffer.length - hold);
          if (emit.length > 0) items.push({ kind: "text", text: emit });
          this._buffer = this._buffer.slice(this._buffer.length - hold);
          break;
        }
        if (idx > 0) items.push({ kind: "text", text: this._buffer.slice(0, idx) });
        this._buffer = this._buffer.slice(idx + OPEN_TAG.length);
        this._inBlock = true;
        continue;
      }

      const end = this._buffer.indexOf(CLOSE_TAG);
      if (end === -1) break; // keep buffering until the block is complete

      const body = this._buffer.slice(0, end);
      this._buffer = this._buffer.slice(end + CLOSE_TAG.length);
      this._inBlock = false;

      const parsed = parseToolCallBlock(body);
      if (parsed) {
        this._emittedCalls++;
        items.push({ kind: "tool_call", ...parsed });
      } else {
        // Recognised wrapper, unparseable body — never swallow model output
        items.push({ kind: "text", text: `${OPEN_TAG}${body}${CLOSE_TAG}` });
      }
    }

    return items;
  }
}
