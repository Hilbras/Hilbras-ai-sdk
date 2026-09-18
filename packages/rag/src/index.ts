/**
 * @hilbras/rag — RAG Primitives
 *
 * Building blocks for Retrieval-Augmented Generation:
 * - VectorStore / InMemoryVectorStore
 * - Chunker
 * - Retriever
 * - RAGPipeline
 */

export type { VectorDocument, SearchResult, VectorStoreConfig, VectorStore } from "./vector-store.js";
export { InMemoryVectorStore } from "./in-memory-store.js";
export { chunkText, chunkDocuments, type ChunkOptions, type TextChunk } from "./chunker.js";
export { Retriever, type RetrieverConfig, type RetrievalOptions, type RetrievalResult } from "./retriever.js";
export { RAGPipeline, type RAGPipelineConfig, type IngestDocument, type RAGResult } from "./pipeline.js";
