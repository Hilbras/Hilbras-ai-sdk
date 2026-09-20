"use client";

import type { ModelSelectorProps } from "../ModelSelector.js";

export function TailwindModelSelector({ models, value, onChange, className, disabled }: ModelSelectorProps) {
  return (
    <select
      className={`rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 ${className ?? ""}`}
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
