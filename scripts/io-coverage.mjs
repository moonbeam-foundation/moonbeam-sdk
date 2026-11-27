#!/usr/bin/env node
// _COORD_IO_COVERAGE_v1_: the coverage matrix of every kept market x stage x dir against coord's catalogue.
//   node scripts/io-coverage.mjs --coord <path> [--sha <sha>] [--ref <name>]   write test/io/coverage.json and docs/io-coverage.md
//   npm run io:check -- --coord <path>                                        the same, and fail on any issue: a coord op a kept
//       market's tags name with no cell, an op the map names that coord dropped, a fixture whose request or answer no longer
//       matches coord's contract, a missing fixture. It prints what coord's declared shapes changed since the last coverage.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCoverage, extraMarkets, fixturesOnDisk, gapCount, loadCoord, renderDoc } from './io-coverage-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const check = process.argv.includes('--check');
const coordPath = arg('--coord');
if (!coordPath) { console.error('usage: io-coverage.mjs --coord <path to a coord checkout> [--sha <sha>] [--ref <name>] [--check]'); process.exit(2); }

const c = loadCoord(resolve(coordPath), { sha: arg('--sha') });
const map = JSON.parse(readFileSync(join(root, 'test/io/op-map.json'), 'utf8'));
const covFile = join(root, 'test/io/coverage.json');
const before = existsSync(covFile) ? JSON.parse(readFileSync(covFile, 'utf8')) : null;
const extra = extraMarkets(map, JSON.parse(readFileSync(join(root, 'src/market/venues-register.json'), 'utf8')));
const cov = buildCoverage(c, map, fixturesOnDisk(root), { ref: arg('--ref'), extra });

// what coord's declared shapes did since the last coverage.json (reported, not failing: a fixture that no longer fits fails above)
const changed = [];
if (before) {
  for (const [op, d] of Object.entries(cov.declared)) {
    const b = before.declared?.[op];
    if (!b) { changed.push(`+ ${op}: newly placed`); continue; }
    for (const side of ['request', 'response']) {
      const was = new Set(b[side]?.fields ?? []), now = new Set(d[side]?.fields ?? []);
      const add = [...now].filter((f) => !was.has(f)), del = [...was].filter((f) => !now.has(f));
      if (add.length || del.length || (b[side]?.from ?? null) !== (d[side]?.from ?? null))
        changed.push(`~ ${op} ${side}: ${d[side]?.from ?? 'undeclared'}${add.length ? ` +[${add.join(', ')}]` : ''}${del.length ? ` -[${del.join(', ')}]` : ''}`);
    }
    if (b.auth !== d.auth) changed.push(`~ ${op} auth: ${b.auth} -> ${d.auth}`);
  }
}

writeFileSync(covFile, JSON.stringify(cov, null, 1) + '\n');
writeFileSync(join(root, 'docs/io-coverage.md'), renderDoc(cov));
const g = gapCount(cov);
console.log(`coord ${c.sha} (${c.ops.size} ops): ${cov.cells.length} rows, ${cov.cells.filter((x) => x.fixture).length} fixtures, ${g.total} gaps; tagged ${cov.tagged.ops} (placed ${cov.tagged.placed}, set aside ${cov.tagged.set_aside})`);
if (before && before.coord?.sha !== c.sha) console.log(`against the last coverage.json (coord ${before.coord?.sha?.slice(0, 9)}):`);
for (const l of changed) console.log(`  ${l}`);
for (const i of cov.issues) console.log(`  ISSUE ${i}`);
if (check && cov.issues.length) { console.error(`io:check: ${cov.issues.length} issue(s) against coord ${c.sha.slice(0, 9)}`); process.exit(1); }
