import { describe, it, expect, vi } from "vitest";
import { InMemoryVectorStore } from "../src/features/rag/in-memory-store.js";
import { chunkText, chunkDocuments } from "../src/features/rag/chunker.js";
import { Retriever } from "../src/features/rag/retriever.js";
import { RAGPipeline } from "../src/features/rag/pipeline.js";

// ─── InMemoryVectorStore ──────────────────────────────────────────

describe("InMemoryVectorStore", () => {
  it("adds and retrieves documents", async () => {
    const store = new InMemoryVectorStore({ dimension: 3 });
    await store.add([
      { id: "1", content: "hello", embedding: [1, 0, 0] },
      { id: "2", content: "world", embedding: [0, 1, 0] },
    ]);

    expect(store.size()).toBe(2);
    expect(await store.get("1")).toMatchObject({ content: "hello" });
  });

  it("searches by cosine similarity", async () => {
    const store = new InMemoryVectorStore({ dimension: 3 });
    await store.add([
      { id: "1", content: "cat", embedding: [1, 0, 0] },
      { id: "2", content: "dog", embedding: [0.9, 0.1, 0] },
      { id: "3", content: "car", embedding: [0, 0, 1] },
    ]);

    const results = await store.search([1, 0, 0], 2);
    expect(results).toHaveLength(2);
    expect(results[0].document.id).toBe("1");
    expect(results[0].score).toBeCloseTo(1.0);
    expect(results[1].document.id).toBe("2");
  });

  it("removes documents", async () => {
    const store = new InMemoryVectorStore({ dimension: 3 });
    await store.add([
      { id: "1", content: "a", embedding: [1, 0, 0] },
      { id: "2", content: "b", embedding: [0, 1, 0] },
    ]);

    await store.remove(["1"]);
    expect(store.size()).toBe(1);
    expect(await store.get("1")).toBeNull();
  });

  it("clears all documents", async () => {
    const store = new InMemoryVectorStore({ dimension: 3 });
    await store.add([
      { id: "1", content: "a", embedding: [1, 0, 0] },
    ]);

    await store.clear();
    expect(store.size()).toBe(0);
  });

  it("throws on dimension mismatch", async () => {
    const store = new InMemoryVectorStore({ dimension: 3 });
    await expect(
      store.add([{ id: "1", content: "a", embedding: [1, 0] }]),
    ).rejects.toThrow("dimension mismatch");
  });

  it("returns zero similarity for zero vectors", async () => {
    const store = new InMemoryVectorStore({ dimension: 2 });
    await store.add([{ id: "1", content: "zero", embedding: [0, 0] }]);
    const results = await store.search([0, 0], 1);
    expect(results[0].score).toBe(0);
  });

  it("supports dot product metric", async () => {
    const store = new InMemoryVectorStore({ dimension: 3, metric: "dot" });
    await store.add([
      { id: "1", content: "a", embedding: [1, 0, 0] },
      { id: "2", content: "b", embedding: [2, 0, 0] },
    ]);

    const results = await store.search([1, 0, 0], 2);
    expect(results[0].document.id).toBe("2"); // dot(2,0,0; 1,0,0) = 2 > 1
  });
});

// ─── Chunker ──────────────────────────────────────────────────────

