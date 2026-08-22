# Migration Guide: v0.1.0 → v0.2.0

This guide covers everything that changed between v0.1.0 and v0.2.0.

## Breaking Changes

**None.** v0.2.0 is fully backward compatible with v0.1.0. All existing code will continue to work.

## New Features You Can Adopt

### 1. `complete()` Now Works with All Providers

Before: `client.complete()` only worked with OpenAI-compatible providers.

After: All 6 adapters (OpenAI, Anthropic, Google GenAI, Azure, Groq, Ollama) support non-streaming completion.

```typescript
// This used to crash for non-OpenAI providers — now it works everywhere
const reply = await client.complete({
  provider: "Anthropic",
  model: "claude-sonnet-4-20250514",
  messages: [{ role: "user", content: "Hello" }],
});
```

### 2. `AdapterName` Type Updated

If you were using the `AdapterName` type in your code, you can now use `"azure"`, `"groq"`, and `"ollama"` as values:

```typescript
// Before: TypeScript error for "azure", "groq", "ollama"
const adapter: AdapterName = "azure";  // ✅ Now valid

// If you had a type guard or switch statement, add the new cases:
switch (adapter) {
  case "openai": /* ... */ break;
  case "anthropic": /* ... */ break;
  case "google-genai": /* ... */ break;
  case "azure": /* ... */ break;    // NEW
  case "groq": /* ... */ break;     // NEW
  case "ollama": /* ... */ break;   // NEW
}
```

### 3. Timeout Enforcement

If your provider has a `timeout` config, requests now automatically timeout:

```typescript
client.addProvider({
  name: "OpenAI",
  timeout: 30_000,  // 30s timeout — was ignored before, now enforced
  // ...
});
```

### 4. Model Catalog Expanded

New models available for `findModel()`:

```typescript
import { findModel } from "@hilbras/sdk";

findModel("gpt-4.1");           // NEW
findModel("o3");                // NEW
findModel("o4-mini");           // NEW
findModel("claude-opus-4");     // NEW
findModel("gemini-2.5-pro");    // NEW
findModel("llama-4-maverick");  // NEW
```

### 5. Subpath Imports

You can now import specific modules for smaller bundles:

```typescript
// Before (still works)
import { estimateTokens } from "@hilbras/sdk";

// After (tree-shakeable)
import { estimateTokens } from "@hilbras/sdk/tokens";
```

### 6. `WebSocketTransport` Safety

If you were getting cryptic `WebSocket is not defined` errors on Node 18–21, you'll now get a clear error message explaining how to fix it.

## What Changed Under the Hood

- `require("node:fs")` → ESM `import` in config loader
- `process.cwd()` guarded for non-Node environments
- `Transport.body` type narrowed from `string | Uint8Array` to `string`
- TypeScript `lib` updated to include DOM types for web API compatibility

## Upgrading

```bash
npm install @hilbras/sdk@0.2.0
```

No code changes required. All v0.1.0 code works unchanged.
