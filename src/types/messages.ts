/**
 * @hilbras/sdk — Message types
 *
 * Canonical message representation shared across all provider adapters.
 * Supports multimodal content (text, images, audio) via ContentPart arrays.
 */

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCallFunction {
  /** Function name as declared in the tool schema */
  name: string;
  /** JSON-encoded arguments string */
  arguments: string;
}

export interface ToolCall {
  /** Unique identifier for this tool call */
  id: string;
  type: "function";
  function: ToolCallFunction;
}

// ─── Multimodal Content Parts ────────────────────────────────────────────────

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageContentPart {
  type: "image_url";
  image_url: {
    /** URL or base64 data URI (data:image/png;base64,...) */
    url: string;
    /** Optional detail level: "low" | "high" | "auto" */
    detail?: "low" | "high" | "auto";
  };
}

export interface AudioContentPart {
  type: "input_audio";
  input_audio: {
    /** Base64-encoded audio data */
    data: string;
    /** Audio format */
    format: "wav" | "mp3";
  };
}

export type ContentPart = TextContentPart | ImageContentPart | AudioContentPart;

// ─── Message ─────────────────────────────────────────────────────────────────

export interface Message {
  role: Role;
  /**
   * Message content. Can be:
   * - A plain string (text-only)
   * - An array of ContentParts (multimodal: text + images + audio)
   * - null (empty content)
   */
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Check if content is a ContentPart array */
export function isContentParts(content: string | ContentPart[] | null): content is ContentPart[] {
  return Array.isArray(content);
}

/** Extract plain text from content (concatenates all text parts) */
export function extractText(content: string | ContentPart[] | null): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content
    .filter((p): p is TextContentPart => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** Create a text-only content array */
export function textContent(text: string): ContentPart[] {
  return [{ type: "text", text }];
}

/** Create an image content part from a URL or base64 data URI */
export function imageContent(url: string, detail?: "low" | "high" | "auto"): ContentPart {
  return { type: "image_url", image_url: { url, detail } };
}

/** Create an audio content part from base64 data */
export function audioContent(data: string, format: "wav" | "mp3" = "wav"): ContentPart {
  return { type: "input_audio", input_audio: { data, format } };
}

/** Convert a Message to a plain dict ready for API payloads. */
export function messageToDict(msg: Message): Record<string, unknown> {
  const out: Record<string, unknown> = { role: msg.role };
  if (msg.content != null) out.content = msg.content;
  if (msg.tool_calls) out.tool_calls = msg.tool_calls;
  if (msg.tool_call_id) out.tool_call_id = msg.tool_call_id;
  if (msg.name) out.name = msg.name;
  return out;
}

/** Convert a plain dict (with role) into a Message. */
export function dictToMessage(raw: Record<string, unknown>): Message {
  if (typeof raw.role !== "string") {
    throw new Error("Message dict must have a 'role' field");
  }
  return {
    role: raw.role as Role,
    content: (raw.content as string | ContentPart[] | null) ?? null,
    tool_calls: raw.tool_calls as ToolCall[] | undefined,
    tool_call_id: raw.tool_call_id as string | undefined,
    name: raw.name as string | undefined,
  };
}
