# Hilbras SDK: Beat Vercel AI SDK — Complete Roadmap

**Goal:** Make `@hilbras/sdk` the best LLM SDK in TypeScript — not just as an execution engine, but as a complete AI framework with UI components, framework integrations, and ecosystem.

**Timeline:** 8 weeks (v2.0.0 → v3.0.0)

---

## Current State (v1.5.0)

### Hilbras Wins
- Zero runtime dependencies
- 23 provider adapters
- Cost enforcement with atomic budget reservation
- Circuit breaker per provider
- SSRF protection, prompt injection detection, rate limiting
- DevTools dashboard
- Actionable error messages with hints
- Structured output with auto-repair

### Vercel Wins
- Deep Next.js/React/Svelte integration
- `<Chat>`, `<Completion>` UI components
- `useChat()`, `useCompletion()` hooks
- Huge ecosystem and adoption
- Extensive documentation

---

## Phase 1: UI Layer (v2.0.0) — Weeks 1-2

### 1.1 React Hooks (`@hilbras/react`)

```tsx
import { useChat, useCompletion, useCost } from "@hilbras/react";

function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    provider: "openai",
    model: "gpt-4o",
  });

  return (
    <div>
      {messages.map(m => <div key={m.id}>{m.content}</div>)}
      <input value={input} onChange={handleInputChange} />
      <button onClick={handleSubmit} disabled={isLoading}>Send</button>
    </div>
  );
}
```

**Files:**
- `packages/react/src/useChat.ts` — streaming chat hook
- `packages/react/src/useCompletion.ts` — text completion hook
- `packages/react/src/useCost.ts` — real-time cost tracking hook
- `packages/react/src/useStructuredOutput.ts` — structured output hook
- `packages/react/src/provider.tsx` — context provider for shared client
- `packages/react/src/index.ts` — barrel exports

**Features:**
- Optimistic UI updates
- Abort/cancel support
- Error state with actionable messages
- Loading/streaming states
- Token count and cost display
- Automatic retry on failure

### 1.2 Vue Composables (`@hilbras/vue`)

```vue
<script setup>
import { useChat } from "@hilbras/vue";

const { messages, input, sendMessage, isLoading } = useChat({
  provider: "openai",
  model: "gpt-4o",
});
</script>
```

**Files:**
- `packages/vue/src/useChat.ts`
- `packages/vue/src/useCompletion.ts`
- `packages/vue/src/plugin.ts`

### 1.3 Svelte Store (`@hilbras/svelte`)

```svelte
<script>
  import { createChatStore } from "@hilbras/svelte";
  const chat = createChatStore({ provider: "openai", model: "gpt-4o" });
</script>

<input bind:value={$chat.input} on:keydown={(e) => e.key === "Enter" && $chat.send()} />
```

### 1.4 SolidJS (`@hilbras/solid`)

- `createChat()` signal
- `createCompletion()` signal

### 1.5 vanilla JS (`@hilbras/vanilla`)

- Framework-agnostic DOM utilities
- `createChatElement(container, options)` — drop-in chat widget

---

## Phase 2: UI Components (v2.1.0) — Weeks 3-4

### 2.1 Headless Components (framework-agnostic)

```tsx
import { ChatBox, MessageList, Input, CostBadge } from "@hilbras/ui";

<ChatBox provider="openai" model="gpt-4o">
  <MessageList />
  <Input placeholder="Ask anything..." />
  <CostBadge />
</ChatBox>
```

**Components:**
- `<ChatBox>` — container with provider/model config
- `<MessageList>` — renders messages with streaming animation
- `<Input>` — auto-resizing textarea with send button
- `<CostBadge>` — real-time cost/token display
- `<ModelSelector>` — dropdown for model selection
- `<ErrorBanner>` — actionable error display
- `<ThinkingIndicator>` — loading/thinking animation
- `<ToolCallCard>` — expandable tool call display

### 2.2 Styled Variants

