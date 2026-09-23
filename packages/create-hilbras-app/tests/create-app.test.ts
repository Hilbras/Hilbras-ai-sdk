import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { validateTemplateName, validateProjectName } from "../src/validate.js";

const TEMPLATES_DIR = new URL("../templates/", import.meta.url).pathname;

describe("create-hilbras-app", () => {
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

  it("basic template has a gitignore for secrets and dependencies", () => {
    expect(existsSync(join(TEMPLATES_DIR, "basic", ".gitignore"))).toBe(true);
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

  describe("validateTemplateName", () => {
    it("rejects template with forward slash", () => {
      expect(() => validateTemplateName("../../../etc")).toThrow("Invalid template name");
    });

    it("rejects template with backslash", () => {
      expect(() => validateTemplateName("..\\evil")).toThrow("Invalid template name");
    });

    it("rejects template that is exactly '..'", () => {
      expect(() => validateTemplateName("..")).toThrow("Invalid template name");
    });

    it("rejects template starting with '../'", () => {
      expect(() => validateTemplateName("../etc/passwd")).toThrow("Invalid template name");
    });

    it("rejects template starting with '..\\'", () => {
      expect(() => validateTemplateName("..\\windows\\system32")).toThrow("Invalid template name");
    });

    it("accepts valid template names", () => {
      expect(() => validateTemplateName("basic")).not.toThrow();
      expect(() => validateTemplateName("tools")).not.toThrow();
      expect(() => validateTemplateName("react")).not.toThrow();
      expect(() => validateTemplateName("my-template")).not.toThrow();
    });
  });

  describe("validateProjectName", () => {
    it("rejects name with forward slash", () => {
      expect(() => validateProjectName("../evil-project")).toThrow("Invalid project name");
    });

    it("rejects name with backslash", () => {
      expect(() => validateProjectName("evil\\project")).toThrow("Invalid project name");
    });

    it("rejects name that is exactly '..'", () => {
      expect(() => validateProjectName("..")).toThrow("Invalid project name");
    });

    it("accepts valid project names", () => {
      expect(() => validateProjectName("my-app")).not.toThrow();
      expect(() => validateProjectName("hilbras-app")).not.toThrow();
      expect(() => validateProjectName("app123")).not.toThrow();
    });
  });
});
