/**
 * @hilbras/sdk — UIMessage Protocol
 *
 * Standard protocol for streaming LLM responses to frontend UIs.
 * Designed for useChat/useCompletion hooks in React/Vue/Svelte.
 */

// ─── Message Types ──────────────────────────────────────────────────────────

/** A message in the UI conversation */
export interface UIMessage {
  /** Unique message ID */
  id: string;
  /** Role of the message sender */
  role: "user" | "assistant" | "system";
  /** Message content (may be partial during streaming) */
  content: string;
  /** Timestamp */
  createdAt?: number;
  /** Tool invocations triggered by this message */
  toolInvocations?: UIToolInvocation[];
  /** Provider/model used for this message */
  provider?: string;
  model?: string;
  /** Token usage for this message */
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

/** A tool invocation within a message */
export interface UIToolInvocation {
  /** Tool call ID */
  id: string;
  /** Tool name */
  name: string;
  /** Tool arguments (may be partial during streaming) */
  args: Record<string, unknown>;
  /** Tool result (set after execution) */
  result?: unknown;
  /** State of the invocation */
  state: "call" | "result" | "error";
  /** Error if state is "error" */
  error?: string;
}

// ─── Stream Protocol ────────────────────────────────────────────────────────

/** Protocol message types for frontend streaming */
export type UIProtocolMessage =
  | { type: "message_start"; messageId: string }
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; args: string }
  | { type: "tool_call_end"; id: string }
  | { type: "message_end"; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } }
  | { type: "error"; error: string };

// ─── Hook Options ───────────────────────────────────────────────────────────

/** Options for useChat hook */
export interface UseChatOptions {
  /** API endpoint URL */
  api: string;
  /** Initial messages */
  initialMessages?: UIMessage[];
  /** Provider to use */
  provider?: string;
  /** Model to use */
  model?: string;
  /** Callback when response completes */
  onFinish?: (message: UIMessage) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Additional headers for API calls */
  headers?: Record<string, string>;
  /** Body parameters sent with every request */
  body?: Record<string, unknown>;
}

/** Options for useCompletion hook */
export interface UseCompletionOptions {
  /** API endpoint URL */
  api: string;
  /** Initial prompt */
  initialPrompt?: string;
  /** Provider to use */
  provider?: string;
  /** Model to use */
  model?: string;
  /** Callback when completion finishes */
  onFinish?: (text: string) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Additional headers for API calls */
  headers?: Record<string, string>;
  /** Body parameters sent with every request */
  body?: Record<string, unknown>;
}

// ─── Hook State ─────────────────────────────────────────────────────────────

/** State returned by useChat */
export interface UseChatState {
  /** Current messages in the conversation */
  messages: UIMessage[];
  /** Current streaming text (empty when not streaming) */
  input: string;
  /** Whether a response is currently being streamed */
  isLoading: boolean;
  /** Last error, if any */
  error: Error | null;
}

/** Actions returned by useChat */
export interface UseChatActions {
  /** Set the input text */
  setInput: (input: string) => void;
  /** Submit a new user message */
  handleSubmit: (e?: { preventDefault: () => void }) => Promise<void>;
  /** Add a message programmatically and get a response */
  append: (message: UIMessage | { role: "user"; content: string }) => Promise<void>;
  /** Reload the last assistant message */
  reload: () => Promise<void>;
  /** Replace all messages */
  setMessages: (messages: UIMessage[]) => void;
  /** Stop the current stream */
  stop: () => void;
  /** Clear all messages */
  clear: () => void;
}

/** State returned by useCompletion */
export interface UseCompletionState {
  /** Current completion text */
  completion: string;
  /** Whether a completion is currently being streamed */
  isLoading: boolean;
  /** Last error, if any */
  error: Error | null;
  /** Current input prompt */
  input: string;
}

/** Actions returned by useCompletion */
export interface UseCompletionActions {
  /** Set the input text */
  setInput: (input: string) => void;
  /** Submit a new completion request */
  handleSubmit: (e?: { preventDefault: () => void }) => Promise<void>;
  /** Stop the current stream */
  stop: () => void;
  /** Clear the completion */
  clear: () => void;
}
