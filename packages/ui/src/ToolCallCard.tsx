"use client";

import { useState } from "react";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

export interface ToolCallCardProps {
  /** Tool call data */
  toolCall: ToolCall;
  /** Initially expanded */
  defaultExpanded?: boolean;
  /** Custom render function */
  render?: (toolCall: ToolCall, expanded: boolean, toggle: () => void) => React.ReactNode;
  /** Additional CSS class */
  className?: string;
}

/**
 * Headless ToolCallCard — expandable tool call display.
 */
export function ToolCallCard({ toolCall, defaultExpanded = false, render, className }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const toggle = () => setExpanded((e) => !e);

  if (render) {
    return <div className={className}>{render(toolCall, expanded, toggle)}</div>;
  }

  return (
    <div className={className}>
      <button onClick={toggle} aria-expanded={expanded} aria-label={`Tool: ${toolCall.name}`}>
        {expanded ? "▼" : "▶"} {toolCall.name}
      </button>
      {expanded && (
        <div className="hilbras-tool-details">
          <pre>Arguments: {JSON.stringify(toolCall.arguments, null, 2)}</pre>
          {toolCall.result !== undefined && (
            <pre>Result: {JSON.stringify(toolCall.result, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}
