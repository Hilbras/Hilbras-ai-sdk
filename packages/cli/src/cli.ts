#!/usr/bin/env node
/// <reference types="node" />

/**
 * hilbras CLI
 *
 * Manages providers, models, and budgets for @hilbras/sdk.
 *
 * Commands:
 *   hilbras init                    — Scaffold project with provider config
 *   hilbras provider add <name>     — Add a provider interactively
 *   hilbras provider list           — List configured providers
 *   hilbras model list              — List available models
 *   hilbras model list --provider <name>  — List models for a provider
 *   hilbras cost estimate --model <model> --tokens <n>  — Estimate cost
 *   hilbras doctor                  — Diagnose config, connectivity, budgets
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const VERSION = "2.3.0";

const HELP = `
hilbras v${VERSION}

Usage:
  hilbras <command> [options]

Commands:
  init                          Scaffold a new project with provider config
  provider add <name>           Add a provider configuration
  provider list                 List all configured providers
  model list [--provider <n>]   List available models
  cost estimate                 Estimate cost for a model
  chat                          Interactive chat REPL
  bench                         Benchmark provider latency and throughput
  costs                         Show cost report from a session or file
  dashboard                     Render DevTools dashboard in terminal
  doctor                        Diagnose configuration issues

Options:
  --help, -h                    Show this help message
  --version, -v                 Show version
  --json                        Output as JSON
`;

const PROVIDER_TEMPLATES: Record<string, { baseUrl: string; adapter: string; envKey: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", adapter: "openai", envKey: "OPENAI_API_KEY" },
  anthropic: { baseUrl: "https://api.anthropic.com", adapter: "anthropic", envKey: "ANTHROPIC_API_KEY" },
  "google-genai": { baseUrl: "https://generativelanguage.googleapis.com/v1beta", adapter: "google-genai", envKey: "GOOGLE_API_KEY" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", adapter: "groq", envKey: "GROQ_API_KEY" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", adapter: "deepseek", envKey: "DEEPSEEK_API_KEY" },
  mistral: { baseUrl: "https://api.mistral.ai/v1", adapter: "mistral", envKey: "MISTRAL_API_KEY" },
  xai: { baseUrl: "https://api.x.ai/v1", adapter: "xai", envKey: "XAI_API_KEY" },
  together: { baseUrl: "https://api.together.xyz/v1", adapter: "together", envKey: "TOGETHER_API_KEY" },
  fireworks: { baseUrl: "https://api.fireworks.ai/inference/v1", adapter: "fireworks", envKey: "FIREWORKS_API_KEY" },
  ollama: { baseUrl: "http://localhost:11434/v1", adapter: "ollama", envKey: "" },
  bedrock: { baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com", adapter: "bedrock", envKey: "AWS_SECRET_ACCESS_KEY" },
  "google-vertex": { baseUrl: "https://us-central1-aiplatform.googleapis.com/v1/projects/PROJECT/locations/us-central1", adapter: "google-vertex", envKey: "GOOGLE_APPLICATION_CREDENTIALS" },
  huggingface: { baseUrl: "https://api-inference.huggingface.co", adapter: "huggingface", envKey: "HF_TOKEN" },
  deepgram: { baseUrl: "https://api.deepgram.com", adapter: "deepgram", envKey: "DEEPGRAM_API_KEY" },
  elevenlabs: { baseUrl: "https://api.elevenlabs.io", adapter: "elevenlabs", envKey: "ELEVENLABS_API_KEY" },
  voyageai: { baseUrl: "https://api.voyageai.com", adapter: "voyageai", envKey: "VOYAGE_API_KEY" },
  "cohere-rerank": { baseUrl: "https://api.cohere.com", adapter: "cohere-rerank", envKey: "COHERE_API_KEY" },
};

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.50, output: 10.00 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "claude-sonnet-5": { input: 3.00, output: 15.00 },
  "claude-haiku-4-5": { input: 0.80, output: 4.00 },
  "gemini-2.5-pro": { input: 1.25, output: 10.00 },
  "gemini-2.5-flash": { input: 0.15, output: 0.60 },
  "deepseek-chat": { input: 0.14, output: 0.28 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
};

function log(msg: string): void { console.log(msg); }
function error(msg: string): void { console.error(`Error: ${msg}`); }
function warn(msg: string): void { console.warn(`Warning: ${msg}`); }

function getConfigPath(): string {
  return join(process.cwd(), "hilbras.config.json");
}

function loadConfig(): Record<string, unknown> {
  const path = getConfigPath();
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf-8"));
}

function saveConfig(config: Record<string, unknown>): void {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + "\n");
}

function cmdInit(): void {
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    warn("hilbras.config.json already exists. Use 'hilbras provider add' to add providers.");
    return;
  }

  const config = {
    providers: [],
    defaults: {
      model: "gpt-4o",
      temperature: 0.7,
    },
  };

  saveConfig(config);
  log("Created hilbras.config.json");
  log("");
  log("Next steps:");
  log("  1. Add a provider:  hilbras provider add openai");
  log("  2. Set your API key: export OPENAI_API_KEY=sk-...");
  log("  3. Start building:  import { HilbrasClient } from '@hilbras/sdk'");
}

function cmdProviderAdd(name: string): void {
  const template = PROVIDER_TEMPLATES[name];
  if (!template) {
    error(`Unknown provider "${name}". Available: ${Object.keys(PROVIDER_TEMPLATES).join(", ")}`);
    return;
  }

  const config = loadConfig();
  const providers = (config.providers as Array<Record<string, unknown>>) ?? [];

  if (providers.some((p) => p.name === name)) {
    warn(`Provider "${name}" is already configured.`);
    return;
  }

  providers.push({
    name,
    baseUrl: template.baseUrl,
    adapter: template.adapter,
    authentication: {
      type: "bearer",
      apiKey: `\${${template.envKey}}`,
    },
  });

  config.providers = providers;
  saveConfig(config);

  log(`Added provider "${name}" to hilbras.config.json`);
  if (template.envKey) {
    log(`Set your API key: export ${template.envKey}=your_key_here`);
  }
}

function cmdProviderList(): void {
  const config = loadConfig();
  const providers = (config.providers as Array<Record<string, unknown>>) ?? [];

  if (providers.length === 0) {
    log("No providers configured. Run 'hilbras provider add <name>' to add one.");
    return;
  }

  log("Configured providers:");
  for (const p of providers) {
    log(`  - ${p.name} (${p.adapter}) → ${p.baseUrl}`);
  }
}

function cmdModelList(provider?: string): void {
  const config = loadConfig();
  const providers = (config.providers as Array<Record<string, unknown>>) ?? [];

  if (providers.length === 0) {
    log("No providers configured. Run 'hilbras provider add <name>' first.");
    return;
  }

  const filtered = provider ? providers.filter((p) => p.name === provider) : providers;
  if (filtered.length === 0) {
    log(`No provider named "${provider}" found.`);
    return;
  }

  log("Available models:");
  for (const p of filtered) {
    log(`\n  ${p.name}:`);
    const template = PROVIDER_TEMPLATES[p.name as string];
    if (template) {
      log(`    Adapter: ${template.adapter}`);
      log(`    Base URL: ${p.baseUrl}`);
    }
  }

  log("\n  Use 'hilbras cost estimate' to check pricing for specific models.");
}

function cmdCostEstimate(model: string, tokens: number): void {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    warn(`No pricing data for "${model}". Available models: ${Object.keys(MODEL_PRICING).join(", ")}`);
    return;
  }

  const inputCost = (tokens / 1_000_000) * pricing.input;
  const outputCost = (tokens / 1_000_000) * pricing.output;

  log(`Cost estimate for ${model}:`);
  log(`  Input:  $${inputCost.toFixed(6)} (${tokens} tokens × $${pricing.input}/1M)`);
  log(`  Output: $${outputCost.toFixed(6)} (${tokens} tokens × $${pricing.output}/1M)`);
  log(`  Total:  $${(inputCost + outputCost).toFixed(6)}`);
}

function cmdDoctor(): void {
  const config = loadConfig();
  const providers = (config.providers as Array<Record<string, unknown>>) ?? [];

  log("hilbras doctor");
  log("=============");
  log("");

  // Check config file
  if (existsSync(getConfigPath())) {
    log("[OK] hilbras.config.json found");
  } else {
    log("[WARN] No hilbras.config.json — run 'hilbras init' to create one");
  }

  // Check providers
  log(`[INFO] ${providers.length} provider(s) configured`);

  // Check environment variables
  for (const p of providers) {
    const template = PROVIDER_TEMPLATES[p.name as string];
    if (template?.envKey) {
      const val = process.env[template.envKey];
      if (val) {
        log(`[OK] ${template.envKey} is set`);
      } else {
        log(`[WARN] ${template.envKey} is not set`);
      }
    }
  }

  log("");
  log("Doctor complete.");
}

// ─── v3.0.0: Interactive Chat ──────────────────────────────────────────────

async function cmdChat(opts: { provider?: string; model?: string; temperature?: string; maxTokens?: string }): Promise<void> {
  const { createInterface } = await import("node:readline");
  const { HilbrasClient } = await import("@hilbras/sdk");

  const config = loadConfig();
  const providers = (config.providers as Array<Record<string, unknown>>) ?? [];
  if (providers.length === 0) {
    error("No providers configured. Run 'hilbras provider add <name>' first.");
    process.exit(1);
  }

  const providerName = opts.provider ?? providers[0]?.name as string;
  const model = opts.model ?? (config as Record<string, unknown>).defaults
    ? ((config as Record<string, unknown>).defaults as Record<string, unknown>)?.model as string ?? "gpt-4o"
    : "gpt-4o";
  const temperature = opts.temperature ? parseFloat(opts.temperature) : 0.7;
  const maxTokens = opts.maxTokens ? parseInt(opts.maxTokens, 10) : 4096;

  const client = new HilbrasClient();
  for (const p of providers) {
    const template = PROVIDER_TEMPLATES[p.name as string];
    if (template) {
      const envVal = template.envKey ? process.env[template.envKey] : undefined;
      client.addProvider({
        name: p.name as string,
        baseUrl: p.baseUrl as string,
        adapter: template.adapter as "openai" | "anthropic" | "google-genai" | "groq" | "mistral" | "deepseek" | "xai" | "together" | "fireworks" | "ollama" | "bedrock" | "google-vertex" | "huggingface" | "deepgram" | "elevenlabs" | "voyageai" | "cohere-rerank" | "openai-compatible",
        authentication: envVal ? { type: "bearer", apiKey: envVal } : { type: "none" },
        models: [{ id: model }],
      });
    }
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const messages: Array<{ role: string; content: string }> = [];

  log(`hilbras chat — ${providerName}/${model}`);
  log("Type your message and press Enter. Type 'exit' or 'quit' to leave.\n");

  const prompt = (): void => {
    rl.question("You: ", async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed === "exit" || trimmed === "quit") {
        log("\nGoodbye!");
        rl.close();
        await client.dispose();
        process.exit(0);
      }

      messages.push({ role: "user", content: trimmed });

      try {
        process.stdout.write("Assistant: ");
        const stream = client.stream({
          provider: providerName,
          model,
          messages,
          temperature,
          maxTokens,
        });
        let fullResponse = "";
        for await (const chunk of stream) {
          if (chunk.type === "text") {
            process.stdout.write(chunk.text);
            fullResponse += chunk.text;
          }
        }
        process.stdout.write("\n\n");
        messages.push({ role: "assistant", content: fullResponse });
      } catch (err) {
        error((err as Error).message);
        process.stdout.write("\n");
      }

      prompt();
    });
  };

  prompt();
}

// ─── v3.0.0: Benchmark ─────────────────────────────────────────────────────

async function cmdBench(opts: { prompt?: string; providers?: string; runs?: string }): Promise<void> {
  const { HilbrasClient } = await import("@hilbras/sdk");

  const config = loadConfig();
  const providers = (config.providers as Array<Record<string, unknown>>) ?? [];
  if (providers.length === 0) {
    error("No providers configured. Run 'hilbras provider add <name>' first.");
    process.exit(1);
  }

  const benchPrompt = opts.prompt ?? "Hello, world!";
  const runs = opts.runs ? parseInt(opts.runs, 10) : 3;
  const filterProviders = opts.providers?.split(",").map((s) => s.trim());

  const client = new HilbrasClient();
  for (const p of providers) {
    const template = PROVIDER_TEMPLATES[p.name as string];
    if (template) {
      const envVal = template.envKey ? process.env[template.envKey] : undefined;
      client.addProvider({
        name: p.name as string,
        baseUrl: p.baseUrl as string,
        adapter: template.adapter as "openai" | "anthropic" | "google-genai" | "groq" | "mistral" | "deepseek" | "xai" | "together" | "fireworks" | "ollama" | "bedrock" | "google-vertex" | "huggingface" | "deepgram" | "elevenlabs" | "voyageai" | "cohere-rerank" | "openai-compatible",
        authentication: envVal ? { type: "bearer", apiKey: envVal } : { type: "none" },
        models: [{ id: "gpt-4o" }],
      });
    }
  }

  const targetProviders = filterProviders ?? providers.map((p) => p.name as string);
  const results: Array<{ provider: string; avgLatency: number; tokensPerSec: number; avgCost: number; errors: number }> = [];

  log(`Benchmarking ${targetProviders.length} provider(s) with ${runs} run(s) each...`);
  log(`Prompt: "${benchPrompt}"\n`);

  for (const providerName of targetProviders) {
    const latencies: number[] = [];
    const tokenRates: number[] = [];
    const costs: number[] = [];
    let errors = 0;

    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      let tokens = 0;
      try {
        for await (const chunk of client.stream({
          provider: providerName,
          model: "gpt-4o",
          messages: [{ role: "user", content: benchPrompt }],
        })) {
          if (chunk.type === "text") tokens += chunk.text.length; // rough char count as proxy
          if (chunk.type === "usage") {
            const outT = (chunk as { outputTokens?: number }).outputTokens;
            if (outT) tokens = outT;
          }
        }
        const elapsed = performance.now() - start;
        latencies.push(elapsed);
        tokenRates.push(tokens / (elapsed / 1000));
      } catch {
        errors++;
      }
    }

    const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    const tokensPerSec = tokenRates.length > 0 ? tokenRates.reduce((a, b) => a + b, 0) / tokenRates.length : 0;

    results.push({ provider: providerName, avgLatency, tokensPerSec, avgCost: 0, errors });
  }

  // Print results table
  log("Results:");
  log("─".repeat(70));
  log(`${"Provider".padEnd(20)} ${"Avg Latency".padEnd(15)} ${"Tokens/sec".padEnd(15)} ${"Errors".padEnd(10)}`);
  log("─".repeat(70));
  for (const r of results) {
    log(`${r.provider.padEnd(20)} ${`${r.avgLatency.toFixed(0)}ms`.padEnd(15)} ${r.tokensPerSec.toFixed(1).padEnd(15)} ${String(r.errors).padEnd(10)}`);
  }
  log("─".repeat(70));

  await client.dispose();
}

// ─── v3.0.0: Cost Report ───────────────────────────────────────────────────

function cmdCosts(opts: { file?: string }): void {
  if (opts.file) {
    if (!existsSync(opts.file)) {
      error(`File not found: ${opts.file}`);
      process.exit(1);
    }
    const data = JSON.parse(readFileSync(opts.file, "utf-8"));
    printCostReport(data);
    return;
  }

  // Try to read from a default location
  const defaultPath = join(process.cwd(), ".hilbras-costs.json");
  if (existsSync(defaultPath)) {
    const data = JSON.parse(readFileSync(defaultPath, "utf-8"));
    printCostReport(data);
    return;
  }

  log("No cost data found. Usage:");
  log("  hilbras costs --file <path>    Read from a saved cost report JSON");
  log("");
  log("To capture a cost report programmatically:");
  log('  const report = client.costReport();');
  log('  writeFileSync(".hilbras-costs.json", JSON.stringify(report, null, 2));');
}

function printCostReport(report: Record<string, unknown>): void {
  log("Cost Report");
  log("═══════════");
  log(`  Total Actual:    $${(report.totalActual as number ?? 0).toFixed(4)}`);
  log(`  Total Estimated: $${(report.totalEstimated as number ?? 0).toFixed(4)}`);
  log(`  Remaining:       $${report.remainingBudget != null ? (report.remainingBudget as number).toFixed(4) : "unlimited"}`);
  log(`  Requests:        ${report.requestCount ?? 0}`);
  log(`  Budget Exceeded: ${report.budgetExceeded ? "YES" : "no"}`);

  const byProvider = report.byProvider as Record<string, { estimated: number; actual: number; requests: number }> | undefined;
  if (byProvider && Object.keys(byProvider).length > 0) {
    log("\n  By Provider:");
    for (const [name, data] of Object.entries(byProvider)) {
      log(`    ${name.padEnd(20)} $${data.actual.toFixed(4)}  (${data.requests} requests)`);
    }
  }
}

// ─── v3.0.0: Dashboard ─────────────────────────────────────────────────────

function cmdDashboard(opts: { file?: string }): void {
  if (opts.file) {
    if (!existsSync(opts.file)) {
      error(`File not found: ${opts.file}`);
      process.exit(1);
    }
    const data = JSON.parse(readFileSync(opts.file, "utf-8"));
    printDashboard(data);
    return;
  }

  // Try to read from a default location
  const defaultPath = join(process.cwd(), ".hilbras-dashboard.json");
  if (existsSync(defaultPath)) {
    const data = JSON.parse(readFileSync(defaultPath, "utf-8"));
    printDashboard(data);
    return;
  }

  log("No dashboard data found. Usage:");
  log("  hilbras dashboard --file <path>    Read from a saved dashboard JSON");
  log("");
  log("To capture dashboard data programmatically:");
  log('  const dashboard = new DevToolsDashboard();');
  log('  // ... make requests ...');
  log('  const snapshot = dashboard.snapshot();');
  log('  writeFileSync(".hilbras-dashboard.json", JSON.stringify(snapshot, null, 2));');
}

function printDashboard(snapshot: Record<string, unknown>): void {
  log("Hilbras DevTools Dashboard");
  log("══════════════════════════");

  const timeline = snapshot.requestTimeline as Array<Record<string, unknown>> | undefined;
  if (timeline && timeline.length > 0) {
    log(`\n  Requests: ${timeline.length}`);
    const completed = timeline.filter((r) => r.success);
    const failed = timeline.filter((r) => !r.success);
    log(`  Completed: ${completed.length}  Failed: ${failed.length}`);

    if (completed.length > 0) {
      const latencies = completed.map((r) => r.durationMs as number).sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length * 0.5)];
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      const p99 = latencies[Math.floor(latencies.length * 0.99)];
      log(`  Latency p50: ${p50?.toFixed(0) ?? "N/A"}ms  p95: ${p95?.toFixed(0) ?? "N/A"}ms  p99: ${p99?.toFixed(0) ?? "N/A"}ms`);
    }
  }

  const cost = snapshot.cost as Record<string, unknown> | undefined;
  if (cost) {
    log(`\n  Cost: $${(cost.totalActual as number ?? 0).toFixed(4)}`);
  }

  const health = snapshot.providerHealth as Record<string, Record<string, unknown>> | undefined;
  if (health && Object.keys(health).length > 0) {
    log("\n  Provider Health:");
    for (const [name, h] of Object.entries(health)) {
      const status = h.circuitBreakerOpen ? "⚠ CIRCUIT OPEN" : "✓ healthy";
      log(`    ${name}: ${status} (${h.totalRequests ?? 0} requests)`);
    }
  }

  log("");
}

// ─── CLI Entry Point ──────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help" || command === "-h") {
  log(HELP);
  process.exit(0);
}

if (command === "--version" || command === "-v") {
  log(`hilbras v${VERSION}`);
  process.exit(0);
}

switch (command) {
  case "init":
    cmdInit();
    break;

  case "provider": {
    const sub = args[1];
    const name = args[2];
    if (sub === "add" && name) {
      cmdProviderAdd(name);
    } else if (sub === "list") {
      cmdProviderList();
    } else {
      error("Usage: hilbras provider <add|list> [name]");
      process.exit(1);
    }
    break;
  }

  case "model": {
    const sub = args[1];
    if (sub === "list") {
      const providerIdx = args.indexOf("--provider");
      const provider = providerIdx !== -1 ? args[providerIdx + 1] : undefined;
      cmdModelList(provider);
    } else {
      error("Usage: hilbras model list [--provider <name>]");
      process.exit(1);
    }
    break;
  }

  case "cost": {
    const sub = args[1];
    if (sub === "estimate") {
      const modelIdx = args.indexOf("--model");
      const tokensIdx = args.indexOf("--tokens");
      const model = modelIdx !== -1 ? args[modelIdx + 1] : "gpt-4o";
      const tokens = tokensIdx !== -1 ? parseInt(args[tokensIdx + 1], 10) : 10000;
      cmdCostEstimate(model, tokens);
    } else {
      error("Usage: hilbras cost estimate --model <model> --tokens <n>");
      process.exit(1);
    }
    break;
  }

  case "doctor":
    cmdDoctor();
    break;

  case "chat": {
    const providerIdx = args.indexOf("--provider");
    const modelIdx = args.indexOf("--model");
    const tempIdx = args.indexOf("--temperature");
    const maxIdx = args.indexOf("--max-tokens");
    cmdChat({
      provider: providerIdx !== -1 ? args[providerIdx + 1] : undefined,
      model: modelIdx !== -1 ? args[modelIdx + 1] : undefined,
      temperature: tempIdx !== -1 ? args[tempIdx + 1] : undefined,
      maxTokens: maxIdx !== -1 ? args[maxIdx + 1] : undefined,
    }).catch((err) => { error(err.message); process.exit(1); });
    break;
  }

  case "bench": {
    const promptIdx = args.indexOf("--prompt");
    const providersIdx = args.indexOf("--providers");
    const runsIdx = args.indexOf("--runs");
    cmdBench({
      prompt: promptIdx !== -1 ? args[promptIdx + 1] : undefined,
      providers: providersIdx !== -1 ? args[providersIdx + 1] : undefined,
      runs: runsIdx !== -1 ? args[runsIdx + 1] : undefined,
    }).catch((err) => { error(err.message); process.exit(1); });
    break;
  }

  case "costs": {
    const fileIdx = args.indexOf("--file");
    cmdCosts({ file: fileIdx !== -1 ? args[fileIdx + 1] : undefined });
    break;
  }

  case "dashboard": {
    const fileIdx = args.indexOf("--file");
    cmdDashboard({ file: fileIdx !== -1 ? args[fileIdx + 1] : undefined });
    break;
  }

  default:
    error(`Unknown command "${command}". Run 'hilbras --help' for usage.`);
    process.exit(1);
}
