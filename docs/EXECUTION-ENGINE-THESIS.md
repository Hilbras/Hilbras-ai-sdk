# Hilbras SDK — AI Execution Engine Thesis

## The Problem

If a developer uses only one provider (e.g. OpenAI), why should they use Hilbras?

Answer: **Hilbras should optimize, control, validate, observe, and make the execution more reliable.**

## Value for Single-Provider Users

| Capability | What Hilbras Does |
|---|---|
| **Context Optimization** | Analyze 50K tokens → 18K tokens, retain 97% info |
| **Automatic Prompt Caching** | Detect static vs dynamic content, cache automatically |
| **Smart Token & Cost Control** | Estimate cost before execution, enforce `maxCost` policy |
| **Automatic Failure Recovery** | Retry, backoff, context overflow handling |
| **Structured Output Recovery** | Validate schema → repair/retry on invalid output |
| **Universal Tool Execution** | Timeouts, retries, validation, cancellation for tool calls |
| **Request-Level Caching** | Cache identical requests, skip redundant provider calls |
| **Concurrency & Rate Management** | Queue, backpressure, priorities, controlled execution |
| **Request Deduplication** | 4 identical requests → 1 provider call → shared result |
| **Execution Policies** | `"production"`, `{ reliability: "maximum", cost: "low" }` |
| **Vendor-Neutral Observability** | Latency, tokens, cost, cache hits, retries, tool calls |

## Value for Multi-Provider Users (Additional)

All of the above **plus**:

- Provider Abstraction
- Model Registry & Intelligence
- Model Routing
- Provider Failover & Fallback
- Cost-based Model Selection
- Capability-based Selection

## Positioning

```
OpenAI SDK:      "Here's a clean way to call OpenAI."
Vercel AI SDK:   "Here's a clean way to build AI apps across providers."
Hilbras SDK:     "Give us your AI task and execution policy.
                  We'll make the execution reliable, efficient,
                  optimized, and observable."
```

## Core Thesis

> Multi-provider support becomes an additional advantage, not the entire reason Hilbras exists.