- `@hilbras/ui/tailwind` — Tailwind CSS styled components
- `@hilbras/ui/shadcn` — shadcn/ui compatible components
- `@hilbras/ui/chakra` — Chakra UI styled components
- `@hilbras/ui/unstyled` — unstyled/headless only

---

## Phase 3: Framework Deep Integration (v2.2.0) — Weeks 5-6

### 3.1 Next.js Plugin (`@hilbras/next`)

```ts
// next.config.js
const { withHilbras } = require("@hilbras/next");

module.exports = withHilbras({
  // Auto-configures API routes, streaming, edge runtime
});
```

**Features:**
- Auto-generate API routes from schema definitions
- Built-in streaming response helpers
- Edge runtime support
- ISR/SSG integration for AI-generated pages
- Middleware for rate limiting and auth

### 3.2 Remix Adapter (`@hilbras/remix`)

```ts
// app/routes/chat.tsx
import { hilbrasAction } from "@hilbras/remix";

export const action = hilbrasAction({
  provider: "openai",
  model: "gpt-4o",
});
```

### 3.3 Astro Integration (`@hilbras/astro`)

```astro
---
import { HilbrasChat } from "@hilbras/astro";
---

<HilbrasChat provider="openai" model="gpt-4o" />
```

### 3.4 Nuxt Module (`@hilbras/nuxt`)

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@hilbras/nuxt"],
});
```

---

## Phase 4: AI Features (v2.3.0) — Week 7

### 4.1 Agent Framework

```ts
import { Agent, tool } from "@hilbras/sdk";

const agent = new Agent({
  model: "gpt-4o",
  tools: [
    tool("search", "Search the web", async (query) => { ... }),
    tool("calculate", "Calculate math", async (expr) => { ... }),
  ],
  maxSteps: 10,
});

const result = await agent.run("What's the weather in Tokyo?");
```

### 4.2 Multi-Modal Pipeline

```ts
import { Pipeline } from "@hilbras/sdk";

const pipeline = new Pipeline()
  .classify(input)           // Step 1: Classify intent
  .route({                   // Step 2: Route to model
    coding: "gpt-4o",
    writing: "claude-sonnet",
    analysis: "gemini-pro",
  })
  .validate(schema)          // Step 3: Validate output
  .repair(maxAttempts: 3);   // Step 4: Auto-repair

const result = await pipeline.run(userInput);
```

### 4.3 Memory / Context Window

```ts
import { Memory } from "@hilbras/sdk";

const memory = new Memory({ maxTokens: 8000 });

// Automatic context management
memory.add("User prefers dark mode");
memory.add("User is building a SaaS app");

const messages = memory.buildContext([
  { role: "user", content: "Help me style my buttons" },
]);
// memory automatically includes relevant past context
```

### 4.4 Evaluation Framework

```ts
import { Eval } from "@hilbras/sdk";

const eval = new Eval({
  dataset: [
    { input: "What is 2+2?", expected: "4" },
    { input: "Capital of France?", expected: "Paris" },
  ],
  metrics: ["accuracy", "latency", "cost"],
});

const report = await eval.run(client, { model: "gpt-4o" });
// { accuracy: 0.95, avgLatency: 230, avgCost: 0.0012 }
```

---

## Phase 5: Ecosystem & DX (v2.4.0) — Week 8

### 5.1 CLI Tool (`hilbras`)

```bash
# Interactive playground
hilbras chat --provider openai --model gpt-4o

# Benchmark providers
hilbras bench --prompt "Hello world" --providers openai,anthropic,groq

# Test structured output
hilbras test schema.json --input "test data"

# Generate provider config
hilbras init

# View cost report
hilbras costs --session

