#!/usr/bin/env node
// The two vendored files are byte-identical copies pinned by sha256: the assurance machine (src/assurance/assurance-shared.ts,
// re-synced with the layer's packages/assurance/scripts/sync.mjs --profile moonbeam) and the payment scheme
// (src/resale/payment-scheme.mjs). This checks the local copies against their pins (no network); with TAIFOON_AGENTS set to a
// checkout of the layer it also checks the scheme against the source file there.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
let bad = 0;
for (const [file, pin] of [['src/assurance/assurance-shared.ts', 'src/assurance/assurance-shared.pin.json'], ['src/resale/payment-scheme.mjs', 'src/resale/payment-scheme.pin.json']]) {
  const want = JSON.parse(readFileSync(join(root, pin), 'utf8')).sha256; const got = sha(join(root, file));
  if (want !== got) { console.error(`${file}: sha256 ${got} is not the pinned ${want} (the copy was edited: re-sync it)`); bad++; } else console.log(`${file}: pinned ${got.slice(0, 12)}… ok`);
}
const agents = process.env.TAIFOON_AGENTS;
if (agents) {
  const src = join(agents, 'packages', 'resale', 'core', 'payment-scheme.mjs');
  if (!existsSync(src)) { console.error(`TAIFOON_AGENTS: no ${src}`); bad++; }
  else if (sha(src) !== sha(join(root, 'src/resale/payment-scheme.mjs'))) { console.error(`src/resale/payment-scheme.mjs differs from ${src}: re-copy it and update the pin`); bad++; }
  else console.log('src/resale/payment-scheme.mjs: equals the layer’s source');
}
process.exit(bad ? 1 : 0);
