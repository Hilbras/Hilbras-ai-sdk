# RAG Primitives

`@hilbras/sdk` provides vector storage, retrieval, and RAG pipeline primitives.

## Installation

```bash
npm install @hilbras/sdk
```

## Quick Start

```typescript
import {
  InMemoryVectorStore,
  chunkText,
  Retriever,
  RAGPipeline,
} from "@hilbras/sdk/rag";

// Chunk documents
const chunks = chunkText(document, { chunkSize: 500, overlap: 50 });

// Create vector store
const store = new InMemoryVectorStore();
await store.upsert(chunks.map((chunk, i) => ({
  id: `chunk-${i}`,
  vector: await embed(chunk),
  content: chunk,
  metadata: { source: "doc.pdf" },
})));

// Retrieve relevant chunks
const retriever = new Retriever({ store, topK: 5 });
const results = await retriever.retrieve("What is RAG?");

// RAG pipeline
const pipeline = new RAGPipeline({
  embedder: async (text) => embed(text),
  store,
  topK: 5,
});

const answer = await pipeline.query("What is RAG?");
```

## VectorStore

```typescript
import { InMemoryVectorStore } from "@hilbras/sdk/rag";

const store = new InMemoryVectorStore();

// Upsert vectors
await store.upsert([
  { id: "1", vector: [0.1, 0.2, 0.3], content: "Hello world" },
  { id: "2", vector: [0.4, 0.5, 0.6], content: "Goodbye world" },
]);

// Query by similarity
const results = await store.query({
  vector: [0.1, 0.2, 0.3],
  topK: 2,
  filter: { source: "doc.pdf" },
});

// Delete
await store.delete("1");
```

## Chunking

```typescript
import { chunkText, chunkDocuments } from "@hilbras/sdk/rag";

// Chunk raw text
const chunks = chunkText("Long document text...", {
  chunkSize: 500,   // characters per chunk
  overlap: 50,      // overlap between chunks
});

// Chunk structured documents
const docs = [
  { content: "Section 1...", metadata: { title: "Intro" } },
  { content: "Section 2...", metadata: { title: "Methods" } },
];
const chunks = chunkDocuments(docs, { chunkSize: 500 });
```

## Retriever

```typescript
import { Retriever } from "@hilbras/sdk/rag";

const retriever = new Retriever({
  store: vectorStore,
  topK: 5,
  filter: { source: "docs" },  // optional metadata filter
});

const results = await retriever.retrieve("search query");
// Returns: Array<{ id, content, score, metadata }>
```

## Custom VectorStore

Implement the `VectorStore` interface to use any vector database:

```typescript
import type { VectorStore, VectorRecord } from "@hilbras/sdk/rag";

class PineconeStore implements VectorStore {
  async upsert(records: VectorRecord[]): Promise<void> { /* ... */ }
  async query(params: { vector: number[]; topK: number; filter?: Record<string, unknown> }): Promise<VectorRecord[]> { /* ... */ }
  async delete(id: string): Promise<void> { /* ... */ }
}
```