# View DevTools dashboard
hilbras dashboard
```

### 5.2 VS Code Extension

- Inline cost estimation as you type prompts
- Provider health status in status bar
- Streaming preview in webview
- Structured output schema editor
- One-click provider switching

### 5.3 Documentation Site

- Interactive playground (runs in browser)
- API reference (auto-generated from TypeScript)
- Migration guides (Vercel AI SDK, LangChain, LlamaIndex)
- Provider comparison table
- Cost calculator
- Video tutorials

### 5.4 Template Marketplace

```bash
hilbras create chat-app --template nextjs-shadcn
hilbras create api-server --template hono-edge
hilbras create discord-bot --template discord.js
hilbras create slack-bot --template bolt-js
```

---

## Phase 6: Production Features (v3.0.0) — Beyond

### 6.1 Observability Platform

- Cloud-hosted dashboard (optional)
- Distributed tracing across services
- Cost analytics and budget alerts
- Provider performance comparison
- A/B testing for prompts

### 6.2 Enterprise Features

- SSO/SAML authentication
- Audit logging
- Role-based access control
- SLA monitoring
- Private model hosting integration

### 6.3 Plugin System

```ts
import { Plugin } from "@hilbras/sdk";

const customPlugin: Plugin = {
  name: "custom-logger",
  onRequest: (ctx) => { /* log request */ },
  onResponse: (ctx) => { /* log response */ },
  onError: (ctx) => { /* log error */ },
};

client.use(customPlugin);
```

---

## Package Structure (v2.0.0+)

```
@hilbras/sdk              — Core engine (zero deps)
@hilbras/react            — React hooks + components
@hilbras/vue              — Vue composables
@hilbras/svelte           — Svelte stores
@hilbras/solid            — SolidJS signals
@hilbras/vanilla          — Framework-agnostic DOM
@hilbras/ui               — Headless UI components
@hilbras/ui/tailwind      — Tailwind styled
@hilbras/ui/shadcn        — shadcn styled
@hilbras/next             — Next.js integration
@hilbras/remix            — Remix integration
@hilbras/astro            — Astro integration
@hilbras/nuxt             — Nuxt integration
hilbras                   — CLI tool
create-hilbras-app        — Project scaffolding
```

---

## Success Metrics

| Metric | v1.5.0 (now) | v2.0.0 target | v3.0.0 target |
|---|---|---|---|
| npm weekly downloads | ~0 | 1,000 | 10,000 |
| GitHub stars | ~0 | 100 | 1,000 |
| Provider adapters | 23 | 23 | 30 |
| Framework integrations | 0 | 4 | 8 |
| UI components | 0 | 10 | 20 |
| Tests | 1,541 | 2,000 | 3,000 |
| Bundle size (core) | 175KB | 150KB | 120KB |
| Documentation pages | 1 | 50 | 200 |

---

## Priority Order

1. **React hooks** (biggest impact — most LLM apps use React)
2. **UI components** (catches up to Vercel's component library)
3. **Next.js plugin** (largest framework market share)
4. **Agent framework** (differentiator — Vercel doesn't have this)
5. **CLI tool** (developer experience)
6. **Documentation site** (adoption)

---

## What Makes Hilbras Better Than Vercel (by v3.0.0)

| Category | Hilbras v3.0 | Vercel AI SDK |
|---|---|---|
| **Execution** | Cost enforcement, circuit breaker, SSRF, prompt injection | Basic |
| **Security** | Full suite (injection, SSRF, rate limiting, redaction) | Minimal |
| **Providers** | 30+ adapters, zero deps | ~15 with separate packages |
| **UI** | Headless + styled (Tailwind, shadcn, Chakra) | React-only |
| **Frameworks** | Next.js, Remix, Astro, Nuxt, SvelteKit | Next.js only |
| **Agents** | Built-in agent framework with tools | None |
| **Memory** | Automatic context management | None |
| **Evaluation** | Built-in eval framework | None |
| **CLI** | Interactive playground, benchmarks, init | None |
| **Observability** | DevTools dashboard, OTel, cost analytics | Basic telemetry |
| **Cost Control** | Atomic budget reservation, per-request limits | None |
| **Error Messages** | Actionable with hints, retry-after, alternatives | Generic |

---

*The path: Hilbras becomes the "infrastructure layer" that Vercel AI SDK users didn't know they needed — then adds the UI layer to make it complete.*
