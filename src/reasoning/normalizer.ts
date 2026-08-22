/**
 * @hilbras/sdk — Reasoning Normalizer
 *
 * Converts provider-specific reasoning formats into a unified ReasoningChunk.
 * Adapters use this to normalize before yielding to the caller.
 *
 * Supports:
 *   - Native reasoning fields (Anthropic thinking blocks, Responses reasoning)
 *   - Text-based reasoning tags (<thinking>, <reasoning>, <reason>)
 */

import type { ReasoningChunk } from "../types/streams.js";

const TAG_PATTERNS = [
  /^<(?:thinking|reasoning|reason)>\s*/i,
  /<\/(?:thinking|reasoning|reason)>\s*$/i,
];

export class ReasoningNormalizer {
  private _buffer = "";
  private _inTag = false;

  /**
   * Feed text that might be reasoning. Returns a ReasoningChunk if the
   * content is confirmed as reasoning, null if it should be treated as text.
   */
  feedText(text: string): ReasoningChunk | null {
    this._buffer += text;

    // Check if we just entered a reasoning tag
    if (!this._inTag) {
      for (const pat of TAG_PATTERNS) {
        if (pat.test(this._buffer)) {
          this._inTag = true;
          // Strip the opening tag
          this._buffer = this._buffer.replace(TAG_PATTERNS[0], "");
          return this._buffer.length > 0
            ? { type: "reasoning", text: this._buffer }
            : null;
        }
      }
      // Not a reasoning tag — return null (caller should yield as text)
      return null;
    }

    // We're inside a tag — check for closing
    if (/<\/(?:thinking|reasoning|reason)>/i.test(this._buffer)) {
      this._inTag = false;
      const cleaned = this._buffer.replace(TAG_PATTERNS[1], "").trim();
      this._buffer = "";
      return cleaned ? { type: "reasoning", text: cleaned } : null;
    }

    // Still accumulating inside tag
    return { type: "reasoning", text: this._buffer };
  }

  /** Explicitly yield a reasoning chunk (for adapters with native reasoning fields) */
  static native(text: string): ReasoningChunk {
    return { type: "reasoning", text };
  }

  /** Check if text starts with a reasoning tag */
  static looksLikeReasoningTag(text: string): boolean {
    return /^<(?:thinking|reasoning|reason)>/i.test(text);
  }

  reset(): void {
    this._buffer = "";
    this._inTag = false;
  }
}
