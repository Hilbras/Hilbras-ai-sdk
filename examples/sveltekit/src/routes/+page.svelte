<script lang="ts">
  let messages = $state<Array<{ role: string; content: string }>>([]);
  let input = $state("");
  let loading = $state(false);
  let analyzeText = $state("");
  let analysisResult = $state<Record<string, unknown> | null>(null);

  async function handleSend() {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input };
    messages = [...messages, userMsg];
    input = "";
    loading = true;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMsg = "";
      messages = [...messages, { role: "assistant", content: "" }];

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantMsg += decoder.decode(value, { stream: true });
        messages = [...messages.slice(0, -1), { role: "assistant", content: assistantMsg }];
      }
    } catch (err) {
      console.error(err);
    } finally {
      loading = false;
    }
  }

  async function handleAnalyze() {
    if (!analyzeText.trim()) return;
    analysisResult = null;

    try {
      const res = await fetch("/api/structured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: analyzeText }),
      });
      analysisResult = await res.json();
    } catch (err) {
      analysisResult = { error: err instanceof Error ? err.message : String(err) };
    }
  }
</script>

<main style="max-width: 800px; margin: 0 auto; padding: 24px; font-family: system-ui;">
  <h1>@hilbras/sdk SvelteKit Example</h1>

  <section style="margin-bottom: 48px;">
    <h2>Streaming Chat</h2>
    <div style="border: 1px solid #ccc; border-radius: 8px; padding: 16px; height: 400px; overflow-y: auto; margin-bottom: 12px;">
      {#each messages as m}
        <div style="margin-bottom: 8px;">
          <strong>{m.role === "user" ? "You" : "Assistant"}:</strong>
          <pre style="white-space: pre-wrap; margin: 4px;">{m.content}</pre>
        </div>
      {/each}
    </div>
    <div style="display: flex; gap: 8px;">
      <input
        bind:value={input}
        onkeydown={(e) => e.key === "Enter" && handleSend()}
        placeholder="Type a message..."
        style="flex: 1; padding: 8px; border-radius: 4px; border: 1px solid #ccc;"
        disabled={loading}
      />
      <button onclick={handleSend} disabled={loading} style="padding: 8px 16px;">
        {loading ? "Sending..." : "Send"}
      </button>
    </div>
  </section>

  <section>
    <h2>Structured Output</h2>
    <textarea
      bind:value={analyzeText}
      placeholder="Paste text to analyze..."
      rows="4"
      style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid #ccc; margin-bottom: 12px;"
    ></textarea>
    <button onclick={handleAnalyze} style="padding: 8px 16px; margin-bottom: 12px;">Analyze</button>
    {#if analysisResult}
      <pre style="background: #f5f5f5; padding: 16px; border-radius: 4px; overflow-x: auto;">{JSON.stringify(analysisResult, null, 2)}</pre>
    {/if}
  </section>
</main>
