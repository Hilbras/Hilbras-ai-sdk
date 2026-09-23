"use client";

import { createContext, useContext, useMemo, type FormEvent, type ReactNode } from "react";
import {
  HilbrasProvider,
  useChat,
  useCost,
  type ChatMessage,
  type UseChatOptions,
} from "@hilbras/react";

interface ChatBoxContextValue {
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  handleSubmit: (e?: FormEvent) => Promise<void>;
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
  /** Pre-existing client instance. Prefer this for server-proxy integrations. */
  client?: Parameters<typeof HilbrasProvider>[0]["client"];
}

interface ChatBoxContentProps extends Omit<ChatBoxProps, "children"> {
  children: ReactNode;
}

/** Hooks must run below HilbrasProvider. */
function ChatBoxContent({ children, client, providerConfig, ...chatOptions }: ChatBoxContentProps) {
  const chat = useChat(chatOptions);
  const cost = useCost({ enabled: true });

  const value = useMemo<ChatBoxContextValue>(
    () => ({
      ...chat,
      costSnapshot: cost.snapshot,
    }),
    [chat, cost.snapshot],
  );

  return <ChatBoxContext.Provider value={value}>{children}</ChatBoxContext.Provider>;
}

/**
 * Headless ChatBox container. Wraps children with context providing
 * chat state, cost tracking, and input handlers.
 */
export function ChatBox({ children, client, providerConfig, ...chatOptions }: ChatBoxProps) {
  return (
    <HilbrasProvider config={providerConfig} client={client}>
      <ChatBoxContent client={client} providerConfig={providerConfig} {...chatOptions}>
        {children}
      </ChatBoxContent>
    </HilbrasProvider>
  );
}
