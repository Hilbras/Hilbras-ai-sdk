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

const VERSION = "0.16.0";

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

  default:
    error(`Unknown command "${command}". Run 'hilbras --help' for usage.`);
    process.exit(1);
}
