"use client";

import { useChatBox } from "./ChatBox.js";

export interface ErrorBannerProps {
  /** Custom render function */
  render?: (error: Error) => React.ReactNode;
  /** Additional CSS class */
  className?: string;
}

/**
 * Headless ErrorBanner — actionable error display with retry.
 */
export function ErrorBanner({ render, className }: ErrorBannerProps) {
  const { error, retry } = useChatBox();

  if (!error) return null;

  if (render) {
    return <div className={className} role="alert">{render(error)}</div>;
  }

  return (
    <div className={className} role="alert">
      <span>{error.message}</span>
      <button onClick={() => retry()} aria-label="Retry">Retry</button>
    </div>
  );
}
