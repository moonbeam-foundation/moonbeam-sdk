// _VENUE_PATHS_v1_: vendor Moonbeam's part of coord's venue paths, write a run file per feature a run covers, render docs/PATHS.md.
//   node scripts/gen-paths.mjs --coord <coord checkout> [--sha <sha>]   take a new snapshot (src/market/venue-paths.json)
//   node scripts/gen-paths.mjs                                         re-render the run files and docs/PATHS.md from the snapshot
//   node scripts/gen-paths.mjs --check                                 fail when they are not the snapshot's
// It also writes src/market/venue-mainnet-data.ts (_MAINNET_IO_v1_): per market and feature, the mainnet run and the recorded read of
// each step it covers (scripts/record-api-rung.mjs --rung live). Run it again after a recording, then build.
// Run before `gen-venues --features`: a tested cell there must name a run file that exists (scripts/tested-fixture.mjs).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_FILE, isRunFile, isRungFile, mainnetProofs, moonbeamPaths, renderMainnet, renderPaths, runFiles } from './paths-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const check = process.argv.includes('--check');
const SNAP = join(root, 'src/market/venue-paths.json');
const DOC = join(root, 'docs/PATHS.md');
const MAINNET = join(root, 'src/market/venue-mainnet-data.ts');
const FIX = join(root, 'test/io/fixtures');
const json = (o) => `${JSON.stringify(o, null, 1)}\n`;

const coord = arg('--coord');
if (coord) {
  if (check) throw new Error('--check reads the snapshot; take a new one without --check');
  const sha = arg('--sha') ?? execFileSync('git', ['-C', coord, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const pub = JSON.parse(readFileSync(join(coord, PUBLIC_FILE), 'utf8'));
  writeFileSync(SNAP, json(moonbeamPaths(pub, sha)));
}
if (!existsSync(SNAP)) throw new Error('no snapshot: node scripts/gen-paths.mjs --coord <coord checkout>');
const paths = JSON.parse(readFileSync(SNAP, 'utf8'));
// the market names are VENUES' own (the build), else the ids
let nameOf = (id) => id;
try { const { VENUES } = await import('../dist/market/index.js'); nameOf = (id) => VENUES.find((v) => v.id === id)?.name ?? id; } catch { /* no build */ }

const want = new Map([...runFiles(paths)].map(([p, o]) => [p, json(o)]));
const have = [];
// _MAINNET_IO_v1_: the recorded reads of a rung (scripts/record-api-rung.mjs), by path: a live cell stands on them
const recorded = new Map();
const walk = (d) => { if (!existsSync(d)) return; for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (isRunFile(f)) have.push(relative(root, p)); else if (isRungFile(f)) recorded.set(relative(root, p), JSON.parse(readFileSync(p, 'utf8'))); } };
walk(FIX);
const proofs = mainnetProofs(paths, recorded);
want.set(relative(root, DOC), renderPaths(paths, nameOf, proofs));
want.set(relative(root, MAINNET), renderMainnet(proofs));
const stale = have.filter((p) => !want.has(p));
const differ = [...want].filter(([p, t]) => !existsSync(join(root, p)) || readFileSync(join(root, p), 'utf8') !== t).map(([p]) => p);

if (check) {
  if (stale.length || differ.length) {
    console.error(`venue paths: not the snapshot's (node scripts/gen-paths.mjs)\n${[...differ.map((p) => `  differs: ${p}`), ...stale.map((p) => `  stale: ${p}`)].join('\n')}`);
    process.exit(1);
  }
  console.log(`venue paths: coord ${paths.coord.sha.slice(0, 9)}, ${paths.markets.length} markets, ${paths.rows.length} paths, ${want.size - 2} run files`);
} else {
  for (const p of stale) rmSync(join(root, p));
  for (const [p, t] of want) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), t); }
  console.log(`wrote venue paths: coord ${paths.coord.sha.slice(0, 9)}, ${paths.markets.length} markets, ${paths.rows.length} paths, ${want.size - 2} run files${stale.length ? `, removed ${stale.length} stale` : ''}`);
}
