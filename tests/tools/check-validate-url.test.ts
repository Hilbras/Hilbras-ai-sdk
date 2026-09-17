/**
 * @hilbras/sdk — tests/tools/check-validate-url.test.ts
 *
 * Runs the `tools/check-validate-url.mjs` linter and asserts the SDK is
 * compliant: no `getFromApi` call in `src/` is missing an inline
 * `validateUrl` property. PR-1 introduces the rule; PR-6 will start using
 * `getFromApi` in the adapters and prove the rule fires when violated.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const TOOL = resolve(__dirname, "../../tools/check-validate-url.mjs");

function runLint(): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [TOOL], {
      cwd: resolve(__dirname, "../.."),
      encoding: "utf8",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      status: e.status ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}

describe("tools/check-validate-url.mjs (PR-1)", () => {
  it("reports OK when the codebase is compliant", () => {
    const r = runLint();
    if (r.status !== 0) {
      // Show the lint output for debugging
      throw new Error(
        `check-validate-url failed (status ${r.status}):\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
      );
    }
    expect(r.stdout).toMatch(/OK: no getFromApi calls missing validateUrl\./);
  });
});
