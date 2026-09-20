"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { HilbrasProvider, useChat, useCost, type ChatMessage, type UseChatOptions } from "@hilbras/react";

interface ChatBoxContextValue {
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  handleSubmit: (e?: React.FormEvent) => Promise<void>;
  sendMessage: (c: string) => Promise<void>;
  isLoading: boolean;
  isStreaming: boolean;
  error: Error | null;
  stop: () => void;
  clear: () => void;
  retry: () => Promise<void>;
  totalTokens: number;
  totalCost: number;
  costSnapshot: ReturnType<typeof useCost>["snapshot"];
}

const ChatBoxContext = createContext<ChatBoxContextValue | null>(null);

export function useChatBox() {
  const ctx = useContext(ChatBoxContext);
  if (!ctx) throw new Error("useChatBox must be used within a <ChatBox>");
  return ctx;
}

export interface ChatBoxProps extends UseChatOptions {
  children: ReactNode;
  /** HilbrasProvider config (passed through) */
  providerConfig?: Parameters<typeof HilbrasProvider>[0]["config"];
}

/**
 * Headless ChatBox container. Wraps children with context providing
 * chat state, cost tracking, and input handlers.
 *
 * @example
 * ```tsx
 * <ChatBox provider="openai" model="gpt-4o">
 *   <MessageList />
 *   <Input />
 * </ChatBox>
 * ```
 */
export function ChatBox({ children, providerConfig, ...chatOptions }: ChatBoxProps) {
  const chat = useChat(chatOptions);
  const cost = useCost({ enabled: true });

  const value = useMemo<ChatBoxContextValue>(
    () => ({
      ...chat,
      costSnapshot: cost.snapshot,
    }),
    [chat, cost.snapshot]
  );

  return (
    <HilbrasProvider config={providerConfig}>
      <ChatBoxContext.Provider value={value}>{children}</ChatBoxContext.Provider>
    </HilbrasProvider>
  );
}
