"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { HilbrasClient, type HilbrasClientConfig } from "@hilbras/sdk";

interface HilbrasContextValue {
  client: HilbrasClient;
}

const HilbrasContext = createContext<HilbrasContextValue | null>(null);

export interface HilbrasProviderProps {
  children: ReactNode;
  /** HilbrasClient config — creates a new client if not provided */
  config?: HilbrasClientConfig;
  /** Pre-existing client instance (overrides config) */
  client?: HilbrasClient;
}

/**
 * HilbrasProvider — wraps your app and provides a shared HilbrasClient.
 *
 * @example
 * ```tsx
 * <HilbrasProvider config={{ providers: [{ name: "openai", ... }] }}>
 *   <App />
 * </HilbrasProvider>
 * ```
 */
export function HilbrasProvider({ children, config, client: existingClient }: HilbrasProviderProps) {
  const value = useMemo(() => {
    const client = existingClient ?? new HilbrasClient(config);
    return { client };
  }, [existingClient, config]);

  return <HilbrasContext.Provider value={value}>{children}</HilbrasContext.Provider>;
}

/**
 * Access the shared HilbrasClient from the nearest HilbrasProvider.
 */
export function useHilbrasClient(): HilbrasClient {
  const ctx = useContext(HilbrasContext);
  if (!ctx) {
    throw new Error(
      "useHilbrasClient must be used within a <HilbrasProvider>. " +
      "Wrap your app with <HilbrasProvider config={...}> or pass a client directly."
    );
  }
  return ctx.client;
}
