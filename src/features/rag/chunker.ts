/**
 * @hilbras/rag — Text Chunker
 *
 * Splits documents into chunks for embedding and retrieval.
 * Supports multiple chunking strategies.
 */

export interface ChunkOptions {
  /** Maximum chunk size in characters (default: 1000) */
  maxChunkSize?: number;
  /** Overlap between chunks in characters (default: 200) */
  overlap?: number;
  /** Chunking strategy */
  strategy?: "fixed" | "sentence" | "recursive";
  /** Separators for recursive chunking */
  separators?: string[];
}

export interface TextChunk {
  /** Chunk content */
  content: string;
  /** Source document index */
  sourceIndex: number;
  /** Chunk index within the source */
  chunkIndex: number;
  /** Character offset in original document */
  offset: number;
}

const DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", "! ", "? ", "; ", ", ", " ", ""];

function splitByFixed(text: string, maxChunkSize: number, overlap: number): TextChunk[] {
  const chunks: TextChunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < text.length) {
    const end = Math.min(start + maxChunkSize, text.length);
    chunks.push({
      content: text.slice(start, end),
      sourceIndex: 0,
      chunkIndex,
      offset: start,
    });
    start += maxChunkSize - overlap;
    chunkIndex++;
  }

  return chunks;
}

function splitRecursive(
  text: string,
  separators: string[],
  maxChunkSize: number,
): TextChunk[] {
  if (text.length <= maxChunkSize) {
    return [{ content: text, sourceIndex: 0, chunkIndex: 0, offset: 0 }];
  }

  for (let i = 0; i < separators.length; i++) {
    const sep = separators[i];
    if (text.includes(sep)) {
      const parts = text.split(sep);
      const chunks: TextChunk[] = [];
      let current = "";
      let chunkIndex = 0;
      let offset = 0;

      for (const part of parts) {
        const candidate = current ? current + sep + part : part;
        if (candidate.length > maxChunkSize && current) {
          chunks.push({ content: current, sourceIndex: 0, chunkIndex, offset });
          chunkIndex++;
          offset += current.length + sep.length;
          current = part;
        } else {
          current = candidate;
        }
      }

      if (current) {
        chunks.push({ content: current, sourceIndex: 0, chunkIndex, offset });
      }

      // If any chunk is still too large, recurse with remaining separators
      const remaining = separators.slice(i + 1);
      if (remaining.length > 0 && chunks.some((c) => c.content.length > maxChunkSize)) {
        const finalChunks: TextChunk[] = [];
        let globalIndex = 0;
        for (const chunk of chunks) {
          if (chunk.content.length > maxChunkSize) {
            const subChunks = splitRecursive(chunk.content, remaining, maxChunkSize);
            for (const sc of subChunks) {
              finalChunks.push({ ...sc, sourceIndex: 0, chunkIndex: globalIndex++, offset: chunk.offset + sc.offset });
            }
          } else {
            finalChunks.push({ ...chunk, chunkIndex: globalIndex++ });
          }
        }
        return finalChunks;
      }

      return chunks;
    }
  }

  // No separator found, force split
  return splitByFixed(text, maxChunkSize, 0);
}

/**
 * Split text into chunks.
 */
export function chunkText(text: string, options?: ChunkOptions): TextChunk[] {
  const maxChunkSize = options?.maxChunkSize ?? 1000;
  const overlap = options?.overlap ?? 200;
  if (!Number.isInteger(maxChunkSize) || maxChunkSize <= 0) {
    throw new RangeError("maxChunkSize must be a positive integer");
  }
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= maxChunkSize) {
    throw new RangeError("overlap must be a non-negative integer smaller than maxChunkSize");
  }
  const strategy = options?.strategy ?? "recursive";
  const separators = options?.separators ?? DEFAULT_SEPARATORS;

  switch (strategy) {
    case "fixed":
      return splitByFixed(text, maxChunkSize, overlap);
    case "sentence": {
      const sentenceSeps = [". ", "! ", "? ", "\n"];
      return splitRecursive(text, sentenceSeps, maxChunkSize);
    }
    case "recursive":
    default:
      return splitRecursive(text, separators, maxChunkSize);
  }
}

/**
 * Chunk multiple documents.
 */
export function chunkDocuments(
  documents: Array<{ content: string; id?: string; metadata?: Record<string, unknown> }>,
  options?: ChunkOptions,
): Array<TextChunk & { documentId: string; metadata?: Record<string, unknown> }> {
  const results: Array<TextChunk & { documentId: string; metadata?: Record<string, unknown> }> = [];

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const chunks = chunkText(doc.content, options);
    for (const chunk of chunks) {
      results.push({
        ...chunk,
        sourceIndex: i,
        documentId: doc.id ?? `doc_${i}`,
        metadata: doc.metadata,
      });
    }
  }

  return results;
}
