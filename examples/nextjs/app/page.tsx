"use client";

import { useState, useRef, useEffect } from "react";

export default function Home() {
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState("");
  const [analyzeText, setAnalyzeText] = useState("");
  const [analysisResult, setAnalysisResult] = useState<Record<string, unknown> | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || loading) return;

    const userMsg = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...messages, userMsg] }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMsg = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        assistantMsg += text;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assistantMsg };
          return updated;
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAnalyze() {
    if (!analyzeText.trim()) return;
    setAnalysis("Loading...");
    setAnalysisResult(null);

    try {
      const res = await fetch("/api/structured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: analyzeText }),
      });
      const data = await res.json();
      setAnalysisResult(data);
      setAnalysis("");
    } catch (err) {
      setAnalysis(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1>@hilbras/sdk — Next.js Example</h1>

      {/* Streaming Chat */}
      <section style={{ marginBottom: 48 }}>
        <h2>Streaming Chat</h2>
        <div style={{ border: "1px solid #ccc", borderRadius: 8, padding: 16, height: 400, overflowY: "auto", marginBottom: 12 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <strong>{m.role === "user" ? "You" : "Assistant"}:</strong>
              <pre style={{ whiteSpace: "pre-wrap", margin: 4 }}>{m.content}</pre>
            </div>
          ))}
          <div ref={messagesEnd} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Type a message..."
            style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid #ccc" }}
            disabled={loading}
          />
          <button onClick={handleSend} disabled={loading} style={{ padding: "8px 16px" }}>
            {loading ? "Sending..." : "Send"}
          </button>
        </div>
      </section>

      {/* Structured Output */}
      <section>
        <h2>Structured Output (Zod Schema)</h2>
        <textarea
          value={analyzeText}
          onChange={(e) => setAnalyzeText(e.target.value)}
          placeholder="Paste text to analyze..."
          rows={4}
          style={{ width: "100%", padding: 8, borderRadius: 4, border: "1px solid #ccc", marginBottom: 12 }}
        />
        <button onClick={handleAnalyze} style={{ padding: "8px 16px", marginBottom: 12 }}>
          Analyze
        </button>
        {analysis && <p>{analysis}</p>}
        {analysisResult && (
          <pre style={{ background: "#f5f5f5", padding: 16, borderRadius: 4, overflowX: "auto" }}>
            {JSON.stringify(analysisResult, null, 2)}
          </pre>
        )}
      </section>
    </main>
  );
}
