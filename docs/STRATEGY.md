# Hilbras AI SDK — Strategic Architecture & Product Direction

## 1. Current Assessment

The current `@hilbras/sdk` foundation is strong.

**Current rating: 8/10 as a foundation, with the potential to reach 9+/10 as an independent product.**

The repository already has a solid production-oriented foundation:

* TypeScript
* MIT license
* Provider-agnostic architecture
* Zero runtime dependencies
* Node.js / Bun / Deno / Browser support
* Streaming
* Tool calling
* Reasoning normalization
* Retry and exponential backoff
* Circuit breaker
* Middleware
* Token counting
* Cost estimation
* Prompt caching
* Graceful degradation
* Typed errors
* Model catalog
* Subpath imports
* Test coverage

The repository currently documents **97 passing tests** across 11 test files and supports six providers/adapters: OpenAI, Anthropic, Google Gemini, Azure OpenAI, Groq, and Ollama.

The architecture is also already well separated:

```text
@hilbras/sdk
├── client/
├── adapters/
├── transport/
├── reliability/
├── middleware/
├── tokens/
├── config/
├── credentials/
├── reasoning/
├── errors/
├── logging/
├── types/
└── catalog/
```

This is a very good foundation for an independent SDK.

---

# 2. The Core Strategic Decision

The biggest recommendation is:

> **Do not build Hilbras SDK as another generic LLM SDK.**

The goal should not be to simply create:

```text
OpenAI abstraction
+
Anthropic abstraction
+
Gemini abstraction
+
More providers
```

That market is already crowded.

Instead, Hilbras SDK should become:

> **The provider-neutral AI infrastructure layer for building reliable, intelligent, cost-efficient AI applications.**

The SDK should abstract not only provider APIs, but also the complexity of **model selection, reliability, cost, capabilities, execution policies, and provider differences.**

---

# 3. What Hilbras SDK Should Be

The ideal architecture should look like this:

```text
Application
     │
     ▼
┌─────────────────────────────────────────┐
│             @hilbras/sdk                │
│                                         │
│ Provider Abstraction                    │
│ Model Intelligence                      │
│ Model Registry                          │
│ Routing                                 │
│ Reliability                             │
│ Cost Optimization                       │
│ Structured Outputs                      │
│ Streaming                               │
│ Tool Protocol                           │
│ Observability                           │
│ Execution Policies                      │
└────────────────────┬────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
     OpenAI      Anthropic      Gemini
        │            │            │
      Groq         Ollama       Custom
        │
     Any Provider
```

The application should not need to understand provider-specific behavior.

---

# 4. Universal Provider Contract

The provider architecture should become one of the strongest parts of the SDK.

Instead of making adapters simple API converters, define a strong universal provider contract.

Example:

```ts
interface AIProvider {
  id: string;

  models(): Promise<ModelDefinition[]>;

  generate(request: GenerateRequest): Promise<AIResponse>;

  stream(request: GenerateRequest): AsyncIterable<StreamEvent>;

  capabilities(model: string): ModelCapabilities;
}
```

The objective is:

```text
Any Provider
      ↓
Universal Contract
      ↓
Hilbras SDK
```

A provider should be replaceable without forcing application code to change.

Adding a new provider should feel like installing a plugin rather than modifying the SDK core.

---

# 5. Model Intelligence

This should become one of the major differentiators of Hilbras SDK.

Instead of requiring developers to always specify a concrete model:

```ts
model: "gpt-4.1"
```

developers should eventually be able to describe what they need:

```ts
model: {
  capability: "reasoning",
  budget: "low",
  latency: "fast"
}
```

Or:

```ts
model: {
  task: "coding",
  quality: "high",
  maxCost: 0.05
}
```

The SDK can then evaluate available models based on:

* capabilities
* context window
* tool support
* reasoning support
* structured output
* latency
* cost
* availability
* provider health
* task requirements

And select the most appropriate model.

This transforms Hilbras from:

> "An SDK that talks to multiple LLM providers"

into:

> "An SDK that intelligently chooses how an AI request should be executed."

---

# 6. Intelligent Model Routing

The next layer should be a first-class routing system.

