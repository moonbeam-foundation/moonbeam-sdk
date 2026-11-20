#!/usr/bin/env node
// _STATE_TABLE_v1_: the typed state table of the commerce machine.
//   node scripts/gen-states.mjs           write src/market/states.json and src/market/states-data.ts from the vendored machine
//   node scripts/gen-states.mjs --check   fail when either differs from what the machine produces
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE, buildStates, renderJson, renderTs } from './states-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const table = buildStates(JSON.parse(readFileSync(join(root, SOURCE), 'utf8')));
const want = new Map([['src/market/states.json', renderJson(table)], ['src/market/states-data.ts', renderTs(table)]]);
const differ = [...want].filter(([p, t]) => !existsSync(join(root, p)) || readFileSync(join(root, p), 'utf8') !== t).map(([p]) => p);
const summary = `${table.states.length} states, ${table.moves.length} moves`;
if (check) {
  if (differ.length) { console.error(`state table: not the machine's (node scripts/gen-states.mjs)\n${differ.map((p) => `  differs: ${p}`).join('\n')}`); process.exit(1); }
  console.log(`state table: ${summary}`);
} else {
  for (const [p, t] of want) writeFileSync(join(root, p), t);
  console.log(`wrote state table: ${summary}`);
}
