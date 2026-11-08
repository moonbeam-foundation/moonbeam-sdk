import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as market from '../src/market/index.js';
import * as jobs from '../src/jobs/index.js';
import * as resale from '../src/resale/index.js';
import { VENUE_REGISTER } from '../src/market/venues-data.js';
import type { OnboardTransport } from '../src/onboard/index.js';

const { VENUES, VENUE_IDS, VENUE_STEPS, VENUES_READ_ON, venues, SALE_STOPS, saleStop } = market;
type Seen = { url: string; method: string; headers: Record<string, string>; body: unknown };
const KEY = 'mb_test_key_0123456789abcdef';
function transport(answer: (u: string, method: string, body: unknown) => [number, unknown], apiKey: string | undefined = KEY) {
  const seen: Seen[] = [];
  const t: OnboardTransport = {
    base: 'https://api.example/v1', ...(apiKey ? { apiKey } : {}),
    fetch: async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      seen.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body });
      const [status, b] = answer(url, init?.method ?? 'GET', body);
      return { ok: status >= 200 && status < 300, status, json: async () => b };
    },
  };
  return { t, seen };
}
const MODULES: Record<string, Record<string, unknown>> = { market, jobs, resale };
const exported = (call: string) => { const [m, fn] = call.split('.'); return typeof MODULES[m!]?.[fn!] === 'function'; };
const REF = '8453:1170141';
const lst = (ref: string) => `lst_${createHash('sha256').update(`list:${ref}`).digest('hex').slice(0, 16)}`;
const AL = 'al_0123456789abcdef';

