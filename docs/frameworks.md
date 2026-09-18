# Framework Integrations

Signal-based hooks for React, Vue, Svelte, Solid, and Angular.

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
npm install @hilbras/vue
```

```vue
<script setup>
import { useChat } from "@hilbras/vue";

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
npm install @hilbras/svelte
```

```svelte
<script>
  import { useChat } from "@hilbras/svelte";

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
npm install @hilbras/solid
```

```tsx
import { useChat } from "@hilbras/solid";

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
npm install @hilbras/angular
```

```typescript
import { Component } from "@angular/core";
import { ChatService } from "@hilbras/angular";

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
