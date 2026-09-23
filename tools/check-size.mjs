#!/usr/bin/env node
/**
 * Bundle size check — ensures dist/ stays under threshold.
 * Run after `npm run build`.
 */

import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const MAX_KB = 1900; // max total dist size in KB (v3.0.0: added plugin, RBAC, SLA, cost alerts, AB test)

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += dirSize(path);
    } else {
      total += statSync(path).size;
    }
  }
  return total;
}

const bytes = dirSize(DIST);
const kb = (bytes / 1024).toFixed(1);

if (kb > MAX_KB) {
  console.error(`FAIL: dist/ is ${kb}KB (max ${MAX_KB}KB)`);
  process.exit(1);
} else {
  console.log(`OK: dist/ is ${kb}KB (max ${MAX_KB}KB)`);
}
