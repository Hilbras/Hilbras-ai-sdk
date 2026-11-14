#!/usr/bin/env node
/**
 * Fails when the numbers written on the landing page no longer describe the
 * repository.
 *
 * This reads the SDK's `package.json` and `src/` from the parent directory, so
 * it is a local and CI check only — never part of the Vercel build. That build
 * sees just this folder, and `astro build` deliberately does not call it.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const landing = path.resolve(here, '..');
const repo = path.resolve(landing, '..');

const siteSource = await readFile(path.join(landing, 'src/data/site.ts'), 'utf8');

/** Reads `key: 'text'` or `key: 123` from the data file. */
function fromSite(key) {
  const match =
    siteSource.match(new RegExp(`\\b${key}:\\s*'([^']*)'`)) ??
    siteSource.match(new RegExp(`\\b${key}:\\s*(\\d+)`));

  if (!match) throw new Error(`src/data/site.ts has no readable \`${key}\``);
  return match[1];
}

const sdkPackage = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));

/** Adapter modules, minus the files that only exist to support them. */
const SUPPORT_FILES = new Set(['extra.ts', 'text-tool-call-parser.ts', 'types.ts']);
const adapterFiles = (await readdir(path.join(repo, 'src/adapters'))).filter(
  (file) => file.endsWith('.ts') && !SUPPORT_FILES.has(file),
);

/** Top-level provider entries in the catalogue. */
const catalogue = await readFile(path.join(repo, 'src/catalog/provider-catalog.ts'), 'utf8');
const catalogueProviders = catalogue.match(/^ {4}"?[a-z0-9-]+"?: \{/gm) ?? [];

const comparisons = [
  ['version', fromSite('version'), sdkPackage.version],
  ['adapterCount', Number(fromSite('adapterCount')), adapterFiles.length],
  ['providerCount', Number(fromSite('providerCount')), catalogueProviders.length],
];

const stale = comparisons.filter(([, stated, actual]) => String(stated) !== String(actual));

if (stale.length > 0) {
  console.error('src/data/site.ts no longer matches the repository:\n');
  for (const [key, stated, actual] of stale) {
    console.error(`  ${key}: the page says ${stated}, the repository has ${actual}`);
  }
  console.error('\nUpdate src/data/site.ts and run this again.');
  process.exit(1);
}

for (const [key, stated] of comparisons) console.log(`  ok  ${key} = ${stated}`);
console.log(`\nsite.ts agrees with the repository on ${comparisons.length} values.`);