describe("chunkText", () => {
  it("chunks text recursively", () => {
    const text = "A".repeat(500) + "\n\n" + "B".repeat(500) + "\n\n" + "C".repeat(200);
    const chunks = chunkText(text, { maxChunkSize: 400, strategy: "recursive" });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(600); // some overlap
    }
  });

  it("returns single chunk for short text", () => {
    const chunks = chunkText("Hello world", { maxChunkSize: 1000 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("Hello world");
  });

  it("rejects invalid chunk sizes and overlaps", () => {
    expect(() => chunkText("abc", { maxChunkSize: 0 })).toThrow(/maxChunkSize/);
    expect(() => chunkText("abc", { maxChunkSize: Number.POSITIVE_INFINITY })).toThrow(/maxChunkSize/);
    expect(() => chunkText("abc", { maxChunkSize: 10, overlap: 10 })).toThrow(/overlap/);
    expect(() => chunkText("abc", { maxChunkSize: 10, overlap: -1 })).toThrow(/overlap/);
  });

  it("chunks with fixed strategy", () => {
    const text = "A".repeat(1000);
    const chunks = chunkText(text, { maxChunkSize: 300, strategy: "fixed", overlap: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });
});

describe("chunkDocuments", () => {
  it("chunks multiple documents", () => {
    const docs = [
      { content: "A".repeat(500) + "\n\n" + "B".repeat(500), id: "doc1" },
      { content: "C".repeat(300), id: "doc2" },
    ];
    const chunks = chunkDocuments(docs, { maxChunkSize: 400 });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0].documentId).toBe("doc1");
  });
});

// ─── Retriever ────────────────────────────────────────────────────

describe("Retriever", () => {
  it("retrieves relevant documents", async () => {
    const store = new InMemoryVectorStore({ dimension: 3 });
    await store.add([
      { id: "1", content: "The capital of France is Paris.", embedding: [1, 0, 0] },
      { id: "2", content: "Python is a programming language.", embedding: [0, 1, 0] },
      { id: "3", content: "Paris is a beautiful city.", embedding: [0.95, 0.05, 0] },
    ]);

    const embedder = async (text: string): Promise<number[]> => {
      // Simple mock: "Paris" → closer to [1,0,0], "Python" → closer to [0,1,0]
      if (text.toLowerCase().includes("paris")) return [1, 0, 0];
      return [0, 1, 0];
    };

    const retriever = new Retriever({ store, embedder, topK: 2 });
    const results = await retriever.retrieve("Tell me about Paris");

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain("Paris");
  });

  it("builds context string", async () => {
    const store = new InMemoryVectorStore({ dimension: 1 });
    await store.add([
      { id: "1", content: "Fact 1", embedding: [1] },
      { id: "2", content: "Fact 2", embedding: [0.9] },
    ]);

    const embedder = async (): Promise<number[]> => [1];
    const retriever = new Retriever({ store, embedder, topK: 2 });
    const context = await retriever.getContext("test");

    expect(context).toContain("Fact 1");
    expect(context).toContain("Fact 2");
  });

  it("builds messages for chat", async () => {
    const store = new InMemoryVectorStore({ dimension: 1 });
    await store.add([{ id: "1", content: "Fact 1", embedding: [1] }]);

    const embedder = async (): Promise<number[]> => [1];
    const retriever = new Retriever({ store, embedder, topK: 1 });
    const messages = await retriever.buildMessages("test", "Custom system prompt");

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toBe("Custom system prompt");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("Fact 1");
  });
});

// ─── RAGPipeline ──────────────────────────────────────────────────

describe("RAGPipeline", () => {
  it("ingests and queries documents", async () => {
    const store = new InMemoryVectorStore({ dimension: 1 });
    const embedder = async (text: string): Promise<number[]> => {
      // Simple mock: return length-based embedding
      return [text.length / 100];
    };

    const pipeline = new RAGPipeline({ embedder, store, topK: 2 });

    const count = await pipeline.ingest([
      { content: "The capital of France is Paris.", id: "geography" },
      { content: "Python is a popular programming language.", id: "tech" },
    ]);

    expect(count).toBeGreaterThan(0);
    expect(pipeline.size()).toBeGreaterThan(0);

    const result = await pipeline.query("capital of France");
    expect(result.query).toBe("capital of France");
    expect(result.documents.length).toBeGreaterThan(0);
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0].role).toBe("system");
  });

  it("embeds a query only once", async () => {
    const store = new InMemoryVectorStore({ dimension: 1 });
    const embedder = vi.fn(async () => [1]);
    const pipeline = new RAGPipeline({ embedder, store, topK: 1 });
    await pipeline.ingest([{ content: "Fact", id: "1" }]);
    embedder.mockClear();

    await pipeline.query("question");

    expect(embedder).toHaveBeenCalledTimes(1);
  });

  it("clears pipeline", async () => {
    const store = new InMemoryVectorStore({ dimension: 1 });
    const embedder = async (): Promise<number[]> => [0.5];
    const pipeline = new RAGPipeline({ embedder, store });

    await pipeline.ingest([{ content: "test", id: "1" }]);
    expect(pipeline.size()).toBeGreaterThan(0);

    await pipeline.clear();
    expect(pipeline.size()).toBe(0);
  });

  it("uses custom system prompt", async () => {
    const store = new InMemoryVectorStore({ dimension: 1 });
    const embedder = async (): Promise<number[]> => [1];
    const pipeline = new RAGPipeline({
      embedder,
      store,
      systemPrompt: "You are a helpful assistant for FAQ.",
    });

    await pipeline.ingest([{ content: "test", id: "1" }]);
    const result = await pipeline.query("test");

    expect(result.messages[0].content).toBe("You are a helpful assistant for FAQ.");
  });
});
