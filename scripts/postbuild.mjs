#!/usr/bin/env node
// After tsc: copy the vendored payment scheme (a .mjs file tsc does not emit) and its types beside the built resale module, then
// publish the two vendored modules without their comments. The sources stay byte-identical to their pins (npm run check:pins);
// the published copies carry their code and data only, so the package speaks in Moonbeam's words (test/copy.test.ts).
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist', 'resale'), { recursive: true });
mkdirSync(join(root, 'dist', 'selection'), { recursive: true });
for (const f of ['selection.mjs', 'selection.d.mts']) copyFileSync(join(root, 'src', 'selection', f), join(root, 'dist', 'selection', f));
for (const f of ['payment-scheme.mjs', 'payment-scheme.d.mts']) copyFileSync(join(root, 'src', 'resale', f), join(root, 'dist', 'resale', f));
const pin = JSON.parse(readFileSync(join(root, 'src', 'resale', 'payment-scheme.pin.json'), 'utf8'));
writeFileSync(join(root, 'dist', 'resale', 'payment-scheme.pin.json'), JSON.stringify({
  about: 'Moonbeam’s one payment scheme (ONE_PAYMENT_SCHEME_v1), vendored: its source is pinned by this sha256; this published copy carries its code without comments',
  commit: pin.commit, sha256: pin.sha256,
}, null, 2) + '\n');

/** The file without its comments: every comment the parser finds is cut, and the blank lines it leaves are folded. */
export function stripComments(code, ts) {
  const ast = parse(code, { sourceType: 'module', plugins: ts ? [['typescript', { dts: true }]] : [], errorRecovery: false });
  let out = code;
  for (const c of [...ast.comments].sort((a, b) => b.start - a.start)) out = out.slice(0, c.start) + out.slice(c.end);
  out = out.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  parse(out, { sourceType: 'module', plugins: ts ? [['typescript', { dts: true }]] : [] }); // still parses
  return out;
}
for (const [f, ts] of [['resale/payment-scheme.mjs', false], ['resale/payment-scheme.d.mts', true], ['selection/selection.mjs', false], ['selection/selection.d.mts', true], ['assurance/assurance-shared.js', false], ['assurance/assurance-shared.d.ts', true]]) {
  const p = join(root, 'dist', f); const before = readFileSync(p, 'utf8'); const after = stripComments(before, ts);
  writeFileSync(p, after);
  rmSync(`${p}.map`, { force: true }); // its map pointed at the commented lines (the sourceMappingURL line was a comment too)
  console.log(`postbuild: dist/${f} published without comments (${before.length} → ${after.length} bytes)`);
}
console.log('postbuild: the vendored payment scheme sits beside dist/resale');
