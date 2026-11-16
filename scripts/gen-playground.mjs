#!/usr/bin/env node
// docs/playground.md from the playground's table and cases (src/playground: NETS, CASES), read from the build (npm run build).
//   node scripts/gen-playground.mjs           write docs/playground.md
//   node scripts/gen-playground.mjs --check   fail when the file is not the generated one (test/playground.test.ts checks it too)
import { readFileSync, writeFileSync } from 'node:fs';
const { playgroundDoc } = await import(new URL('../dist/playground/index.js', import.meta.url).href);
const out = new URL('../docs/playground.md', import.meta.url);
const text = playgroundDoc();
if (process.argv.includes('--check')) {
  let now = ''; try { now = readFileSync(out, 'utf8'); } catch { /* missing */ }
  if (now !== text) { console.error('docs/playground.md is not the playground table: run npm run build && node scripts/gen-playground.mjs'); process.exit(1); }
  console.log('playground: docs/playground.md in step with src/playground');
} else { writeFileSync(out, text); console.log('wrote docs/playground.md'); }
