"use client";

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { HilbrasClient, type HilbrasClientConfig } from "../../client/client.js";

interface HilbrasContextValue {
  client: HilbrasClient;
}

const HilbrasContext = createContext<HilbrasContextValue | null>(null);

export interface HilbrasProviderProps {
  children: ReactNode;
  /**
   * HilbrasClient config — creates a new client if not provided.
   *
   * @warning Passing an API key here bundles it into your client-side
   * JavaScript, where anyone can read it. In a browser this is a public secret.
   * Prefer passing a server-created `client` down from a Server Component, or
   * use the route-based hooks in `@hilbras/sdk/react` instead.
   */
  config?: HilbrasClientConfig;
  /**
   * Pre-existing client instance (overrides config).
   *
   * Build this on the server and pass it in, so no credential is serialised
   * into the browser bundle.
   */
  client?: HilbrasClient;
}

/**
 * HilbrasProvider — wraps your app and provides a shared HilbrasClient.
 *
 * @warning The client this provides calls providers **from the browser**. For a
 * public app, use `@hilbras/sdk/react`'s route-based `useChat` with
 * `createChatHandler` from `@hilbras/sdk/nextjs` so the key stays on your
 * server. See `@hilbras/sdk/react-client` for when this is appropriate.
 *
 * @example
 * ```tsx
 * <HilbrasProvider client={client}>
 *   <App />
 * </HilbrasProvider>
 * ```
 */
export function HilbrasProvider({ children, config, client: existingClient }: HilbrasProviderProps) {
  const value = useMemo(() => {
    const client = existingClient ?? new HilbrasClient(config);
    return { client };
  }, [existingClient, config]);

  // `createElement` rather than JSX: the SDK ships no `.tsx` and its tsconfig has
  // no `--jsx`, matching how `src/frameworks/react/generative-ui.ts` builds
  // elements. Enabling JSX for one file would change the build for all of src.
  return createElement(HilbrasContext.Provider, { value }, children);
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
