# Framework Integrations

Signal-based hooks for React, Vue, Svelte, Solid, Qwik, Angular, and Next.js.

## React

```bash
npm install @hilbras/sdk
```

There are two React subpaths. They export the same hook names with different
transports, so pick by transport:

| Subpath | `useChat` calls | Credentials | Use when |
|---------|-----------------|-------------|----------|
| `@hilbras/sdk/react` | `fetch(api)` — your route | Stay on your server | **Default.** |
| `@hilbras/sdk/react-client` | `client.stream()` — the provider | Reach the browser | Trusted/internal apps only. |

### Route-based (recommended)

```tsx
// app/api/chat/route.ts — server
import { createChatHandler } from "@hilbras/sdk/nextjs";

export const { POST } = createChatHandler({ provider: "openai", model: "gpt-4o" });
```

```tsx
"use client";
import { useChat } from "@hilbras/sdk/react";

function Chat() {
  // `messages` is an array, `handleSubmit` takes no argument, and the input is
  // driven by `input` / `setInput` — there is no `handleInputChange`.
  const { messages, input, setInput, handleSubmit, isLoading } = useChat({
    api: "/api/chat",
  });

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>{m.role}: {m.content}</div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} />
      </form>
    </div>
  );
}
```

### Client-mode

`@hilbras/sdk/react-client` holds a `HilbrasClient` and calls the provider from
the browser. A key given to it — directly or through `HilbrasProvider`'s
`config` — is bundled into your client-side JavaScript, where anyone can read
it. Use it only where that is acceptable: an internal tool behind SSO, an
Electron app, or code running outside a browser bundle.

```tsx
"use client";
import { HilbrasProvider, useChat } from "@hilbras/sdk/react-client";

function Chat({ client }: { client: import("@hilbras/sdk").HilbrasClient }) {
  return (
    <HilbrasProvider client={client}>
      <Body />
    </HilbrasProvider>
  );
}

function Body() {
  const { messages, input, setInput, handleSubmit } = useChat({
    provider: "OpenAI",
    model: "gpt-4o",
  });
  return (
    <div>
      {messages.map((m) => <div key={m.id}>{m.role}: {m.content}</div>)}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} />
      </form>
    </div>
  );
}
```

## Vue

```bash
npm install @hilbras/sdk
```

```vue
<script setup>
import { useChat } from "@hilbras/sdk/vue";

const { messages, input, handleSubmit, isLoading } = useChat({
  api: "/api/chat",
});
</script>

<template>
  <div v-for="m in messages" :key="m.id">{{ m.role }}: {{ m.content }}</div>
  <form @submit="handleSubmit">
    <input v-model="input" />
  </form>
</template>
```

## Svelte

```bash
npm install @hilbras/sdk
```

```svelte
<script>
  import { useChat } from "@hilbras/sdk/svelte";

  const { messages, input, handleSubmit, isLoading } = useChat({
  api: "/api/chat",
});
</script>

{#each $messages as m}
  <div>{m.role}: {m.content}</div>
{/each}

<form on:submit={handleSubmit}>
  <input bind:value={$input} />
</form>
```

## Solid

```bash
npm install @hilbras/sdk
```

```tsx
import { useChat } from "@hilbras/sdk/solid";

function Chat() {
  const { messages, append, clear } = useChat();

  return (
    <div>
      {messages().map((m) => (
        <div>{m.role}: {m.content}</div>
      ))}
      <button onClick={() => append({ role: "user", content: "Hello" })}>
        Send
      </button>
    </div>
  );
}
```

## Angular

```bash
npm install @hilbras/sdk
```

Angular gets a service rather than a hook. State is exposed as signals, so read
`messages()` in a template and call `setInput()` / `submit()` imperatively.

```typescript
import { Component, inject } from "@angular/core";
import { HilbrasChatService } from "@hilbras/sdk/angular";

@Component({
  selector: "app-chat",
  template: `
    @for (m of chat.messages(); track m.id) {
      <div>{{ m.role }}: {{ m.content }}</div>
    }
    <button (click)="send()" [disabled]="chat.isLoading()">Send</button>
  `,
})
export class ChatComponent {
  protected readonly chat = inject(HilbrasChatService);

  send() {
    this.chat.setInput("Hello");
    void this.chat.submit({ api: "/api/chat" });
  }
}
```

