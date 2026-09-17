/**
 * @hilbras/sdk — tools/check-validate-url.mjs
 *
 * Lint check: every `getFromApi` call in `src/` must have an inline options
 * object with an explicit `validateUrl` property.
 *
 * Run as part of the test suite (tests/tools/check-validate-url.test.ts) so it
 * is enforced in CI without depending on a runtime oxlint plugin API.
 *
 * Why this rule:
 *   validateBaseUrl is the v0.9.3 SSRF guard. Adapters that bypass it (because
 *   the call is constructed elsewhere, or the options object is built in a
 *   helper) silently skip URL validation, which is a security regression.
 *   Forcing the flag to be visible at the call site is the cheapest way to
 *   keep the guarantee honest.
 *
 * See docs/contributing/decisions.md.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const SRC = "src";
const TS_EXTS = new Set([".ts", ".tsx", ".mts", ".cts"]);

/** @type {{ file: string; line: number; column: number; message: string }[]} */
const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
      walk(full);
    } else if (TS_EXTS.has(extname(full))) {
      checkFile(full);
    }
  }
}

function checkFile(path) {
  const src = readFileSync(path, "utf8");
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match `getFromApi(` not preceded by a word char (so we don't match
    // `myGetFromApi(` or `getFromApiAsync(`).
    const re = /(?<![A-Za-z0-9_$])getFromApi\s*\(/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      // Check the call on this line for an inline options object with
      // validateUrl. We are intentionally conservative: any multi-line
      // call without `validateUrl` somewhere on the same line fails closed.
      // This is good enough for the v0.10.0 enforcement; PR-6 will switch to
      // a real AST-based rule once the call is in production.
      const tail = line.slice(m.index);
      if (!/validateUrl\s*:/.test(tail)) {
        violations.push({
          file: path,
          line: i + 1,
          column: m.index + 1,
          message:
            "Pass `getFromApi` an inline options object with an explicit `validateUrl` property (see docs/contributing/decisions.md).",
        });
      }
    }
  }
}

walk(SRC);

if (violations.length > 0) {
  for (const v of violations) {
    console.error(`${v.file}:${v.line}:${v.column}: ${v.message}`);
  }
  console.error(`\n${violations.length} getFromApi call(s) missing validateUrl.`);
  process.exit(1);
}

console.log(`OK: no getFromApi calls missing validateUrl.`);
