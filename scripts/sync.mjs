#!/usr/bin/env node
// Re-sync the two vendored files from the coordination layer's sources, the way @taifoon/jev and taifoon-sdk do it:
//   src/assurance/assurance-shared.ts  ← packages/assurance (scripts/sync.mjs --profile moonbeam: the machine, the Moonbeam
//                                         venue and the attestation helper, one import-free file + its pin)
//   src/resale/payment-scheme.mjs      ← packages/resale/core/payment-scheme.mjs (byte for byte + its pin)
// TAIFOON_AGENTS names a checkout of the layer's source repository.
//   TAIFOON_AGENTS=<dir> node scripts/sync.mjs           write both copies and their pins
//   TAIFOON_AGENTS=<dir> node scripts/sync.mjs --check   exit 1 when either copy differs from the source
//   node scripts/sync.mjs --check                        without a checkout: the copies against their pins only
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const agents = process.env.TAIFOON_AGENTS ? resolve(process.env.TAIFOON_AGENTS) : null;
const check = process.argv.includes('--check');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const ASSURANCE_DIR = join(root, 'src', 'assurance');
const SCHEME = join(root, 'src', 'resale', 'payment-scheme.mjs');
const SCHEME_PIN = join(root, 'src', 'resale', 'payment-scheme.pin.json');

if (!agents) {
  execFileSync(process.execPath, [join(root, 'scripts', 'check-pins.mjs')], { stdio: 'inherit' });
  if (!check) { console.error('set TAIFOON_AGENTS to a checkout of the layer to re-sync'); process.exit(2); }
  process.exit(0);
}
const assuranceSync = join(agents, 'packages', 'assurance', 'scripts', 'sync.mjs');
const schemeSrc = join(agents, 'packages', 'resale', 'core', 'payment-scheme.mjs');
for (const p of [assuranceSync, schemeSrc]) if (!existsSync(p)) { console.error(`TAIFOON_AGENTS: no ${p}`); process.exit(2); }

let bad = 0;
try { execFileSync(process.execPath, [assuranceSync, ASSURANCE_DIR, '--profile', 'moonbeam', ...(check ? ['--check'] : [])], { stdio: 'inherit' }); } catch { bad++; }
const commit = (() => { try { return execFileSync('git', ['-C', agents, 'rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })();
const body = readFileSync(schemeSrc);
if (check) {
  if (sha(readFileSync(SCHEME)) !== sha(body)) { console.error('src/resale/payment-scheme.mjs differs from the layer’s packages/resale/core/payment-scheme.mjs: run sync again'); bad++; }
  else if (JSON.parse(readFileSync(SCHEME_PIN, 'utf8')).sha256 !== sha(body)) { console.error('src/resale/payment-scheme.pin.json is stale'); bad++; }
  else console.log(`src/resale/payment-scheme.mjs equals the layer’s source (${commit})`);
} else {
  writeFileSync(SCHEME, body);
  const pin = JSON.parse(readFileSync(SCHEME_PIN, 'utf8'));
  writeFileSync(SCHEME_PIN, JSON.stringify({ ...pin, commit, sha256: sha(body) }, null, 2) + '\n');
  console.log(`synced src/resale/payment-scheme.mjs (${commit})`);
}
process.exit(bad ? 1 : 0);
