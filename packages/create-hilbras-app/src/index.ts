#!/usr/bin/env node

/**
 * create-hilbras-app — Project scaffolding CLI
 *
 * Usage: npx create-hilbras-app [project-name] [options]
 */

import { mkdir, writeFile, cp, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { validateTemplateName, validateProjectName } from "./validate.js";

const TEMPLATES_DIR = new URL("../templates/", import.meta.url).pathname;

interface Options {
  name: string;
  template: string;
  provider?: string;
  dir: string;
}

function parseArgs(args: string[]): Options {
  let name = "hilbras-app";
  let template = "basic";
  let provider: string | undefined;
  let dir = process.cwd();

  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--template" || arg === "-t") {
      template = args[++i];
    } else if (arg === "--provider" || arg === "-p") {
      provider = args[++i];
    } else if (arg === "--dir" || arg === "-d") {
      dir = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      name = arg;
    }
  }

  validateTemplateName(template);
  validateProjectName(name);

  return { name, template, provider, dir };
}

function printHelp() {
  console.log(`
  create-hilbras-app — Scaffold a new @hilbras/sdk project

  Usage:
    npx create-hilbras-app [project-name] [options]

  Options:
    -t, --template <name>   Template to use (default: basic)
    -p, --provider <name>   Pre-configure a provider (openai, anthropic, etc.)
    -d, --dir <path>        Target directory
    -h, --help              Show this help

  Templates:
    basic     Simple streaming example

  Examples:
    npx create-hilbras-app my-app
    npx create-hilbras-app my-app --provider openai
    npx create-hilbras-app my-app --template tools
  `);
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function copyTemplate(templateDir: string, targetDir: string): Promise<void> {
  const entries = await import("node:fs/promises").then((fs) =>
    fs.readdir(templateDir, { withFileTypes: true })
  );

  for (const entry of entries) {
    const src = join(templateDir, entry.name);
    const dest = join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await ensureDir(dest);
      await copyTemplate(src, dest);
    } else {
      await cp(src, dest);
    }
  }
}

async function configureProvider(projectDir: string, provider: string): Promise<void> {
  const envPath = join(projectDir, ".env");
  const envExamplePath = join(projectDir, ".env.example");

  const providerConfig: Record<string, { key: string; baseUrl: string }> = {
    openai: { key: "OPENAI_API_KEY", baseUrl: "https://api.openai.com/v1" },
    anthropic: { key: "ANTHROPIC_API_KEY", baseUrl: "https://api.anthropic.com" },
    google: { key: "GOOGLE_API_KEY", baseUrl: "https://generativelanguage.googleapis.com" },
    groq: { key: "GROQ_API_KEY", baseUrl: "https://api.groq.com/openai" },
  };

  const config = providerConfig[provider.toLowerCase()];
  if (config) {
    const content = `${config.key}=your-key-here\n`;
    await writeFile(envPath, content);
    console.log(`  Configured ${provider} provider in .env`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  const projectDir = resolve(options.dir, options.name);

  console.log(`\n  Creating Hilbras app: ${options.name}\n`);

  // Check if directory exists
  if (existsSync(projectDir)) {
    console.error(`  Error: Directory ${projectDir} already exists`);
    process.exit(1);
  }

  // Create project
  await ensureDir(projectDir);

  const templateDir = join(TEMPLATES_DIR, options.template);
  if (!existsSync(templateDir)) {
    console.error(`  Error: Template "${options.template}" not found`);
    console.error(`  Available templates: basic`);
    process.exit(1);
  }

  await copyTemplate(templateDir, projectDir);

  // Configure provider if specified
  if (options.provider) {
    await configureProvider(projectDir, options.provider);
  }

  console.log(`  Created ${options.name} at ${projectDir}\n`);
  console.log(`  Next steps:`);
  console.log(`    cd ${options.name}`);
  console.log(`    npm install`);
  console.log(`    npm run dev\n`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
