#!/usr/bin/env node
/**
 * Remove a generated output directory before a TypeScript build.
 * Usage: node tools/clean-dist.mjs [path]
 */
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const target = resolve(process.cwd(), process.argv[2] ?? "dist");
await rm(target, { recursive: true, force: true });
