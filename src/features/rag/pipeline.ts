/**
 * @hilbras/rag — RAG Pipeline
 *
 * Complete RAG pipeline combining document ingestion, embedding,
 * storage, retrieval, and reranking.
 */

import type { VectorDocument, VectorStore } from "./vector-store.js";
import type { ChunkOptions } from "./chunker.js";
import { chunkDocuments } from "./chunker.js";
import {
  Retriever,
  buildContextFromDocuments,
  buildMessagesFromDocuments,
  type RetrieverConfig,
  type RetrievalOptions,
  type RetrievalResult,
} from "./retriever.js";

export interface RAGPipelineConfig {
  /** Embedding function: text → vector */
  embedder: (input: string) => Promise<number[]>;
  /** Vector store backend */
  store: VectorStore;
  /** Chunking options */
  chunkOptions?: ChunkOptions;
  /** Optional reranker */
  reranker?: RetrieverConfig["reranker"];
  /** Default number of results to retrieve */
  topK?: number;
  /** Minimum similarity score */
  minScore?: number;
  /** System prompt for RAG responses */
  systemPrompt?: string;
}

export interface IngestDocument {
  /** Document content */
  content: string;
  /** Optional document ID */
  id?: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

export interface RAGResult {
  /** The user's query */
  query: string;
  /** Retrieved context */
  context: string;
  /** Retrieved documents with scores */
  documents: RetrievalResult[];
  /** Messages ready for chat completion */
  messages: Array<{ role: string; content: string }>;
}

/**
 * Complete RAG pipeline.
 *
 * Usage:
 *   const pipeline = new RAGPipeline({
 *     embedder: async (text) => await client.embed({ model: "text-embedding-3-small", input: text }),
 *     store: new InMemoryVectorStore({ dimension: 1536 }),
 *   });
 *
 *   // Ingest documents
 *   await pipeline.ingest([
 *     { content: "The capital of France is Paris.", id: "doc1" },
 *     { content: "Python is a programming language.", id: "doc2" },
 *   ]);
 *
 *   // Query
 *   const result = await pipeline.query("What is the capital of France?");
 *   const response = await client.chat({ messages: result.messages });
 */
export class RAGPipeline {
  private _embedder: (input: string) => Promise<number[]>;
  private _store: VectorStore;
  private _chunkOptions: ChunkOptions;
  private _reranker?: RetrieverConfig["reranker"];
  private _topK: number;
  private _minScore: number;
  private _systemPrompt?: string;

  constructor(config: RAGPipelineConfig) {
    this._embedder = config.embedder;
    this._store = config.store;
    this._chunkOptions = config.chunkOptions ?? {};
    this._reranker = config.reranker;
    this._topK = config.topK ?? 5;
    this._minScore = config.minScore ?? 0;
    this._systemPrompt = config.systemPrompt;
  }

  /**
   * Ingest documents into the vector store.
   */
  async ingest(documents: IngestDocument[]): Promise<number> {
    // Chunk documents
    const chunks = chunkDocuments(documents, this._chunkOptions);

    if (chunks.length === 0) return 0;

    // Embed all chunks in batch
    const embeddings = await Promise.all(
      chunks.map((c) => this._embedder(c.content)),
    );

    // Store in vector store
    const vectorDocs: VectorDocument[] = chunks.map((chunk, i) => ({
      id: `${chunk.documentId}_chunk_${chunk.chunkIndex}`,
      content: chunk.content,
      embedding: embeddings[i],
      metadata: {
        ...chunk.metadata,
        documentId: chunk.documentId,
        chunkIndex: chunk.chunkIndex,
        sourceIndex: chunk.sourceIndex,
      },
    }));

    await this._store.add(vectorDocs);
    return vectorDocs.length;
  }

  /**
   * Query the pipeline and get context + messages.
   */
  async query(query: string, options?: RetrievalOptions): Promise<RAGResult> {
    const retriever = new Retriever({
      store: this._store,
      embedder: this._embedder,
      topK: this._topK,
      reranker: this._reranker,
      minScore: this._minScore,
    });

    const documents = await retriever.retrieve(query, options);
    const context = buildContextFromDocuments(documents);
    const messages = buildMessagesFromDocuments(query, documents, this._systemPrompt);

    return { query, context, documents, messages };
  }

  /**
   * Get the number of documents in the store.
   */
  size(): number {
    return this._store.size();
  }

  /**
   * Clear the pipeline (remove all documents).
   */
  async clear(): Promise<void> {
    await this._store.clear();
  }
}
