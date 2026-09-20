"use client";

import { useChatBox } from "./ChatBox.js";

export interface ModelSelectorProps {
  /** Available models */
  models: Array<{ id: string; name: string; provider?: string }>;
  /** Currently selected model */
  value?: string;
  /** Called when model changes */
  onChange?: (model: string) => void;
  /** Additional CSS class */
  className?: string;
  /** Disable selector */
  disabled?: boolean;
}

/**
 * Headless ModelSelector — dropdown for model selection.
 */
export function ModelSelector({ models, value, onChange, className, disabled }: ModelSelectorProps) {
  return (
    <select
      className={className}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      disabled={disabled}
      aria-label="Select model"
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}{m.provider ? ` (${m.provider})` : ""}
        </option>
      ))}
    </select>
  );
}
