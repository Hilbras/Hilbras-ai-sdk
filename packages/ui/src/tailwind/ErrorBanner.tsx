"use client";

import { useChatBox } from "../ChatBox.js";
import type { ErrorBannerProps } from "../ErrorBanner.js";

export function TailwindErrorBanner({ render, className }: ErrorBannerProps) {
  const { error, retry } = useChatBox();

  if (!error) return null;

  if (render) {
    return <div className={`rounded-lg bg-red-50 border border-red-200 px-4 py-3 ${className ?? ""}`} role="alert">{render(error)}</div>;
  }

  return (
    <div className={`rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-center justify-between ${className ?? ""}`} role="alert">
      <span className="text-sm text-red-700">{error.message}</span>
      <button onClick={() => retry()} className="text-sm text-red-600 hover:text-red-800 underline" aria-label="Retry">Retry</button>
    </div>
  );
}
