#!/usr/bin/env node
/**
 * Generate the subpath table in docs/api-reference.md from the built package.
 *
 * The table is derived from `package.json#exports` and the emitted `.d.ts`
 * files rather than written by hand, because a hand-maintained list of 50
 * subpaths is exactly the kind of document that silently goes stale: nobody
 * edits it when an export is added, and nothing fails.
 *
 * Regenerate with:  node tools/gen-subpath-table.mjs
 * The `--check` flag fails instead of writing, for CI.
 *
 * Markers in docs/api-reference.md:
 *   <!-- subpath-table:start --> ... <!-- subpath-table:end -->
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = join(repo, "docs/api-reference.md");
const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));

const check = process.argv.includes("--check");

/**
 * Exported names for a subpath, or null when it is a glob.
 *
 * Follows `export * from "./x.js"` rather than counting declarations in one
 * file: `dist/types/index.d.ts` is six re-exports and nothing else, so a
 * single-file scan reports it as exporting zero names — which is exactly the
 * kind of confidently wrong number a generated document is supposed to avoid.
 */
function exportsOf(subpath, seen = new Set()) {
  const entry = pkg.exports[subpath];
  if (!entry) return null;
  const spec = entry.types;
  if (spec.includes("*")) return null;

  const file = join(repo, spec.replace(/^\.\//, ""));
  if (seen.has(file)) return null;
  seen.add(file);

  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }

  const names = new Set();
  for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:abstract\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/g)) {
    names.add(m[1]);
  }
  for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  for (const m of text.matchAll(/export\s+\*\s+from\s+"(\.[^"]+)"/g)) {
    const target = resolveRelative(file, m[1]);
    if (!target) continue;
    let sub;
    try {
      sub = readFileSync(target, "utf8");
    } catch {
      continue;
    }
    for (const inner of sub.matchAll(/export\s+(?:declare\s+)?(?:abstract\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/g)) {
      names.add(inner[1]);
    }
    for (const inner of sub.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of inner[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
      }
    }
  }
  return [...names].sort();
}

/** Resolve a `./x.js` specifier emitted alongside a .d.ts to its .d.ts path. */
function resolveRelative(fromFile, specifier) {
  const base = join(dirname(fromFile), specifier.replace(/\.js$/, ".d.ts"));
  return readFileSync(base, "utf8") ? base : null;
}

const GROUPS = [
  ["Core", [".", "./types", "./adapter"]],
  ["Configuration & transport", ["./config", "./transport", "./transport/fetch", "./reliability/*"]],
  ["Cost & tokens", ["./tokens"]],
  ["Catalog", ["./catalog"]],
  ["Adapters", null],
  ["Frameworks", ["./react", "./react-client", "./vue", "./svelte", "./solid", "./angular",
                  "./qwik", "./nextjs", "./nextjs/api", "./nextjs/edge", "./astro", "./remix"]],
  ["Agent & AI features", ["./agent", "./eval", "./rag", "./fine-tune", "./mcp",
                           "./realtime", "./devtools"]],
];

const all = Object.keys(pkg.exports);
const listed = new Set();
const lines = [];

for (const [group, explicit] of GROUPS) {
  const keys = (explicit ?? all.filter((k) => k.startsWith("./adapters/"))).filter(
    (k) => all.includes(k) && !listed.has(k),
  );
  if (keys.length === 0) continue;
  lines.push(`| **${group}** | | |`);
  for (const key of keys) {
    listed.add(key);
    const name = exportsOf(key);
    const count = name === null ? "pattern" : String(name.length);
    const specifier = key === "." ? "`@hilbras/sdk`" : `\`@hilbras/sdk${key.slice(1)}\``;
    lines.push(`| ${specifier} | ${count} | |`);
  }
}

const table = [
  "_Counts are names declared in the emitted `.d.ts`, so type-only exports are",
  "counted too — the runtime surface is smaller. Use it to find a symbol, then read",
  "the section below for its contract._",
  "",
  "| Subpath | Type exports | Notes |",
  "| --- | --- | --- |",
  ...lines,
  "",
  `_${listed.size} subpaths. Generated from \`package.json#exports\` and the emitted \`.d.ts\` files by \`tools/gen-subpath-table.mjs\` — do not edit by hand._`,
].join("\n");

const doc = readFileSync(DOC, "utf8");
const start = doc.indexOf("<!-- subpath-table:start -->");
const end = doc.indexOf("<!-- subpath-table:end -->");
if (start === -1 || end === -1) {
  console.error("markers not found in docs/api-reference.md");
  process.exit(2);
}
const next = doc.slice(0, start + "<!-- subpath-table:start -->".length)
  + "\n\n" + table + "\n\n"
  + doc.slice(end);

const unlistedSubpaths = all.filter((k) => !listed.has(k));
if (unlistedSubpaths.length > 0) {
  console.error(
    "subpath table is missing these entry points, which no group covers:\n  " +
      unlistedSubpaths.join("\n  ") +
      "\nAdd them to GROUPS in tools/gen-subpath-table.mjs, then regenerate.",
  );
  process.exit(1);
}

if (check) {
  if (next !== doc) {
    console.error("subpath table is stale — run: node tools/gen-subpath-table.mjs");
    process.exit(1);
  }
  console.log(`OK   subpath table matches package.json (${listed.size} subpaths)`);
} else {
  writeFileSync(DOC, next);
  console.log(`wrote ${listed.size} subpaths to docs/api-reference.md`);
}
