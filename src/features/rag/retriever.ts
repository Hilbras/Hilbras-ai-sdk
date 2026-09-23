/**
 * @hilbras/rag — Retriever
 *
 * Hybrid retriever that combines vector similarity search with keyword matching.
 * Supports optional reranking for improved relevance.
 */

import type { VectorStore, SearchResult } from "./vector-store.js";

export interface RetrieverConfig {
  /** Vector store to search */
  store: VectorStore;
  /** Embedding function to convert queries to vectors */
  embedder: (input: string) => Promise<number[]>;
  /** Number of results to retrieve from vector store */
  topK?: number;
  /** Optional reranker function */
  reranker?: (query: string, documents: string[]) => Promise<Array<{ index: number; score: number }>>;
  /** Minimum similarity score threshold (0-1) */
  minScore?: number;
}

export interface RetrievalOptions {
  /** Override topK for this query */
  topK?: number;
  /** Filter by metadata */
  filter?: (metadata: Record<string, unknown>) => boolean;
  /** Whether to rerank results */
  rerank?: boolean;
}

export interface RetrievalResult {
  /** Retrieved content */
  content: string;
  /** Document ID */
  documentId: string;
  /** Similarity score */
  score: number;
  /** Source metadata */
  metadata?: Record<string, unknown>;
}

export function buildContextFromDocuments(documents: RetrievalResult[], maxLen = 4000): string {
  let context = "";
  for (const result of documents) {
    const addition = `${result.content}\n\n`;
    if (context.length + addition.length > maxLen) break;
    context += addition;
  }
  return context.trim();
}

export function buildMessagesFromDocuments(
  query: string,
  documents: RetrievalResult[],
  systemPrompt?: string,
  maxContextLength = 4000,
): Array<{ role: string; content: string }> {
  const context = buildContextFromDocuments(documents, maxContextLength);
  return [
    {
      role: "system",
      content: systemPrompt ?? "Answer the user's question based on the provided context. If the context doesn't contain enough information, say so.",
    },
    { role: "user", content: `Context:\n${context}\n\nQuestion: ${query}` },
  ];
}

/**
 * Hybrid retriever combining vector search with optional reranking.
 */
export class Retriever {
  private _store: VectorStore;
  private _embedder: (input: string) => Promise<number[]>;
  private _topK: number;
  private _reranker?: RetrieverConfig["reranker"];
  private _minScore: number;

  constructor(config: RetrieverConfig) {
    this._store = config.store;
    this._embedder = config.embedder;
    this._topK = config.topK ?? 5;
    this._reranker = config.reranker;
    this._minScore = config.minScore ?? 0;
  }

  /**
   * Retrieve relevant documents for a query.
   */
  async retrieve(query: string, options?: RetrievalOptions): Promise<RetrievalResult[]> {
    const topK = options?.topK ?? this._topK;
    const queryEmbedding = await this._embedder(query);

    // Vector similarity search
    let results = await this._store.search(queryEmbedding, topK * 2); // Fetch extra for reranking

    // Apply metadata filter
    if (options?.filter) {
      results = results.filter((r) => {
        const meta = r.document.metadata ?? {};
        return options.filter!(meta);
      });
    }

    // Apply min score threshold
    if (this._minScore > 0) {
      results = results.filter((r) => r.score >= this._minScore);
    }

    // Take top K
    results = results.slice(0, topK);

    // Rerank if available and requested
    if (this._reranker && options?.rerank !== false) {
      const docs = results.map((r) => r.document.content);
      const reranked = await this._reranker(query, docs);

      if (reranked.length > 0) {
        results = reranked.map((r) => ({
          ...results[r.index],
          score: r.score,
        }));
      }
    }

    return results.map((r) => ({
      content: r.document.content,
      documentId: r.document.id,
      score: r.score,
      metadata: r.document.metadata,
    }));
  }

  /**
   * Build a context string from retrieved documents.
   */
  async getContext(query: string, options?: RetrievalOptions & { maxContextLength?: number }): Promise<string> {
    const results = await this.retrieve(query, options);
    return buildContextFromDocuments(results, options?.maxContextLength ?? 4000);
  }

  /**
   * Build RAG prompt messages for chat completion.
   */
  async buildMessages(
    query: string,
    systemPrompt?: string,
    options?: RetrievalOptions & { maxContextLength?: number },
  ): Promise<Array<{ role: string; content: string }>> {
    return buildMessagesFromDocuments(
      query,
      await this.retrieve(query, options),
      systemPrompt,
      options?.maxContextLength ?? 4000,
    );
  }
}