`ChatOptions` takes `api` (your route) plus optional `provider`, `model`,
`maxSteps`, `headers` and `body`.


## Qwik

```bash
npm install @hilbras/sdk
```

```tsx
import { useChat } from "@hilbras/sdk/qwik";

export const Chat = () => {
  const { messages, append, clear } = useChat();

  return (
    <div>
      {messages().map((m) => (
        <div>{m.role}: {m.content}</div>
      ))}
      <button onClick={() => append({ role: "user", content: "Hello" })}>
        Send
      </button>
    </div>
  );
};
```

## Next.js

Everything ships inside `@hilbras/sdk`; there are no separate framework
packages to install.

```bash
npm install @hilbras/sdk
```

| Subpath | Provides |
|---------|----------|
| `@hilbras/sdk/nextjs` | `createChatHandler`, `createCompletionHandler`, `useChat`, `useCompletion` |
| `@hilbras/sdk/nextjs/api` | `createStreamHandler`, `createStreamCompletionHandler` |
| `@hilbras/sdk/nextjs/edge` | `hilbrasMiddleware` |

None of these require `next` to be installed. They are written against the Web
`Request`/`Response` types, so importing them resolves with no Next present —
Next is only needed where you wire them into a real app.

### Route Handler (Server)

```ts
// app/api/chat/route.ts
import { createStreamHandler } from "@hilbras/sdk/nextjs/api";

export const { POST } = createStreamHandler({
  provider: "openai",
  model: "gpt-4o",
  apiKey: process.env.OPENAI_API_KEY,
});
```

_(illustrative — `process` needs `@types/node` in your tsconfig)_

### Client Component

