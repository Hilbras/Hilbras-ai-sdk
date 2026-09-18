/**
 * @hilbras/rag — VectorStore Interface
 *
 * Abstract interface for vector storage backends.
 * Implementations can be in-memory, Pinecone, Weaviate, Chroma, etc.
 */

export interface VectorDocument {
  /** Unique document ID */
  id: string;
  /** Document content/text */
  content: string;
  /** Vector embedding */
  embedding: number[];
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  /** The matched document */
  document: VectorDocument;
  /** Similarity score (0-1, higher = more similar) */
  score: number;
}

export interface VectorStoreConfig {
  /** Dimension of the embeddings */
  dimension: number;
  /** Distance metric: cosine (default), dot, l2 */
  metric?: "cosine" | "dot" | "l2";
}

export interface VectorStore {
  /** Add documents to the store */
  add(documents: VectorDocument[]): Promise<void>;
  /** Remove documents by ID */
  remove(ids: string[]): Promise<void>;
  /** Search for similar documents */
  search(embedding: number[], topK: number): Promise<SearchResult[]>;
  /** Get document by ID */
  get(id: string): Promise<VectorDocument | null>;
  /** Get total number of documents */
  size(): number;
  /** Clear all documents */
  clear(): Promise<void>;
}
