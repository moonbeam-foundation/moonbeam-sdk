// The package speaks in Moonbeam's words. Every file `npm pack` ships (and the CHANGELOG) is read for the phrases the owner's
// copy rules forbid: "the layer", a listing price that invents a markup on a seller's price ("price + N%", "resold at", "×1.2":
// listing prices are undercut only), the operator's own names, the workflow tool's name, and "checked before you pay". A
// reseller's own markup on its child keys is a tenant feature, not a listing price: lines naming the reseller API are not read
// for the listing rule. The tokens a wire or a chain fixes are cut first, by name; the two vendored modules keep their remaining
// data strings, counted here, until they are re-synced from an updated source (their pins: npm run check:pins).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const FORBIDDEN: Record<string, RegExp> = {
  'the layer': /\bthe layer\b/gi,
  'a listing markup': /\bprice\s*\+\s*\d+(?:[.,]\d+)?\s*%|\+\s?\d+(?:[.,]\d+)?\s?%|\bresold at\b|(?:×|\bx)\s?1\.\d+\b/gi,
  'the operator\'s name': /taifoon/gi,
  'the workflow tool': /\bn8n\b/gi,
  'checked before you pay': /checked before you pay/gi,
};
/** Fixed by a wire, a package name or a chain: cut before the scan. */
const WIRE: RegExp[] = [
  /@taifoon\/jev(?:-wilson)?\b/g,                       // the grader's packages (dependencies and imports)
  /taifoon\.(?:decision|stamp)\.subject\.v1/g,          // the keccak domains of the on-chain subjects
  /taifoon\.payment\.(?:scheme|quote)\.v1/g,            // the payment scheme's schema ids
  /\b(?:reseller_markup|markup_bps|markup_units)\b/g,   // ledger and request field names
  /['"]n8n['"]/g,                                       // the onboard protocol and own label value
  /\/taifoon\|n8n\|genie\/i/g,                          // the journey's scrubber, which removes these words
];
/** The vendored modules' remaining data strings, after their comments are cut (scripts/postbuild.mjs). It may only fall. */
const VENDORED: Record<string, Partial<Record<string, number>>> = {
  'dist/assurance/assurance-shared.js': { 'the layer': 8, "the operator's name": 6 },
  'dist/assurance/assurance-shared.d.ts': { 'the layer': 9, "the operator's name": 2 },
  'dist/resale/payment-scheme.mjs': { 'the layer': 2, 'the workflow tool': 1 },
  'dist/resale/payment-scheme.d.mts': {},
};

const packed = (): string[] => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return (JSON.parse(out) as { files: { path: string }[] }[])[0]!.files.map((f) => f.path);
};
/** The reseller API and its own doc lines: a tenant's chosen markup on its child keys (kept since 0.12.0; owner, 11-14). */
const RESELLER_API = /\b(?:markupLeg|MarkupPolicy|Reseller|reseller|resellers|childKeyTerms|childKeyPlan|resellerChildren|child keys?|MARKUP_BPS|markup_bps|markup_units|reseller_markup)\b/;
const found = (text: string): Record<string, number> => {
  let t = text; for (const w of WIRE) t = t.replace(w, '');
  const listing = t.split('\n').filter((l) => !RESELLER_API.test(l)).join('\n');
  const n: Record<string, number> = {};
  for (const [k, r] of Object.entries(FORBIDDEN)) { const c = ((k === 'a listing markup' ? listing : t).match(r) ?? []).length; if (c) n[k] = c; }
  return n;
};

describe('copy: every shipped file, in Moonbeam\'s words', () => {
  it('the package is built, so the scan reads what npm would publish', () => {
    expect(existsSync(join(root, 'dist', 'index.js')), 'run npm run build first').toBe(true);
  });
  it('no shipped file and no CHANGELOG line says a forbidden phrase', () => {
    const files = [...packed(), 'CHANGELOG.md'];
    expect(files.length).toBeGreaterThan(100);
    expect(files).toEqual(expect.arrayContaining(['README.md', 'docs/VENUES.md', 'dist/market/venues-data.js', 'package.json']));
    const bad: string[] = [];
    for (const f of files) {
      if (!/\.(?:m?js|d\.m?ts|ts|json|md|txt|svg|mjs|cjs|ya?ml)$/.test(f)) continue;
      const n = found(readFileSync(join(root, f), 'utf8'));
      const allowed = VENDORED[f] ?? {};
      for (const [k, c] of Object.entries(n)) if (c > (allowed[k] ?? 0)) bad.push(`${f}: ${c} × ${k}${allowed[k] ? ` (vendored residue: at most ${allowed[k]})` : ''}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);
  it('the vendored modules ship without their comments', () => {
    for (const f of Object.keys(VENDORED)) expect(readFileSync(join(root, f), 'utf8'), f).not.toMatch(/^\s*(?:\/\/|\/\*|\*)/m);
  });
  it('the scan catches each phrase', () => {
    expect(found('the layer holds it; Taifoon; n8n; checked before you pay')).toEqual(
      { 'the layer': 1, "the operator's name": 1, 'the workflow tool': 1, 'checked before you pay': 1 });
    for (const listing of ['the buyer pays the price + 20 %', 'listed at +20%', 'resold at a premium', 'buyer price = seller price ×1.2', 'x1.25 the ask'])
      expect(found(listing), listing).toEqual({ 'a listing markup': 1 });
    expect(found("import '@taifoon/jev'; { leg: 'reseller_markup' }; protocol: 'n8n'")).toEqual({});
    // a tenant's own markup on its child keys is the reseller API, not a listing price
    expect(found("childKeyPlan({ '*': 200 }); // the reseller's own markup, +2 % on its child keys")).toEqual({});
    expect(found('the markup is the reseller’s own leg')).toEqual({});
  });
});