Provider credentials stay on the server. For the recommended pattern, use the
route-based hook from `@hilbras/sdk/react` — see [React](#react) above. To use
the client-mode hooks instead, pass a server-created client to
`@hilbras/sdk/react-client`; never call `addProviderFromCatalog` in a browser
component, because the key would be bundled into the client JavaScript.


## Route security

The handler factories — `createChatHandler` / `createCompletionHandler`
(`@hilbras/sdk/nextjs`), `createChatEndpoint` / `createCompletionEndpoint`
(`@hilbras/sdk/astro`), `createChatAction` / `createCompletionAction`
(`@hilbras/sdk/remix`) — expose four controls added in 3.5.0. All are optional
and default to the pre-3.5.0 behaviour.

### `onRequest` — authenticate the route

Called once per request after the body is validated and before any provider
call, so a rejected request costs nothing upstream. Throw to reject; the thrown
error is mapped by the same rules as a validation error.

```ts
import { createChatHandler } from "@hilbras/sdk/nextjs";
import { RequestValidationError } from "@hilbras/sdk";

const ALLOWED_MODELS = new Set(["gpt-4o", "gpt-4o-mini"]);

export const { POST } = createChatHandler({
  provider: "openai",
  model: "gpt-4o",
  onRequest: async ({ request, effective }) => {
    if (request.headers.get("authorization") !== `Bearer ${process.env.SESSION}`) {
      throw new RequestValidationError("Unauthorized", undefined, 401);
    }
    // `effective` is what will actually be sent — read it, not `body`,
    // when authorizing per model.
    if (!ALLOWED_MODELS.has(effective.model)) {
      throw new RequestValidationError("Model not permitted", undefined, 403);
    }
  },
  onError: (error, { phase }) => {
    // `errorResponse` withholds detail from the response body, so the
    // server-side log belongs here. `phase` is "request" or "provider".
    console.error("chat route failed", { error, phase });
  },
});
```

`onError` fires for every failure, including one rejected by `onRequest`. Without
it a provider error is invisible: the client sees `{"error":"Request failed"}`
and nothing else.

### `trustClientFields`

Whether the request body may override the factory's own `model`, `tools`,
`maxSteps`, `temperature` and `maxTokens`.

| Factory | Default | Why |
|---------|---------|-----|
| `createChatHandler`, `createCompletionHandler` | `true` | These have always read those fields from the body. |
| `createChatEndpoint`, `createChatAction` (and their completion forms) | `false` | These have never read them. |

The defaults differ because the two families had different behaviour, and a
hardening release must not widen what a caller can influence. **The Next.js
default flips to `false` in 4.0.0.**

```ts
import { createChatHandler } from "@hilbras/sdk/nextjs";

// Only the configured model is reachable; body.model, body.tools etc. are ignored.
export const { POST } = createChatHandler({
  provider: "openai",
  model: "gpt-4o",
  trustClientFields: false,
});
```

### `limits`

| Option | Default | Enforces |
|--------|---------|----------|
| `maxBodyBytes` | 1048576 (1 MiB) | Body size, in bytes — multi-byte characters counted as their encoded length. Over the limit is a 413. |
| `maxMessages` | 200 | Message count in a chat request. |
| `maxTools` | 64 | Tool count, whether the tools come from the factory or the body. |
| `maxStepsClamp` | 25 | Upper clamp on `maxSteps`. |
| `maxTokensClamp` | 32768 | Upper clamp on `maxTokens`. |
| `temperatureClamp` | `[0, 2]` | Clamp on `temperature`. |

The defaults are far above any realistic request, so leaving `limits` unset
bounds the worst case without changing what a normal call does.

```ts
import { createChatHandler } from "@hilbras/sdk/nextjs";

export const { POST } = createChatHandler({
  provider: "openai",
  model: "gpt-4o",
  limits: { maxBodyBytes: 64 * 1024, maxMessages: 40, maxStepsClamp: 5 },
});
```

### Rate limiting in Next.js

`hilbrasMiddleware` (from `@hilbras/sdk/nextjs/edge`) keys its bucket on the
client address. Set `trustProxy` to the number of reverse proxies in front of
your app, because `x-forwarded-for` is client-controllable at its left edge:

```ts
// middleware.ts — one proxy (nginx, Vercel, Cloudflare)
import { hilbrasMiddleware } from "@hilbras/sdk/nextjs/edge";

export default hilbrasMiddleware({ maxRequests: 30, trustProxy: 1 });
```

`trustProxy` defaults to `0`, which trusts no entry and falls back to a single
shared `unidentified` bucket — that under-serves anonymous callers but cannot be
defeated by omitting a header. `fallbackKey` supplies your own derivation (a
session cookie, an API key prefix) for deployments with no proxy.

The counter is in-process by default, so behind more than one instance the
effective limit is `maxRequests × instances`. Pass a `store` to share it:

```ts
import { hilbrasMiddleware, type RateLimitStore } from "@hilbras/sdk/nextjs/edge";

// A store must increment the key and return the running count plus the instant
// the window resets. Back it with whatever you already run — Redis, a KV store,
// or a database. `increment` stands in for whatever your client exposes.
declare function increment(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }>;

const store: RateLimitStore = {
  async hit(key, windowMs) {
    const { count, ttlMs } = await increment(key, windowMs);
    // A fresh key reports -1 for its TTL; fall back to the requested window.
    return { count, resetAt: Date.now() + (ttlMs >= 0 ? ttlMs : windowMs) };
  },
};

export default hilbrasMiddleware({ maxRequests: 30, trustProxy: 1, store });
```

### Deprecated: `createServerClient`

`ServerHilbrasClient` is a stub: `streamResponse` never calls a provider and
echoes your messages back. It is deprecated and removed in 4.0.0. Use
`new HilbrasClient()` directly, or a handler factory.

## Common API

All framework hooks share the same core API:

| Method | Description |
|--------|-------------|
| `messages()` | Current messages |
| `isLoading()` | Whether a request is in progress |
| `error()` | Last error (if any) |
| `append(message)` | Add a message and stream response |
| `reload()` | Re-send last message |
| `stop()` | Abort current request |
| `clear()` | Clear all messages |
