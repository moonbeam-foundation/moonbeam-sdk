// _SELECTION_v1_: the pick runs the same paths as the Studio. The golden cases of the shared core (src/selection/selection-cases.json,
// vendored with it) give the same answers through this SDK's functions, and quote / hire send the same body to the same operation as
// every other surface. The core and its language are the vendored bytes (GENERATED.json pins each file).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PICK_ROLE, hire, hireBody, movesOf, quote, readAnswer, refOf, resolveRef } from '../src/market/index.js';
import type { OnboardTransport } from '../src/onboard/index.js';
import { SELECTION_LANG } from '../src/selection/lang-data.js';

const dir = join(__dirname, '..', 'src', 'selection');
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
type Case<I, O> = I & { out: O };
const V = read('selection-cases.json') as {
  refs: Case<{ in: unknown }, { ok: boolean; text?: string; reason?: string }>[];
  hires: Case<{ need: string; o: { ref?: string; run?: boolean } }, unknown>[];
  answers: Case<{ body: unknown; role: string }, unknown>[];
  moves: Case<{ ref: string; o: { need?: string; signedIn?: boolean } }, unknown>[];
};

function transport(answer: unknown, apiKey: string | undefined = 'mb_test_key_0123456789abcdef') {
  const seen: { url: string; method: string; body: unknown }[] = [];
  const t: OnboardTransport = {
    base: 'https://api.example/v1', ...(apiKey ? { apiKey } : {}),
    fetch: async (url, init) => { seen.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined }); return { ok: true, status: 200, json: async () => answer }; },
  };
  return { t, seen };
}

describe('the pick: the shared core, vendored as is', () => {
  it('each vendored file is the byte copy GENERATED.json pins', () => {
    const g = read('GENERATED.json') as { rows: { files: { file: string; sha256: string }[] }[] };
    for (const f of g.rows.flatMap((r) => r.files)) expect(createHash('sha256').update(readFileSync(join(dir, f.file))).digest('hex'), f.file).toBe(f.sha256);
  });
  it('the shipped language is the vendored one, and names no venue of the house', () => {
    const pub = read('selection.public.json') as Record<string, unknown>;
    const { schema: _s, source: _src, ...lang } = pub;
    expect(SELECTION_LANG).toEqual(lang);
    expect(JSON.stringify(SELECTION_LANG)).not.toMatch(/taifoon/i);
  });
});

describe('the pick: the golden cases through the SDK', () => {
  it('ids read as their refs', () => { for (const c of V.refs) { const r = refOf(c.in as string); expect(r.ok ? { ok: true, text: r.text } : r, JSON.stringify(c.in)).toEqual(c.out); } });
  it('one hire body', () => { for (const c of V.hires) expect(hireBody(c.need, c.o)).toEqual(c.out); });
  it('answers per role; this SDK is the reseller and keeps operation links only', () => {
    expect(PICK_ROLE).toBe('reseller');
    for (const c of V.answers) expect(readAnswer(c.body, c.role)).toEqual(c.out);
    const reseller = V.answers.filter((c) => c.role === PICK_ROLE);
    expect(reseller.length).toBeGreaterThan(0);
    for (const c of reseller) expect(readAnswer(c.body)).toEqual(c.out);
  });
  it('moves', () => { for (const c of V.moves) { const r = refOf(c.ref); if (!r.ok) throw new Error(c.ref); expect(movesOf(r.ref, c.o)).toEqual(c.out); } });
});

describe('the pick: the same operations as the Studio', () => {
  const NEED = 'count the words';
  const REF = 'agent:erc8004:8453:59272';
  it('quote sends the dry run of the pick to POST /demands', async () => {
    const { t, seen } = transport({ ok: true, dry_run: true, picked: { ref: REF, via: 'registry', catalog_id: 'cat_1', seller: 'seller-1' } });
    const r = await quote(t, NEED, { ref: REF });
    expect(seen).toEqual([{ url: 'https://api.example/v1/demands', method: 'POST', body: hireBody(NEED, { ref: REF }) }]);
    expect(readAnswer(r).seller).toBe('seller-1');
  });
  it('hire sends the hire of the pick, with a key only', async () => {
    const { t, seen } = transport({ ok: true, demand: { id: 'dm_1' }, links: { commerce: '/studio/commerce?job=dm_1', status: '/v1/demands/dm_1' } });
    const r = await hire(t, NEED, { ref: REF });
    expect(seen[0]!.body).toEqual(hireBody(NEED, { ref: REF, run: true }));
    expect(readAnswer(r).links).toEqual({ status: '/v1/demands/dm_1' });
    await expect(hire(transport({}, '').t, NEED, { ref: REF })).rejects.toThrow(/key/);
  });
  it('resolveRef reads GET /ref/:ref with the need', async () => {
    const { t, seen } = transport({ ok: true, ref: { kind: 'agent', venue: 'erc8004', native: '8453:59272' }, text: REF, seller: null, moves: [] });
    await resolveRef(t, '8453:59272', { need: NEED });
    expect(seen[0]!.url).toBe('https://api.example/v1/ref/8453%3A59272?need=count+the+words');
  });
});
