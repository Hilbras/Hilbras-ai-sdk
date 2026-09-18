import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TEMPLATES_DIR = new URL("../templates/", import.meta.url).pathname;

describe("create-hilbras-app", () => {
  const testDir = join(process.cwd(), ".test-create-app");

  it("basic template exists", () => {
    expect(existsSync(join(TEMPLATES_DIR, "basic"))).toBe(true);
  });

  it("basic template has package.json", () => {
    expect(existsSync(join(TEMPLATES_DIR, "basic", "package.json"))).toBe(true);
  });

  it("basic template has src/index.ts", () => {
    expect(existsSync(join(TEMPLATES_DIR, "basic", "src", "index.ts"))).toBe(true);
  });

  it("basic template has tsconfig.json", () => {
    expect(existsSync(join(TEMPLATES_DIR, "basic", "tsconfig.json"))).toBe(true);
  });

  it("basic template has .env.example", () => {
    expect(existsSync(join(TEMPLATES_DIR, "basic", ".env.example"))).toBe(true);
  });

  it("basic template package.json has correct deps", async () => {
    const pkg = JSON.parse(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(join(TEMPLATES_DIR, "basic", "package.json"), "utf8")
      )
    );
    expect(pkg.dependencies["@hilbras/sdk"]).toBeDefined();
    expect(pkg.type).toBe("module");
  });

  it("basic template src imports @hilbras/sdk", async () => {
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(join(TEMPLATES_DIR, "basic", "src", "index.ts"), "utf8")
    );
    expect(src).toContain('@hilbras/sdk');
    expect(src).toContain('HilbrasClient');
  });
});
