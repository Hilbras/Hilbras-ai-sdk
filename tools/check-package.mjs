#!/usr/bin/env node
/**
 * Validate the built package export map and load the generated entrypoints.
 * Run after `npm run build`.
 */
import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const failures = [];
let checked = 0;

for (const [subpath, conditions] of Object.entries(packageJson.exports ?? {})) {
  if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) continue;
  const target = conditions.import;
  if (typeof target !== "string" || target.includes("*")) continue;
  const file = path.resolve(root, target);
  checked++;
  try {
    await access(file);
  } catch {
    failures.push(`${subpath}: missing ${target}`);
    continue;
  }
  try {
    await import(pathToFileURL(file).href);
  } catch (error) {
    failures.push(`${subpath}: import failed (${error instanceof Error ? error.message : String(error)})`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Package export smoke test passed (${checked} entrypoints).`);
