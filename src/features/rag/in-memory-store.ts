/**
 * @hilbras/rag — In-Memory Vector Store
 *
 * Fast in-memory vector store with cosine similarity search.
 * Suitable for small-to-medium datasets (< 100k documents).
 * For larger datasets, use a dedicated vector database adapter.
 */

import type { VectorDocument, VectorStore, VectorStoreConfig, SearchResult } from "./vector-store.js";

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function dotProduct(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function l2Distance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

export class InMemoryVectorStore implements VectorStore {
  private _docs = new Map<string, VectorDocument>();
  private _dimension: number;
  private _metric: string;

  constructor(config: VectorStoreConfig) {
    this._dimension = config.dimension;
    this._metric = config.metric ?? "cosine";
  }

  async add(documents: VectorDocument[]): Promise<void> {
    for (const doc of documents) {
      if (doc.embedding.length !== this._dimension) {
        throw new Error(
          `Embedding dimension mismatch: expected ${this._dimension}, got ${doc.embedding.length}`
        );
      }
      this._docs.set(doc.id, doc);
    }
  }

  async remove(ids: string[]): Promise<void> {
    for (const id of ids) this._docs.delete(id);
  }

  async search(embedding: number[], topK: number): Promise<SearchResult[]> {
    if (embedding.length !== this._dimension) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this._dimension}, got ${embedding.length}`
      );
    }

    const results: SearchResult[] = [];
    for (const doc of this._docs.values()) {
      let score: number;
      switch (this._metric) {
        case "dot":
          score = dotProduct(embedding, doc.embedding);
          break;
        case "l2":
          score = 1 / (1 + l2Distance(embedding, doc.embedding));
          break;
        default:
          score = cosineSimilarity(embedding, doc.embedding);
      }
      results.push({ document: doc, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  async get(id: string): Promise<VectorDocument | null> {
    return this._docs.get(id) ?? null;
  }

  size(): number {
    return this._docs.size;
  }

  async clear(): Promise<void> {
    this._docs.clear();
  }
}