describe('VENUES: every venue, one table', () => {
  it('holds the ten markets of the register, in its order', () => {
    expect(VENUES.map((v) => v.id)).toEqual([...VENUE_IDS]);
    expect(VENUE_IDS).toEqual(['x402-base', 'erc8183-base', 'memoacp-base', 'bitagent-base', 'olas-base', 'near-agent-market', 'a2a', 'mcp', 'erc8004', 'workflow-nodes']);
    expect(VENUE_REGISTER.markets.map((m) => m.id)).toEqual([...VENUE_IDS]);
    expect(VENUES_READ_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('never sets a state: each comes from the register by one mapping, and n/a only where the market has no such step', () => {
    const WORD: Record<string, string> = { live: 'live', proven: 'live', partial: 'partial', self_test: 'self-test', claimed: 'not yet', contradicted: 'not yet', none: 'n/a' };
    for (const v of VENUES) {
      const r = VENUE_REGISTER.markets.find((m) => m.id === v.id)!;
      for (const k of VENUE_STEPS) {
        const s = v[k];
        expect(['live', 'partial', 'self-test', 'not yet', 'n/a'], `${v.id}.${k}`).toContain(s.state);
        const word = k === 'paid' ? r.paid?.proof : r[k].register;
        if (s.state !== 'n/a') expect(s.state, `${v.id}.${k}`).toBe(word ? WORD[word] ?? 'not yet' : 'not yet');
        else { expect(s.call, `${v.id}.${k} n/a has no call`).toBeNull(); expect(s.says, `${v.id}.${k} n/a says why`).toBeTruthy(); }
        if (s.state === 'live' || s.state === 'partial' || s.state === 'self-test') expect(s.read_on, `${v.id}.${k}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
  it('the states as read on the register snapshot', () => {
    const at = (id: string) => VENUES.find((v) => v.id === id)!;
    expect(VENUE_STEPS.map((k) => at('x402-base')[k].state)).toEqual(['live', 'live', 'live', 'not yet']);
    expect(VENUE_STEPS.map((k) => at('erc8183-base')[k].state)).toEqual(['not yet', 'self-test', 'self-test', 'self-test']);
    expect(VENUE_STEPS.map((k) => at('erc8004')[k].state)).toEqual(['live', 'n/a', 'n/a', 'n/a']);
  });
  it('every call named is really exported, by its module', () => {
    for (const v of VENUES) for (const k of VENUE_STEPS) { const c = v[k].call; if (c) expect(exported(c), `${v.id}.${k}: ${c}`).toBe(true); }
    expect(VENUES.filter((v) => v.listedBy === 'list-step').map((v) => v.id)).toEqual(['a2a', 'mcp', 'erc8004']);
  });
  it('public text: no internal host, no workflow-tool name, no address, no test-network id', () => {
    expect(JSON.stringify(VENUES)).not.toMatch(/taifoon|\bn8n\b|0x[0-9a-f]{40}|36927/i);
    expect(readFileSync(new URL('../src/market/venues-register.json', import.meta.url), 'utf8')).not.toMatch(/taifoon|\bn8n\b|0x[0-9a-f]{40}/i);
  });
  it('docs/VENUES.md and the README say the same states as the table', () => {
    const doc = readFileSync(new URL('../docs/VENUES.md', import.meta.url), 'utf8');
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const c = (s: market.VenueStepRow) => s.state + (s.call ? ` · \`${s.call}\`` : '');
    for (const v of VENUES) {
      expect(doc, v.id).toContain(`| ${v.name} | ${c(v.list)} | ${c(v.take)} | ${c(v.settle)} | ${c(v.paid)} |`);
      expect(readme, v.id).toMatch(new RegExp(`\\| ${v.list.state} \\| ${v.take.state} · ${v.settle.state} \\|`));
    }
    for (const s of SALE_STOPS) expect(doc, s.id).toContain(`| ${s.order} | \`${s.id}\` | ${s.label} |`);
    expect(`${doc}\n${readme}`).not.toMatch(/taifoon|\bn8n\b|0x[0-9a-f]{40}|36927/i);
  });
  it('venues() answers the shipped table without a transport', async () => {
    const r = await venues();
    expect(r.venues).toHaveLength(10); expect(r.readOn).toBe(VENUES_READ_ON); expect(r.readAt).toBeNull(); expect(r.unread).toEqual([]);
  });
  it('venues(t, { agent }) folds in the markets\' own reads and the agent\'s list step, never a state', async () => {
    const { t, seen } = transport((u) => u.endsWith('/venues')
      ? [200, { ok: true, read_at: '2026-11-08T10:00:00Z', markets: [{ id: 'x402', name: 'x402 Bazaar', status: 'discover-only', usd_7d: 400544.75 }, { id: 'olas', name: 'Olas Mech marketplace', status: 'live', usd_7d: 74.57 }] }]
      : [200, { list: { id: lst(REF), agent: { ref: REF, name: 'a', class: 'mcp.digest', offer_usdc: null }, markets: { mcp_registry: { state: 'listed', why: null, url: 'https://registry.example/x', tx: null } } } }]);
    const r = await venues(t, { agent: REF });
    expect(seen.map((s) => s.url).sort()).toEqual(['https://api.example/v1/list/' + lst(REF), 'https://api.example/v1/venues']);
    const x = r.venues.find((v) => v.id === 'x402-base')!;
    expect(x.market).toEqual({ name: 'x402 Bazaar', status: 'discover-only', usd_7d: 400544.75 });
    expect(x.list.state).toBe('live');
    const mcp = r.venues.find((v) => v.id === 'mcp')!;
    expect(mcp.agentListing).toMatchObject({ state: 'listed' }); expect(mcp.list.state).toBe('partial');
    expect(r.venues.find((v) => v.id === 'a2a')!.agentListing).toBeNull();
    expect(r.readAt).toBe('2026-11-08T10:00:00Z');
  });
  it('a read that fails is named, and the shipped table answers', async () => {
    const { t } = transport(() => [503, { ok: false, error: 'down' }]);
    const r = await venues(t, { agent: REF });
    expect(r.venues.map((v) => v.list.state)).toEqual(VENUES.map((v) => v.list.state));
    expect(r.unread).toHaveLength(2);
  });
});

describe('SALE_STOPS: one sale, stop by stop, paired 1:1 with the Studio', () => {
  const IDS = ['studio', 'offer-in', 'classify', 'listed', 'quote', 'edges', 'hired', 'delivered', 'graded', 'settled', 'legs', 'accrued', 'split', 'vault', 'paid', 'recorded', 'usage'];
  it('17 stops, in order, with stable fields', () => {
    expect(SALE_STOPS.map((s) => s.id)).toEqual(IDS);
    expect(SALE_STOPS.map((s) => s.order)).toEqual(IDS.map((_, i) => i + 1));
    for (const s of SALE_STOPS) expect(Object.keys(s).sort()).toEqual(['call', 'fn', 'hop', 'id', 'label', 'module', 'needs', 'order', 'route', 'studio']);
  });
  it('each stop has exactly one SDK call, and it is really exported', () => {
    const bin = readFileSync(new URL('../bin/moonbeam.mjs', import.meta.url), 'utf8');
    for (const s of SALE_STOPS) {
      expect(typeof s.call, s.id).toBe('string'); expect(s.call.split(/[\s,;|]+/).filter((w) => /^(market|resale)\./.test(w)).length, s.id).toBeLessThanOrEqual(1);
      if (s.module === 'cli') { expect(s.call).toBe(`npx moonbeam ${s.fn}`); expect(bin).toContain(`cmd === '${s.fn}'`); continue; }
      expect(['market', 'resale']).toContain(s.module);
      expect(s.call).toBe(`${s.module}.${s.fn}`);
      expect(exported(s.call), s.call).toBe(true);
      expect(s.needs === 'offline').toBe(s.route === null);
    }
  });
  it('the pairing the Studio shows', () => {
    expect(Object.fromEntries(SALE_STOPS.map((s) => [s.id, s.call]))).toEqual({
      studio: 'npx moonbeam workflows', 'offer-in': 'market.searchSellers', classify: 'market.checkAgent', listed: 'market.publishListing',
      quote: 'resale.quoteSale', edges: 'market.layerListings', hired: 'market.hirePlan', delivered: 'market.handOver', graded: 'market.composeGrade',
      settled: 'market.jobRecord', legs: 'resale.legsByName', accrued: 'market.saleLedger', split: 'market.payoutQueues', vault: 'market.vaultPolicy',
      paid: 'market.claimablePayouts', recorded: 'market.saleRecord', usage: 'market.keyStanding',
    });
    expect(saleStop('tutorial-stop:paid')?.route).toBe('GET /pipe/claimable');
    expect(saleStop('nope')).toBeNull();
  });
});

describe('the journey as calls', () => {
  it('listIdOf derives the layer\'s id', async () => {
    expect(await market.listIdOf(REF)).toBe(lst(REF));
    await expect(market.listIdOf('1:2')).rejects.toThrow(RangeError);
  });
  it('listOn asks on your key; listStatus reads, null when never listed', async () => {
    const view = { id: lst(REF), agent: { ref: REF, name: 'a', class: 'mcp.digest', offer_usdc: null }, markets: { erc8004: { state: 'queued', why: null, url: null, tx: null } }, fee: { usdc: '0' } };
    const { t, seen } = transport((u, m) => (m === 'POST' ? [202, { list: view }] : u.endsWith(lst('8453:2')) ? [404, { ok: false, code: 'not_found' }] : [200, { list: view }]));
    expect((await market.listOn(t, REF, ['erc8004'])).fee).toEqual({ usdc: '0' });
    expect(seen[0]).toMatchObject({ method: 'POST', url: 'https://api.example/v1/list', body: { agent: REF, markets: ['erc8004'] } });
    expect(seen[0]!.headers['x-api-key']).toBe(KEY);
    expect((await market.listStatus(t, REF))?.id).toBe(lst(REF));
    expect(await market.listStatus(t, '8453:2')).toBeNull();
    await expect(market.listOn(t, REF, ['virtuals' as never])).rejects.toThrow(RangeError);
    const none = transport(() => [200, {}], '');
    await expect(market.listOn(none.t, REF)).rejects.toMatchObject({ status: 401, code: 'key_required' });
    expect(none.seen).toHaveLength(0);
  });
  it('pause, go live again, delist (for good, confirmed)', async () => {
    const { t, seen } = transport((u, _m, b) => [200, { ok: true, listing: { id: AL, status: u.endsWith('/publish') ? 'live' : (b as { status: string }).status }, ...(u.endsWith('/publish') ? { probe: [] } : {}) }]);
    expect((await market.pauseListing(t, AL)).listing.status).toBe('paused');
    expect((await market.resumeListing(t, AL)).listing.status).toBe('live');
    await expect(market.delistListing(t, AL, { confirm: 'al_ffffffffffffffff' })).rejects.toThrow(/for good/);
    expect((await market.delistListing(t, AL, { confirm: AL })).listing.status).toBe('archived');
    expect(seen.map((s) => `${s.method} ${s.url.replace('https://api.example/v1', '')} ${JSON.stringify(s.body)}`)).toEqual([
      `POST /agent-listings/${AL} {"status":"paused"}`, `POST /agent-listings/${AL}/publish {}`, `POST /agent-listings/${AL} {"status":"archived"}`]);
  });
  it('register8004Calls: the listing\'s own file inline, the call unsigned, the signer named', async () => {
    const reg = { type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'Summary bot' };
    const { t, seen } = transport((u) => u.endsWith('/assurance/call')
      ? [200, { ok: true, calls: [{ action: 'register-8004', chainId: 8453, to: '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432', data: '0xf2c298be', value: '0' }] }]
      : [200, { ok: true, listing: { id: AL }, export: { erc8004: { exportable: true, registration: reg } } }]);
    const r = await market.register8004Calls(t, AL);
    expect(r.sent).toBe(false); expect(r.signer).toMatch(/your wallet/);
    expect(r.uri).toBe(`data:application/json;base64,${Buffer.from(JSON.stringify(reg)).toString('base64')}`);
    expect(seen[1]!.body).toEqual({ chainId: 8453, action: { kind: 'register-8004', agentURI: r.uri } });
    expect(r.calls).toHaveLength(1);
    expect(market.inlineRegistration({ exportable: true, registration: { d: 'x'.repeat(3000) } })).toMatchObject({ ok: false });
    expect(market.inlineRegistration({ exportable: false, why: ['no door'], registration: reg })).toEqual({ ok: false, why: 'no door' });
  });
  it('usage and keys read on your key', async () => {
    const { t, seen } = transport((u) => [200, u.includes('/access/usage') ? { families: { rpc: { calls: 3 } }, total: { calls: 3 }, by_day: [], keys: [] } : { keys: [{ prefix: 'mb_' }], recent_changes: [] }]);
    expect((await market.usage(t)).families).toEqual({ rpc: { calls: 3 } });
    expect((await market.tenantKeys(t)).keys).toEqual([{ prefix: 'mb_' }]);
    expect(seen.map((s) => s.url)).toEqual(['https://api.example/v1/access/usage?window=month&scope=tenant', 'https://api.example/v1/tenant/keys']);
  });
  it('planOffers reads the 402 answer, sends no key and asks for no key', async () => {
    const { t, seen } = transport(() => [402, { ok: false, code: 'payment_required', offer: { usdc: 1, units: '1000000', what: '1 USDC on the key\'s balance' },
      monthly: { plans: [{ plan: 'builder', usdc: 99, includes_usdc: 110, per_minute: 1000, days: 30 }, { plan: 'team', usdc: 199, days: 30 }, { plan: 'protocol', usdc: 299, days: 30 }] },
      accepts: [{ network: 'eip155:8453' }, { network: 'eip155:8453' }] }]);
    const r = await market.planOffers(t);
    expect(r.topup).toEqual({ usdc: 1, units: '1000000', what: '1 USDC on the key\'s balance' });
    expect(r.plans.map((p) => [p.plan, p.usdc, p.days])).toEqual([['builder', 99, 30], ['team', 199, 30], ['protocol', 299, 30]]);
    expect(r.networks).toEqual(['eip155:8453']);
    expect(seen[0]!.body).toEqual({}); expect(seen[0]!.headers['x-api-key']).toBeUndefined();
    const minted = transport(() => [201, { api_key: 'x' }]);
    await expect(market.planOffers(minted.t)).rejects.toBeInstanceOf(market.MarketError);
  });
  it('agentSales reads the sale run\'s slice, the layer\'s own hosts said as ours', async () => {
    const slice = (key: string, kind: string, sales: number) => ({ key, kind, sales, buyer_paid_units: '100849', seller_share_units: '1', first_at: null, last_at: null, split: {}, held_by: {}, venues: { 'x402-base': sales }, days: [],
      recent: [{ at: null, class: 'mcp.digest', seller: 'gpu.taifoon.example', venue_in: 'x402-base', venue_out: 'mcp', network: '8453', buyer_paid_units: '1200', seller_share_units: '1000', share: 'kept', held_by: null, tx: '0x01' }] });
    const { t, seen } = transport(() => [200, { generated_at: '2026-11-08T15:58:00Z', by_agent: { rule: 'SALE_SLICES_v1', days: ['2026-11-08'], slices: [slice('class:mcp.digest', 'class', 14)] } }]);
    const r = await market.agentSales(t, 'mcp.digest', { salesUrl: 'https://sales.example/run.json' });
    expect(seen[0]!.url).toBe('https://sales.example/run.json'); expect(seen[0]!.headers['x-api-key']).toBeUndefined();
    expect(r?.slice.sales).toBe(14); expect(r?.slice.recent[0]!.seller).toBe('ours'); expect(r?.readAt).toBe('2026-11-08T15:58:00Z');
    expect(await market.agentSales(t, 'class:risk.address', { salesUrl: 'https://sales.example/run.json' })).toBeNull();
    await expect(market.agentSales(t, 'mcp.digest', { salesUrl: 'http://x' })).rejects.toThrow(RangeError);
  });
  it('olasRequest takes the marketplace\'s 32-byte id', async () => {
    const { t, seen } = transport(() => [200, { ok: true, facts: [] }]);
    await market.olasRequest(t, `0x${'ab'.repeat(32)}`);
    expect(seen[0]!.url).toBe(`https://api.example/v1/judge/evidence/olas/0x${'ab'.repeat(32)}`);
    await expect(market.olasRequest(t, '1')).rejects.toThrow(RangeError);
  });
});

describe('the sale\'s reads', () => {
  it('saleLedger, payoutQueues, claimablePayouts, saleRecord: one GET each', async () => {
    const { t, seen } = transport((u) => {
      if (u.endsWith('/resale')) return [200, { rule: 'a buyer pays once', counts: { routes: 776 }, routes: [{ id: 'r1' }], next: [] }];
      if (u.endsWith('/pipe/queues')) return [200, { at: 1, queues: [{ name: 'settle', why: 'claimable' }], chains: { 'eip155:8453': { settle: { depth: 9, oldest_s: 5 } } } }];
      if (u.includes('/pipe/claimable')) return [200, { at: 1, count: 1, envelopes: [{ id: '0x01', chain: 'eip155:8453', kind: 'settle', venue: 'coord', due: 2, needs_signature: false, open_steps: [] }], how: 'take an open step' }];
      return [200, { root: 'ab', timestamp: 3, leaf_count: 10, peak_count: 2, chains_included: [8453, 1284] }];
    }, '');
    expect((await market.saleLedger(t)).counts).toEqual({ routes: 776 });
    expect((await market.payoutQueues(t)).chains['eip155:8453']?.settle?.depth).toBe(9);
    expect((await market.claimablePayouts(t)).payouts[0]).toMatchObject({ id: '0x01', chain: 'eip155:8453', needs_signature: false });
    expect(await market.saleRecord(t)).toEqual({ root: 'ab', timestamp: 3, leafCount: 10, peakCount: 2, chains: [8453, 1284] });
    expect(seen.map((s) => s.url.replace('https://api.example/v1', ''))).toEqual(['/resale', '/pipe/queues', '/pipe/claimable', '/root']);
  });
  it('vaultPolicy carries the rule and the vaults by id, never their addresses', async () => {
    const { t } = transport(() => [200, { ok: true, policy: { allow: ['register-agent'], chains: [8453], maxValueWei: '0', perHour: 20, requiresHuman: ['give-feedback'] },
      registry: [{ id: 'vault:a', kind: 'signer', address: `0x${'1'.repeat(40)}`, chains: ['eip155:8453'], assets: ['USDC'] }], note: 'moves no funds' }]);
    const r = await market.vaultPolicy(t);
    expect(r.rule).toEqual({ allow: ['register-agent'], chains: [8453], maxValueWei: '0', perHour: 20, requiresHuman: ['give-feedback'] });
    expect(r.vaults).toEqual([{ id: 'vault:a', kind: 'signer', chains: ['eip155:8453'], assets: ['USDC'] }]);
    expect(JSON.stringify(r)).not.toMatch(/0x[0-9a-f]{40}/i);
  });
});
