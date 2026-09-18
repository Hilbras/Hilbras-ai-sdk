import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI_PATH = join(import.meta.dirname, "../dist/cli.js");

function run(args: string, opts?: { cwd?: string }): string {
  return execSync(`node ${CLI_PATH} ${args}`, {
    encoding: "utf-8",
    cwd: opts?.cwd,
    env: { ...process.env, NO_COLOR: "1" },
  }).trim();
}

describe("hilbras CLI", () => {
  it("--version prints version", () => {
    const output = run("--version");
    expect(output).toMatch(/hilbras v\d+\.\d+\.\d+/);
  });

  it("--help prints usage", () => {
    const output = run("--help");
    expect(output).toContain("Usage:");
    expect(output).toContain("init");
    expect(output).toContain("provider");
    expect(output).toContain("model");
    expect(output).toContain("cost");
    expect(output).toContain("doctor");
  });

  it("init creates config file", () => {
    const tmpDir = join(tmpdir(), `hilbras-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const output = run("init", { cwd: tmpDir });
      expect(output).toContain("Created hilbras.config.json");
      expect(existsSync(join(tmpDir, "hilbras.config.json"))).toBe(true);

      const config = JSON.parse(readFileSync(join(tmpDir, "hilbras.config.json"), "utf-8"));
      expect(config.providers).toEqual([]);
      expect(config.defaults.model).toBe("gpt-4o");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("provider add adds provider to config", () => {
    const tmpDir = join(tmpdir(), `hilbras-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      run("init", { cwd: tmpDir });
      const output = run("provider add openai", { cwd: tmpDir });
      expect(output).toContain("Added provider");

      const config = JSON.parse(readFileSync(join(tmpDir, "hilbras.config.json"), "utf-8"));
      expect(config.providers).toHaveLength(1);
      expect(config.providers[0].name).toBe("openai");
      expect(config.providers[0].adapter).toBe("openai");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("provider list shows configured providers", () => {
    const tmpDir = join(tmpdir(), `hilbras-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      run("init", { cwd: tmpDir });
      run("provider add openai", { cwd: tmpDir });
      const output = run("provider list", { cwd: tmpDir });
      expect(output).toContain("openai");
      expect(output).toContain("api.openai.com");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("cost estimate shows pricing", () => {
    const output = run("cost estimate --model gpt-4o --tokens 10000");
    expect(output).toContain("Cost estimate for gpt-4o");
    expect(output).toContain("$");
  });

  it("doctor reports missing config", () => {
    const tmpDir = join(tmpdir(), `hilbras-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const output = run("doctor", { cwd: tmpDir });
      expect(output).toContain("No hilbras.config.json");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("unknown command shows error", () => {
    try {
      run("unknown-cmd");
    } catch (e: any) {
      expect(e.stderr).toContain("Unknown command");
    }
  });
});
