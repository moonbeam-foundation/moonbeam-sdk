#!/usr/bin/env node
// _ACCEPTANCE_TESTS_v1_: write the unit tests of every I/O fixture, test/io/generated/<market>/<stage>.test.ts.
//   node scripts/gen-acceptance-tests.mjs [--write]   rewrite the generated tests from the fixtures (and remove stale ones)
//   node scripts/gen-acceptance-tests.mjs --check     fail when a generated test differs from what the fixtures produce
// Run after scripts/gen-paths.mjs: the run files it writes are fixtures too.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drift, fixtureFiles, generatedOnDisk, plan, renderFiles, testCount } from './acceptance-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const map = JSON.parse(readFileSync(join(root, 'test/io/op-map.json'), 'utf8'));
const paths = JSON.parse(readFileSync(join(root, 'src/market/venue-paths.json'), 'utf8'));

const files = fixtureFiles(root);
const { items, skipped } = plan(files, map, paths);
const want = renderFiles(items);
const off = drift(want, generatedOnDisk(root));
const calls = items.filter((i) => i.kind === 'call').length;
const summary = `${files.size} fixtures: ${calls} recorded calls and ${items.length - calls} runs became ${testCount(items)} tests in ${want.size} files; ${skipped.length} skipped (a gap, not a failure)`;

if (check) {
  if (off.length) {
    console.error(`acceptance tests: not what the fixtures produce (npm run gen:acceptance)\n${off.map((d) => `  ${d.why}: ${d.file}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`acceptance tests: ${summary}`);
} else {
  for (const d of off) {
    if (d.why === 'stale') rmSync(join(root, d.file));
    else { mkdirSync(dirname(join(root, d.file)), { recursive: true }); writeFileSync(join(root, d.file), want.get(d.file)); }
  }
  console.log(`wrote acceptance tests: ${summary}${off.length ? `; ${off.length} file(s) changed` : ''}`);
}
for (const s of skipped) console.log(`  skipped ${s.file}: ${s.why}`);