For example:

```ts
const response = await client.complete({
  messages,
  policy: {
    task: "coding",
    minQuality: 0.85,
    maxCost: 0.03,
    maxLatency: 3000
  }
});
```

The SDK could evaluate:

```text
Model A
Cost:     $0.004
Quality:  0.82
Latency:  1.2s

Model B
Cost:     $0.018
Quality:  0.95
Latency:  2.8s

Model C
Cost:     $0.001
Quality:  0.61
Latency:  0.5s
```

And select Model B because it satisfies the policy.

The important point is that routing should be **policy-driven**, not hardcoded.

---

# 7. Cost-Aware Execution

The SDK already has token counting and cost estimation.

The next step is turning this into a real execution optimization layer.

Developers should eventually be able to specify:

```ts
policy: {
  maxCost: 0.02
}
```

or:

```ts
policy: {
  budget: "low"
}
```

The SDK should be able to estimate:

```text
Input tokens
Output tokens
Model pricing
Expected cost
```

before execution where possible.

After execution it should expose:

```text
Actual input tokens
Actual output tokens
Actual cost
```

This creates a complete cost lifecycle:

```text
Request
   ↓
Cost Estimation
   ↓
Model Selection
   ↓
Execution
   ↓
Actual Usage
   ↓
Cost Reporting
```

---

# 8. Reliability as a First-Class System

The existing reliability layer is already one of the strongest parts of the project.

Current foundations include:

* Retry
* Exponential backoff
* Circuit breaker
* Timeout
* Graceful degradation

These should eventually evolve into a unified reliability engine.

For example:

```text
Provider Failure
       ↓
Retry
       ↓
Circuit Breaker
       ↓
Fallback Model
       ↓
Fallback Provider
       ↓
Request Degradation
```

A developer could define:

```ts
fallback: [
  "anthropic/claude-sonnet",
  "openai/gpt-4.1",
  "google/gemini"
]
```

The application should not need to manually implement provider failover.

---

# 9. Structured Output

Structured output should become a core capability.

The SDK should provide a provider-neutral abstraction:

```ts
const result = await client.generate({
  messages,
  output: schema(UserProfile)
});
```

The SDK should handle:

* JSON Schema
* Schema validation
* Native structured output
* Provider-specific structured output
* Malformed JSON recovery
* Automatic retry when output is invalid
* Normalized errors

The goal is:

```text
Application
    ↓
Schema
    ↓
Hilbras SDK
    ↓
Provider-specific implementation
```

The developer should not need to know how each provider implements structured output.

---

# 10. Observability

Observability should be a first-class SDK capability.

Every request should be capable of producing structured execution information such as:

```text
Request
 ├── Provider
 ├── Model
 ├── Input Tokens
 ├── Output Tokens
 ├── Latency
 ├── Retries
 ├── Fallbacks
 ├── Estimated Cost
 ├── Actual Cost
 ├── Status
 └── Errors
```

This should remain lightweight and optional.

The SDK should expose hooks/events rather than becoming an observability platform itself.

For example:

```ts
client.on("request.completed", event => {
  // Send to any observability backend
});
```

This keeps the SDK independent.

---

# 11. Plugin Architecture

The long-term architecture should allow providers to exist independently.

For example:

```text
@hilbras/sdk
       │
       ├── @hilbras/provider-openai
       ├── @hilbras/provider-anthropic
       ├── @hilbras/provider-gemini
       ├── @hilbras/provider-ollama
       ├── @hilbras/provider-mistral
       └── @thirdparty/provider-x
```

The core SDK should not need to contain every provider implementation forever.

This creates an ecosystem.

Third-party developers should eventually be able to build their own providers without modifying Hilbras SDK.

---

# 12. Keep These Things OUT of the SDK

This is extremely important.

Hilbras SDK should remain focused.

## Do NOT add:

### Memory

No long-term memory.

Memory should remain a separate project:

```text
Hilbras Memory
```

### Agent Runtime

No agent execution engine.

The Agent Runtime should remain separate.

### Agent Orchestration

No multi-agent orchestration.

### Council

No council or swarm system.

