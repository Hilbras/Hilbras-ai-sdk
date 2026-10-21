/**
 * @hilbras/nextjs — Client Components
 *
 * React components and hooks for Next.js client-side use.
 */

export { useChat } from "./use-chat.js";
export { useCompletion } from "./use-completion.js";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  id?: string;
}
