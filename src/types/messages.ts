/**
 * @hilbras/sdk — Message types
 *
 * Canonical message representation shared across all provider adapters.
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

export interface Message {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
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
    content: (raw.content as string | null) ?? null,
    tool_calls: raw.tool_calls as ToolCall[] | undefined,
    tool_call_id: raw.tool_call_id as string | undefined,
    name: raw.name as string | undefined,
  };
}
