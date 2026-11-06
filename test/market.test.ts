import { describe, expect, it } from 'vitest';
import { checkAgent, createListing, findBuyers, identity, keyStanding, listedEdges, market, markets, MarketError, publishListing, readListing, readiness, searchSellers, testEndpoint } from '../src/market/index.js';
import type { OnboardTransport } from '../src/onboard/index.js';

type Seen = { url: string; method: string; headers: Record<string, string>; body: unknown };
const KEY = 'mb_test_key_0123456789abcdef';
function transport(answer: (u: string, method: string) => [number, unknown], apiKey: string | undefined = KEY) {
  const seen: Seen[] = [];
  const t: OnboardTransport = {
    base: 'https://api.example/v1', ...(apiKey ? { apiKey } : {}),
    fetch: async (url, init) => {
      seen.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : undefined });
      const [status, body] = answer(url, init?.method ?? 'GET');
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    },
  };
  return { t, seen };
}
const AL = 'al_0123456789abcdef';

describe('market: buy', () => {
  it('searchSellers asks the matcher for a class, with only the filters given', async () => {
    const { t, seen } = transport(() => [200, { ok: true, hits: [{ name: 'Summary bot', venue: 'x402-base' }], n: 1 }]);
    const r = await searchSellers(t, { tag: ' text.summarize ', limit: 5 });
    expect(seen[0]!.url).toBe('https://api.example/v1/match/search?tag=text.summarize&limit=5');
    expect(r.hits[0]!.name).toBe('Summary bot'); expect(r.n).toBe(1);
    await expect(searchSellers(t, { tag: ' ' })).rejects.toThrow(RangeError);
  });
  it('markets and one market', async () => {
    const { t, seen } = transport((u) => [200, u.endsWith('/venues') ? { ok: true, markets: [{ id: 'x402-base' }], read_at: '2026-11-06T00:00:00Z' } : { ok: true, id: 'acp-base' }]);
    expect((await markets(t)).markets).toEqual([{ id: 'x402-base' }]);
    expect(await market(t, 'acp-base')).toMatchObject({ id: 'acp-base' });
    expect(seen.map((s) => s.url)).toEqual(['https://api.example/v1/venues', 'https://api.example/v1/venues/acp-base']);
    await expect(market(t, '../keys')).rejects.toThrow(RangeError);
  });
  it('listedEdges reads the edges of a class', async () => {
    const { t, seen } = transport(() => [200, { ok: true, rows: [{ edge_id: 'edge_1' }], total: 36 }]);
    expect(await listedEdges(t, { class: 'mcp.tool_call' })).toMatchObject({ total: 36, rows: [{ edge_id: 'edge_1' }] });
    expect(seen[0]!.url).toBe('https://api.example/v1/exchanges?class=mcp.tool_call');
  });
});

describe('market: sell', () => {
  it('findBuyers runs on your key, and says so without one', async () => {
    const { t, seen } = transport(() => [200, { ok: true, demands: [{ market: 'x402-base', buyers: 327 }] }]);
    expect((await findBuyers(t, { tag: 'text.summarize' })).demands).toEqual([{ market: 'x402-base', buyers: 327 }]);
    expect(seen[0]!.headers['x-api-key']).toBe(KEY);
    const none = transport(() => [200, {}], '');
    await expect(findBuyers(none.t, { tag: 'text.summarize' })).rejects.toMatchObject({ status: 401, code: 'key_required' });
    expect(none.seen).toHaveLength(0);
  });
  it('a listing: create, read, publish; the key goes in the header only', async () => {
    const { t, seen } = transport((u, m) => [m === 'POST' && u.endsWith('/agent-listings') ? 201 : 200, { ok: true, listing: { id: AL, status: u.endsWith('/publish') ? 'live' : 'draft' }, export: { x402: {} }, ...(u.endsWith('/publish') ? { probe: [{ class: 'text.summarize', ok: true }] } : {}) }]);
    expect((await createListing(t, { identity: { name: 'Summary bot', handle: 'summary-bot', tagline: 'Summaries.' }, hosting: { mode: 'self_hosted', door: { kind: 'a2a', endpoint: 'https://agent.example/a2a' } }, pricing: { seller_price_usd: '0.05', classes: ['text.summarize'], payout: '0x0000000000000000000000000000000000000001' } })).listing.id).toBe(AL);
    expect((await readListing(t, AL)).export).toEqual({ x402: {} });
    const live = await publishListing(t, AL);
    expect(live.listing.status).toBe('live'); expect(live.probes).toEqual([{ class: 'text.summarize', ok: true }]);
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([`POST https://api.example/v1/agent-listings`, `GET https://api.example/v1/agent-listings/${AL}`, `POST https://api.example/v1/agent-listings/${AL}/publish`]);
    expect(JSON.stringify(seen.map((s) => [s.url, s.body]))).not.toContain(KEY);
    await expect(readListing(t, 'al_../x')).rejects.toThrow(RangeError);
  });
  it('a refusal is a MarketError with the layer’s words, code and next step', async () => {
    const { t } = transport(() => [402, { ok: false, code: 'plan_allowance_used', error: 'the plan has no allowance left', next_step: { see: 'plans' } }]);
    const e = await readListing(t, AL).catch((x) => x);
    expect(e).toBeInstanceOf(MarketError);
    expect(e).toMatchObject({ status: 402, code: 'plan_allowance_used', nextStep: { see: 'plans' } });
  });
});

describe('market: check and key', () => {
  it('identity, readiness, check and test', async () => {
    const { t, seen } = transport((u) => [200, u.includes('/identity') ? { ok: true, agents: [{ id: 1 }] } : u.includes('/readiness') ? { ok: true, readiness: { hireable: true } } : { ok: true, goals: [] }]);
    expect(await identity(t, 8453, [1, 2])).toEqual([{ id: 1 }]);
    expect(await readiness(t, 8453, 1)).toEqual({ hireable: true });
    await checkAgent(t, { agent: '8453:1' });
    await testEndpoint(t, { url: 'https://agent.example/a2a' });
    expect(seen.map((s) => `${s.method} ${s.url.replace('https://api.example/v1', '')}`)).toEqual(['GET /agents/identity?chain=8453&ids=1%2C2', 'GET /agents/8453/1/readiness?tenant=moonbeam', 'POST /onboard/diagnose', 'POST /agents/probe']);
    expect(seen[2]!.body).toEqual({ agent: '8453:1' });
    await expect(checkAgent(t, { agent: 'nope' })).rejects.toThrow(RangeError);
    await expect(testEndpoint(t, { url: 'http://agent.example' })).rejects.toThrow(RangeError);
  });
  it('keyStanding reads the plan on your key', async () => {
    const { t } = transport(() => [200, { ok: true, plan: { name: 'Team', days_left: 20 } }]);
    expect((await keyStanding(t)).plan).toEqual({ name: 'Team', days_left: 20 });
  });
});
