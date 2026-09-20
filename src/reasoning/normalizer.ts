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
  private _lastReturnedIndex = 0;

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
          this._lastReturnedIndex = this._buffer.length;
          return this._buffer.length > 0
            ? { type: "reasoning", text: this._buffer }
            : null;
        }
      }
      // Not a reasoning tag — return null (caller should yield as text).
      // v2.4.0 BUG-02: keep only a small tail for cross-chunk tag detection
      // (e.g. chunk ends with "<think") to prevent unbounded buffer growth.
      const MAX_TAG_PREFIX = 11; // "<reasoning>" is the longest opening tag
      if (this._buffer.length > MAX_TAG_PREFIX) {
        this._buffer = this._buffer.slice(-MAX_TAG_PREFIX);
      }
      return null;
    }

    // We're inside a tag — check for closing
    if (/<\/(?:thinking|reasoning|reason)>/i.test(this._buffer)) {
      this._inTag = false;
      const cleaned = this._buffer.replace(TAG_PATTERNS[1], "").trim();
      const newText = cleaned.slice(this._lastReturnedIndex).trim();
      this._buffer = "";
      this._lastReturnedIndex = 0;
      return newText ? { type: "reasoning", text: newText } : null;
    }

    // Still accumulating inside tag — return only new content
    const newText = this._buffer.slice(this._lastReturnedIndex);
    this._lastReturnedIndex = this._buffer.length;
    return { type: "reasoning", text: newText };
  }

  /** Explicitly yield a reasoning chunk (for adapters with native reasoning fields) */
  static native(text: string): ReasoningChunk {
    return { type: "reasoning", text };
  }

  /** Check if text looks like a reasoning opening or closing tag */
  static looksLikeReasoningTag(text: string): boolean {
    return /^<(?:\/)?(?:thinking|reasoning|reason)>/i.test(text);
  }

  reset(): void {
    this._buffer = "";
    this._inTag = false;
    this._lastReturnedIndex = 0;
  }
}