### MCP Management

The SDK may provide primitives for tool/protocol compatibility where necessary, but it should not become the MCP orchestration layer.

### Project Management

No project/task/workspace management.

### OS Features

No Hilbras OS-specific functionality.

The separation should remain:

```text
Hilbras OS
      │
      ├── Runtime
      ├── Agents
      ├── Memory
      ├── MCP
      ├── UI
      │
      ▼
@hilbras/sdk
      │
      ├── Providers
      ├── Models
      ├── Routing
      ├── Reliability
      ├── Cost
      ├── Streaming
      └── AI execution primitives
```

This separation is critical for making the SDK independently useful.

---

# 13. Recommended Final Architecture

The long-term architecture should evolve toward:

```text
                 HILBRAS ECOSYSTEM

┌─────────────────────────────────────────────┐
│                  Hilbras OS                 │
│                                             │
│ Runtime / Agents / Memory / MCP / UI       │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│                @hilbras/sdk                 │
│                                             │
│ Universal Provider Contract                 │
│ Model Registry                              │
│ Model Intelligence                          │
│ Intelligent Routing                         │
│ Execution Policies                          │
│ Reliability Engine                          │
│ Cost Optimization                           │
│ Structured Outputs                          │
│ Streaming                                   │
│ Tool Protocol                               │
│ Observability Hooks                         │
│ Typed Errors                                │
└──────────────────────┬──────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       OpenAI      Anthropic      Gemini
          │            │            │
        Groq         Ollama       Mistral
          │            │            │
          └────────────┼────────────┘
                       │
                 Custom Providers
```

---

# 14. Product Positioning

The project should not be marketed simply as:

> "A multi-provider LLM SDK."

That is too generic.

A stronger positioning is:

> **Hilbras SDK is a provider-neutral AI infrastructure SDK for reliable, intelligent, and cost-efficient model execution.**

Or shorter:

> **One AI interface. Any provider. Intelligent execution.**

The key differentiators should become:

```text
Provider Independence
        +
Model Intelligence
        +
Smart Routing
        +
Reliability
        +
Cost Optimization
        +
Structured Execution
```

---

# 15. Development Priority

Do not add random features.

The recommended sequence is:

```text
Phase 1
Universal Provider Contract
        ↓
Phase 2
Canonical AI Types
        ↓
Phase 3
Model Registry & Capabilities
        ↓
Phase 4
Provider Plugin Architecture
        ↓
Phase 5
Model Intelligence
        ↓
Phase 6
Intelligent Routing
        ↓
Phase 7
Cost-Aware Execution
        ↓
Phase 8
Reliability & Failover Engine
        ↓
Phase 9
Structured Output System
        ↓
Phase 10
Observability Hooks
        ↓
Phase 11
Developer Experience & Documentation
        ↓
Phase 12
Ecosystem / Third-Party Providers
```

---

# 16. Final Vision

The final goal should be for a developer to write something conceptually like:

```ts
const response = await client.generate({
  task: "coding",
  messages,
  policy: {
    quality: "high",
    maxCost: 0.05,
    maxLatency: 5000
  }
});
```

And Hilbras handles:

```text
Which provider?
        ↓
Which model?
        ↓
Does it support the required capability?
        ↓
What's the expected cost?
        ↓
What's the expected latency?
        ↓
Is the provider healthy?
        ↓
Should we retry?
        ↓
Should we fallback?
        ↓
Does the output match the schema?
        ↓
What was the actual usage?
```

The developer only cares about the result.

That is where Hilbras SDK can become significantly more interesting than a conventional provider abstraction.

---

# Final Principle

The most important architectural rule should be:

> **Hilbras SDK should provide AI execution infrastructure — not become an AI application framework.**

Keep Memory separate.

Keep Agents separate.

Keep Runtime separate.

Keep MCP orchestration separate.

Keep Hilbras OS-specific concepts separate.

Build the SDK as a **small, powerful, provider-neutral execution layer** that any application can use — including Hilbras OS itself.

If this boundary is preserved, `@hilbras/sdk` can grow into an independent open-source project rather than remaining merely an internal dependency of Hilbras OS.
