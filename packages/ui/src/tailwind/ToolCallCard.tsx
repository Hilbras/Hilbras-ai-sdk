"use client";

import { useState } from "react";
import type { ToolCallCardProps } from "../ToolCallCard.js";

export function TailwindToolCallCard({ toolCall, defaultExpanded = false, render, className }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const toggle = () => setExpanded((e) => !e);

  if (render) {
    return <div className={`${className ?? ""}`}>{render(toolCall, expanded, toggle)}</div>;
  }

  return (
    <div className={`rounded-lg border border-gray-200 overflow-hidden ${className ?? ""}`}>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-mono hover:bg-gray-50"
        aria-expanded={expanded}
        aria-label={`Tool: ${toolCall.name}`}
      >
        <span>{expanded ? "▼" : "▶"}</span>
        <span className="font-semibold">{toolCall.name}</span>
      </button>
      {expanded && (
        <div className="border-t border-gray-200 px-3 py-2 bg-gray-50">
          <pre className="text-xs font-mono whitespace-pre-wrap">Arguments: {JSON.stringify(toolCall.arguments, null, 2)}</pre>
          {toolCall.result !== undefined && (
            <pre className="text-xs font-mono whitespace-pre-wrap mt-2">Result: {JSON.stringify(toolCall.result, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}
