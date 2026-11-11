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

import type { ReasoningChunk, TextChunk } from "../types/streams.js";

/** Matched only at the start of the buffer, as before. */
const OPEN_TAG = /^<(?:thinking|reasoning|reason)>\s*/i;
/** Matched anywhere: the closing tag can sit mid-buffer when a provider batches. */
const CLOSE_TAG = /<\/(?:thinking|reasoning|reason)>/i;
/** "<reasoning>" is the longest opening tag — the tail kept for cross-chunk detection. */
const MAX_TAG_PREFIX = 11;

/** What one delta contributes, in order. */
export type ReasoningPart = ReasoningChunk | TextChunk;

export class ReasoningNormalizer {
  private _buffer = "";
  private _inTag = false;

  /**
   * Feed text that might be reasoning and return the parts it contributes, in
   * order.
   *
   * A single delta can carry a complete reasoning block *and* the reply that
   * follows it — e.g. `<thinking>2+2=4</thinking>The answer is 4`. The previous
   * single-chunk return value could not express that: it emitted everything
   * after the opening tag as reasoning, so the answer was swallowed and the
   * closing tag leaked into the reasoning text.
   *
   * An empty array means "nothing of its own" — the caller should fall back to
   * treating the delta as plain text.
   */
  feedText(text: string): ReasoningPart[] {
    this._buffer += text;
    const parts: ReasoningPart[] = [];

    if (!this._inTag) {
      const open = OPEN_TAG.exec(this._buffer);
      if (!open) {
        // Not a reasoning tag. Keep only a small tail so a tag split across
        // deltas ("<think" + "ing>") is still detected, without unbounded
        // buffer growth.
        if (this._buffer.length > MAX_TAG_PREFIX) {
          this._buffer = this._buffer.slice(-MAX_TAG_PREFIX);
        }
        return parts;
      }
      this._buffer = this._buffer.slice(open[0].length);
      this._inTag = true;
    }

    // Inside a reasoning block. The closing tag may already be present in this
    // same delta, so check before treating the whole buffer as reasoning.
    const close = CLOSE_TAG.exec(this._buffer);
    if (close) {
      const reasoning = this._buffer.slice(0, close.index).trim();
      const trailing = this._buffer.slice(close.index + close[0].length).trim();
      this._inTag = false;
      this._buffer = "";
      if (reasoning) parts.push({ type: "reasoning", text: reasoning });
      if (trailing) parts.push({ type: "text", text: trailing });
      return parts;
    }

    const reasoning = this._buffer;
    this._buffer = "";
    if (reasoning) parts.push({ type: "reasoning", text: reasoning });
    return parts;
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
  }
}
