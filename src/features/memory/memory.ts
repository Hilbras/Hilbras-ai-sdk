export interface MemoryEntry {
  id: string;
  content: string;
  role: "user" | "assistant" | "system" | "tool";
  timestamp: number;
  tokens: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryOptions {
  maxTokens: number;
  strategy?: "sliding" | "priority" | "hybrid";
  systemPrompt?: string;
  tokenEstimator?: (text: string) => number;
  onEvict?: (entry: MemoryEntry) => void;
  priorityFn?: (entry: MemoryEntry) => number;
}

export interface MemoryStats {
  tokens: number;
  entryCount: number;
  maxTokens: number;
  evicted: number;
  utilization: number;
}

function defaultTokenEstimator(text: string): number {
  return Math.ceil(text.length / 4);
}

export class Memory {
  private entries: MemoryEntry[] = [];
  private _systemPromptTokens = 0;
  private _evicted = 0;
  private readonly opts: Required<MemoryOptions>;

  constructor(options: MemoryOptions) {
    this.opts = {
      maxTokens: options.maxTokens,
      strategy: options.strategy ?? "sliding",
      systemPrompt: options.systemPrompt ?? "",
      tokenEstimator: options.tokenEstimator ?? defaultTokenEstimator,
      onEvict: options.onEvict ?? (() => {}),
      priorityFn: options.priorityFn ?? (() => 0),
    };
    if (this.opts.systemPrompt) {
      this._systemPromptTokens = this.opts.tokenEstimator(this.opts.systemPrompt);
    }
  }

  add(content: string, role: MemoryEntry["role"] = "user", metadata?: Record<string, unknown>): MemoryEntry {
    const entry: MemoryEntry = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content,
      role,
      timestamp: Date.now(),
      tokens: this.opts.tokenEstimator(content),
      metadata,
    };
    this.entries.push(entry);
    this.evict();
    return entry;
  }

  addEntry(entry: Omit<MemoryEntry, "id">): MemoryEntry {
    const full: MemoryEntry = {
      ...entry,
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
    this.entries.push(full);
    this.evict();
    return full;
  }

  buildContext(additionalMessages: Array<{ role: string; content: string }> = []): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];
    let totalTokens = 0;

    if (this.opts.systemPrompt) {
      messages.push({ role: "system", content: this.opts.systemPrompt });
      totalTokens += this._systemPromptTokens;
    }

    const reversed = [...this.entries].reverse();
    const memoryMessages: Array<{ role: string; content: string }> = [];
    for (const entry of reversed) {
      if (totalTokens + entry.tokens > this.opts.maxTokens) break;
      memoryMessages.unshift({ role: entry.role, content: entry.content });
      totalTokens += entry.tokens;
    }
    messages.push(...memoryMessages);

    for (const msg of additionalMessages) {
      const tokens = this.opts.tokenEstimator(msg.content);
      if (totalTokens + tokens <= this.opts.maxTokens) {
        messages.push(msg);
        totalTokens += tokens;
      }
    }

    return messages;
  }

  getEntries(): MemoryEntry[] {
    return [...this.entries];
  }

  getStats(): MemoryStats {
    const tokens = this.entries.reduce((sum, e) => sum + e.tokens, 0);
    return {
      tokens,
      entryCount: this.entries.length,
      maxTokens: this.opts.maxTokens,
      evicted: this._evicted,
      utilization: Math.min(100, (tokens / this.opts.maxTokens) * 100),
    };
  }

  clear(): void {
    this.entries = [];
  }

  remove(id: string): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx >= 0) {
      this.entries.splice(idx, 1);
      return true;
    }
    return false;
  }

  search(query: string): MemoryEntry[] {
    const lower = query.toLowerCase();
    return this.entries.filter((e) => e.content.toLowerCase().includes(lower));
  }

  private evict(): void {
    const available = this.opts.maxTokens - this._systemPromptTokens;
    let currentTokens = this.entries.reduce((sum, e) => sum + e.tokens, 0);
    if (currentTokens <= available) return;

    switch (this.opts.strategy) {
      case "sliding":
        while (currentTokens > available && this.entries.length > 0) {
          const removed = this.entries.shift()!;
          currentTokens -= removed.tokens;
          this._evicted++;
          this.opts.onEvict(removed);
        }
        break;
      case "priority": {
        while (currentTokens > available && this.entries.length > 0) {
          let minIdx = 0;
          let minPriority = Infinity;
          for (let i = 0; i < this.entries.length; i++) {
            const p = this.opts.priorityFn(this.entries[i]);
            if (p < minPriority) { minPriority = p; minIdx = i; }
          }
          const removed = this.entries.splice(minIdx, 1)[0];
          currentTokens -= removed.tokens;
          this._evicted++;
          this.opts.onEvict(removed);
        }
        break;
      }
      case "hybrid": {
        while (currentTokens > available && this.entries.length > 0) {
          let minIdx = 0;
          let minScore = Infinity;
          for (let i = 0; i < this.entries.length; i++) {
            const age = (Date.now() - this.entries[i].timestamp) / 1000;
            const priority = this.opts.priorityFn(this.entries[i]);
            const score = priority - age / 3600;
            if (score < minScore) { minScore = score; minIdx = i; }
          }
          const removed = this.entries.splice(minIdx, 1)[0];
          currentTokens -= removed.tokens;
          this._evicted++;
          this.opts.onEvict(removed);
        }
        break;
      }
    }
  }
}
