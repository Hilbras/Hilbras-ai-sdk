# Framework Integrations

Signal-based hooks for React, Vue, Svelte, Solid, Qwik, Angular, and Next.js.

## React

```bash
npm install @hilbras/react
```

```tsx
import { useChat } from "@hilbras/react";

function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: "/api/chat",
  });

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>{m.role}: {m.content}</div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
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
import { useChat } from "@hilbras/sdk";

const { messages, input, handleSubmit, isLoading } = useChat();
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
  import { useChat } from "@hilbras/sdk";

  const { messages, input, handleSubmit, isLoading } = useChat();
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
import { useChat } from "@hilbras/sdk";

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

```typescript
import { Component } from "@angular/core";
import { useChat } from "@hilbras/sdk";

@Component({
  selector: "app-chat",
  template: `
    @for (m of chatService.messages(); track m.id) {
      <div>{{ m.role }}: {{ m.content }}</div>
    }
    <button (click)="send()">Send</button>
  `,
})
export class ChatComponent {
  constructor(public chatService: ChatService) {}

  send() {
    this.chatService.append({ role: "user", content: "Hello" });
  }
}
```

## Qwik

```bash
npm install @hilbras/sdk
```

```tsx
import { useChat } from "@hilbras/sdk";

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

```bash
npm install @hilbras/next @hilbras/react @hilbras/sdk
```

### Route Handler (Server)

```ts
// app/api/chat/route.ts
import { createStreamHandler } from "@hilbras/next";

export const { POST } = createStreamHandler({
  provider: "openai",
  model: "gpt-4o",
  apiKey: process.env.OPENAI_API_KEY,
});
```

### Client Component

Provider credentials stay on the server. Pass a server-created client to
`@hilbras/react`; do not call `addProviderFromCatalog` in a browser component.

```tsx
"use client";
import { HilbrasProvider, useChat } from "@hilbras/react";

export function Chat({ client }: { client: import("@hilbras/sdk").HilbrasClient }) {
  return (
    <HilbrasProvider client={client}>
      <ChatBody />
    </HilbrasProvider>
  );
}

function ChatBody() {
  const { messages, input, setInput, handleSubmit } = useChat({
    provider: "OpenAI",
    model: "gpt-4o",
  });
  return (
    <div>
      {messages.map((m) => <div key={m.id}>{m.role}: {m.content}</div>)}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={(event) => setInput(event.target.value)} />
      </form>
    </div>
  );
}
```

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
