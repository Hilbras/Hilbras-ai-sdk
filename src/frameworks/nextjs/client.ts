/**
 * @hilbras/nextjs — Client Components
 *
 * React components and hooks for Next.js client-side use.
 */

export { useChat } from "./use-chat.js";
export { useCompletion } from "./use-completion.js";

import { useSignal } from "./signal-shim.js";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  id?: string;
}
