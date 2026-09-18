/**
 * @hilbras/eval — Metrics
 *
 * Built-in metrics for evaluating LLM outputs.
 */

import type { MetricResult, EvalDatasetItem } from "./types.js";

/**
 * Exact string match (case-insensitive, trimmed).
 */
export function exactMatch(output: string, item: EvalDatasetItem): MetricResult {
  const passed = item.expected !== undefined &&
    output.trim().toLowerCase() === item.expected.trim().toLowerCase();
  return {
    name: "exact_match",
    score: passed ? 1 : 0,
    passed,
    explanation: passed ? "Exact match" : `Expected "${item.expected}", got "${output.trim()}"`,
  };
}

/**
 * Output contains expected substring.
 */
export function contains(output: string, item: EvalDatasetItem): MetricResult {
  const passed = item.expected !== undefined &&
    output.toLowerCase().includes(item.expected.toLowerCase());
  return {
    name: "contains",
    score: passed ? 1 : 0,
    passed,
    explanation: passed ? "Contains expected substring" : `Missing "${item.expected}"`,
  };
}

/**
 * Semantic similarity using simple word overlap (Jaccard).
 * For production, use embeddings-based similarity.
 */
export function similarity(output: string, item: EvalDatasetItem): MetricResult {
  if (!item.expected) {
    return { name: "similarity", score: 0, passed: false, explanation: "No expected output" };
  }

  const wordsA = new Set(output.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(item.expected.toLowerCase().split(/\s+/).filter(Boolean));
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  const score = union.size === 0 ? 0 : intersection.size / union.size;
  const passed = score >= 0.5;

  return {
    name: "similarity",
    score,
    passed,
    explanation: `Jaccard similarity: ${score.toFixed(3)}`,
  };
}

/**
 * Toxicity check — detects common toxic phrases.
 * Simple heuristic; for production use a dedicated toxicity model.
 */
export function toxicity(output: string, _item: EvalDatasetItem): MetricResult {
  const toxicPatterns = [
    /\b(hate|kill|die|stupid|idiot|dumb)\b/i,
    /\b(racist|sexist|homophobic)\b/i,
    /\b(threat|attack|harm)\b/i,
  ];

  const detected = toxicPatterns.some((p) => p.test(output));
  const score = detected ? 1 : 0; // 1 = toxic (bad)
  const passed = !detected; // pass if NOT toxic

  return {
    name: "toxicity",
    score,
    passed,
    explanation: detected ? "Toxic content detected" : "No toxic content",
  };
}

/**
 * Coherence check — simple heuristic based on sentence structure.
 */
export function coherence(output: string, _item: EvalDatasetItem): MetricResult {
  const sentences = output.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = output.split(/\s+/).filter(Boolean);
  const avgSentenceLength = words.length / Math.max(sentences.length, 1);

  // Very short or very long sentences suggest poor coherence
  const score = avgSentenceLength >= 3 && avgSentenceLength <= 40 ? 1 :
    avgSentenceLength >= 1 && avgSentenceLength <= 60 ? 0.7 : 0.3;
  const passed = score >= 0.7;

  return {
    name: "coherence",
    score,
    passed,
    explanation: `Avg sentence length: ${avgSentenceLength.toFixed(1)} words`,
  };
}

/**
 * LLM-as-judge metric — uses an LLM to evaluate the output.
 */
export function llmJudge(
  llm: (messages: Array<{ role: string; content: string }>) => Promise<{ content: string }>
) {
  return async (output: string, item: EvalDatasetItem): Promise<MetricResult> => {
    const contextStr = item.context?.length ? `\n\nContext:\n${item.context.join("\n")}` : "";
    const expectedStr = item.expected ? `\n\nExpected:\n${item.expected}` : "";

    const prompt = `You are an evaluation judge. Rate the following output on a scale of 0-1.

Input: ${item.input}${contextStr}${expectedStr}

Output to evaluate:
${output}

Respond with ONLY a JSON object:
{"score": <0-1>, "explanation": "<brief explanation>"}`;

    try {
      const response = await llm([{ role: "user", content: prompt }]);
      const match = response.content.match(/\{[^}]+\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const score = Math.max(0, Math.min(1, Number(parsed.score) || 0));
        return {
          name: "llm_judge",
          score,
          passed: score >= 0.7,
          explanation: parsed.explanation || "",
          raw: parsed,
        };
      }
    } catch {
      // Fall through to default
    }

    return {
      name: "llm_judge",
      score: 0,
      passed: false,
      explanation: "Failed to get LLM judge evaluation",
    };
  };
}
