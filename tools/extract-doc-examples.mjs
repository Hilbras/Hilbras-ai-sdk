#!/usr/bin/env node
/**
 * Extract every tsx/typescript example from a markdown file into a directory,
 * one file per fenced block.
 *
 * Kept as a standalone script rather than an inline heredoc: a regex containing
 * a backslash inside `bash <<'EOF'` is mangled by at least one layer between
 * the script and node, which produced a silently-zero match count.
 *
 * usage: extract-doc-examples.mjs <outDir> <markdown...>
 * prints the number of examples written, and exits 2 if none were found —
 * a zero count must never pass silently, because the downstream tsc run then
 * reports "no inputs" rather than a doc error.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const [, , outDir, ...markdownPaths] = process.argv;
if (!outDir || markdownPaths.length === 0) {
  console.error("usage: extract-doc-examples.mjs <outDir> <markdown...>");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const markdown = markdownPaths.map((p) => readFileSync(p, "utf8")).join("\n\n");

// Plain code fences carry their language in the info string. `vue` and `svelte`
// fences wrap TypeScript in a <script> block, so only that part is compilable
// and it is checked as .ts — the template half is markup and has no type to check.
const fence = /```(tsx|ts|typescript)(?:\s+(fragment))?\r?\n([\s\S]*?)```/g;
const componentFence = /```(vue|svelte)\r?\n([\s\S]*?)```/g;

// A fence tagged `fragment` is a snippet meant to be read in place — an object
// literal, an argument list — not pasted. It has no top-level statement, so it
// cannot compile and must not be reported as a doc error. Those blocks are
// counted and skipped rather than silently dropped, so the total stays honest.
let count = 0;
let skipped = 0;
for (const match of markdown.matchAll(fence)) {
  const language = match[1] === "typescript" ? "ts" : match[1];
  const body = match[3];
  // `ts fragment` is an explicit opt-out: a snippet that continues an earlier
  // example in the same section, referencing names defined there.
  if (match[2] === "fragment") {
    skipped++;
    continue;
  }
  // Standalone means it brings its own imports. A block that references names
  // defined by an earlier snippet in the same section is a continuation, and
  // typechecking it alone would report those names as undefined — a doc error
  // that is really a property of checking blocks in isolation.
  const isFragment = !/^\s*(?:import|declare)\b/m.test(body);
  if (isFragment) {
    skipped++;
    continue;
  }
  writeFileSync(`${outDir}/ex${count}.${language}`, body);
  count++;
}

for (const match of markdown.matchAll(componentFence)) {
  const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(match[2]);
  if (!script) continue;
  writeFileSync(`${outDir}/ex${count}.ts`, script[1]);
  count++;
}

console.log(count);
if (skipped) console.error(`skipped ${skipped} snippet fragment(s)`);
process.exit(count > 0 ? 0 : 2);
