// 0.13.0: journey(t, ref) reads listed.journey.v1; list(t, { venue, agent, custom }) plans a Virtuals ACP listing from the
// venue's own record (genie.list.virtuals.v1), read and plan only.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as market from '../src/market/index.js';
import type { OnboardTransport } from '../src/onboard/index.js';

const { journey, journeyOf, track, trackOf, TRACK_SCHEMA, list, JOURNEY_LEDS, LIST_STEPS, LIST_VENUES, HOUSE_AGENTS, VENUE_IDS, MarketError } = market;
type Seen = { url: string; method: string; headers: Record<string, string>; body: unknown };
function transport(answer: (u: string, method: string) => [number, unknown], apiKey?: string) {
  const seen: Seen[] = [];
  const t: OnboardTransport = {
    base: 'https://api.example/v1', ...(apiKey ? { apiKey } : {}),
    fetch: async (url, init) => {
      seen.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body });
      const [status, b] = answer(url, init?.method ?? 'GET');
      return { ok: status >= 200 && status < 300, status, json: async () => b };
    },
  };
  return { t, seen };
}
// a live answer of 2026-11-15 for Moonbeam's house agent 8453:1170141 (its key offer dropped)
const SAMPLE = JSON.parse(readFileSync(new URL('./fixtures/listed/journey-1170141.json', import.meta.url), 'utf8'));
const copy = () => JSON.parse(JSON.stringify(SAMPLE));

describe('journey: one agent on every venue (listed.journey.v1)', () => {
  it('reads GET /listed?agent=<ref>&view=journey, public, and keys the venues by every VENUE_ID', async () => {
    const { t, seen } = transport(() => [200, SAMPLE]);
    const j = await journey(t, ' 8453:1170141 ');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://api.example/v1/listed?agent=8453%3A1170141&view=journey');
    expect(seen[0]!.method).toBe('GET'); expect(seen[0]!.headers['x-api-key']).toBeUndefined();
    expect(j.schema).toBe('listed.journey.v1');
    expect(Object.keys(j.venues)).toEqual([...VENUE_IDS]);
    expect(j.agent).toMatchObject({ ref: '8453:1170141', kind: 'house', class: 'mcp.digest' });
    expect(j.extra).toEqual([]);
    expect(j.body).toBe(SAMPLE);
  });
  it('every venue carries five LEDs, each with state, why, evidence and moves_when; an LED is on only with a read', async () => {
    const j = journeyOf(copy());
    for (const id of VENUE_IDS) {
      const v = j.venues[id];
      expect(Object.keys(v.leds).sort(), id).toEqual([...JOURNEY_LEDS].sort());
      for (const k of JOURNEY_LEDS) {
        const l = v.leds[k];
        expect(['on', 'partial', 'off', 'unread'], `${id}.${k}`).toContain(l.state);
        expect(typeof l.why).toBe('string'); expect(typeof l.moves_when).toBe('string'); expect(Array.isArray(l.evidence)).toBe(true);
        if (l.state === 'on') expect(l.evidence.length, `${id}.${k} is on with a read`).toBeGreaterThan(0);
      }
      // listed already: never a list action, and the list LED is on with the proof
      if (v.standing === 'listed_by_moonbeam' || v.standing === 'listed_by_owner') { expect(v.next.act).not.toBe('list'); expect(v.leds.list.state).toBe('on'); expect(v.proof).toBeTruthy(); }
      if (v.next.by === 'human') expect(v.next.human!.steps.at(-1)).toContain(v.next.human!.url);
    }
    // as read: Moonbeam's Virtuals agent shows this house agent's offering
    expect(j.venues['erc8183-base']).toMatchObject({ standing: 'listed_by_moonbeam', proof: { kind: 'virtuals.agent' } });
    expect(j.venues['memoacp-base'].standing).toBe('closed');
    expect(['probe', 'grade'].map((k) => j.checks[k as 'probe' | 'grade'].state)).toEqual(['unread', 'unread']);
  });
  it('takes every ref the route takes, and refuses anything else before a read', async () => {
    const { t, seen } = transport(() => [200, SAMPLE]);
    for (const r of ['8453:1170141', 'erc8004:8453:1170141', 'x402:aeee48228a95', 'x402:host:hubvibe-io.com', 'virtuals:0123456789ab', 'near:0123456789ab']) await journey(t, r);
    expect(seen).toHaveLength(6);
    for (const bad of ['', 'foo', '8453:', 'x402:XYZ', 'virtuals:0123', '8453:1;drop']) await expect(journey(t, bad), bad).rejects.toThrow(RangeError);
    expect(seen).toHaveLength(6);
  });
  it('a body that breaks the schema is refused: another schema, a missing venue', () => {
    expect(() => journeyOf({ ...copy(), schema: 'listed.journey.v0' })).toThrow(MarketError);
    const lacks = copy(); lacks.venues = lacks.venues.filter((v: { venue_id: string }) => v.venue_id !== 'mcp');
    expect(() => journeyOf(lacks)).toThrow(/no row for mcp/);
  });
  it('a venue the SDK does not know yet is named in extra, the known ten still keyed', () => {
    const more = copy(); more.venues.push({ ...more.venues[0], venue_id: 'new-market' });
    const j = journeyOf(more);
    expect(j.extra).toEqual(['new-market']); expect(Object.keys(j.venues)).toHaveLength(10);
  });
  it('a refusal is a MarketError with the route\'s code', async () => {
    const { t } = transport(() => [400, { ok: false, code: 'bad_param', param: 'agent', error: 'view=journey takes agent=<ref>' }]);
    const e = await journey(t, '8453:1').catch((x) => x);
    expect(e).toBeInstanceOf(MarketError); expect(e.status).toBe(400); expect(e.code).toBe('bad_param');
  });
  it('public text: the sample carries no internal host, no workflow-tool name and no address', () => {
    expect(JSON.stringify(SAMPLE)).not.toMatch(/taifoon|\bn8n\b|0x[0-9a-fA-F]{40}|the layer/i);
  });
});

// Virtuals' public agent record, as GET https://api.acp.virtuals.io/agents/:id answers it (its wallet fields never reach the plan)
const MOON = HOUSE_AGENTS.moonbeam;
const BUILDER = '01a2bbbb-1111-7222-8333-944445555666';
const WALLET = `0x${'ab'.repeat(20)}`;
const listedRecord = { data: { id: MOON, name: 'Moonbeam', description: 'Moonbeam lists agents.', walletAddress: WALLET,
  chains: [{ chainId: 8453, active: true, erc8004AgentId: 1185268, tokenAddress: null }],
  offerings: [{ name: 'Moonbeam text digest', description: 'digest', priceValue: 0.01, isHidden: false }, { name: 'Moonbeam market price', description: 'price', priceValue: 0.01, isHidden: false }] } };
const freshRecord = { data: { id: BUILDER, name: 'My agent', description: 'mine', walletAddress: WALLET, chains: [],
  offerings: [{ name: 'Summarize', description: 's', priceValue: 0.05, isHidden: true }] } };
const AT = '2026-11-15T00:00:00.000Z';
const now = () => AT;

// two live answers of GET /v1/listed/track, 2026-11-22: the outside x402 seller ax1.vc and Moonbeam's house agent On-chain Reads
const TRACK_AX1 = JSON.parse(readFileSync(new URL('./fixtures/listed/track-ax1-vc.json', import.meta.url), 'utf8'));
const TRACK_HOUSE = JSON.parse(readFileSync(new URL('./fixtures/listed/track-1176098.json', import.meta.url), 'utf8'));
const clone = <X>(x: X): X => JSON.parse(JSON.stringify(x));

describe('track: what listing did, one agent on every venue (listed.track.v1)', () => {
  it('reads GET /listed/track?agent=<ref>, public, and keys the venues by every VENUE_ID', async () => {
    const { t, seen } = transport(() => [200, TRACK_AX1]);
    const k = await track(t, ' x402:6571678d37f0 ');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://api.example/v1/listed/track?agent=x402%3A6571678d37f0');
    expect(seen[0]!.method).toBe('GET'); expect(seen[0]!.headers['x-api-key']).toBeUndefined();
    expect(k.schema).toBe(TRACK_SCHEMA); expect(Object.keys(k.venues)).toEqual([...VENUE_IDS]);
    expect(k.agent).toMatchObject({ ref: 'x402:6571678d37f0', kind: 'outside', host: 'ax1.vc' });
    expect(k.extra).toEqual([]); expect(k.body).toBe(TRACK_AX1);
  });
  it('an outside x402 seller: listed on the x402 directories it is in and on the NEAR AI market, read back on each, absent where it has no identity', () => {
    const k = trackOf(clone(TRACK_AX1));
    const x = k.venues['x402-base'];
    expect(x.listed.state).toBe('live');
    const where = new Set(x.listed.entries.filter((e) => e.state === 'live').map((e) => e.where));
    expect(where.has('x402scan')).toBe(true);
    for (const w of where) expect(['CDP Bazaar', 'x402scan', 'agentic.market', 'Ultravioleta']).toContain(w);
    for (const e of x.listed.entries) if (e.state === 'live') { expect(e.url).toMatch(/^https:\/\//); expect(e.last_seen).toBeTruthy(); }
    expect(x.lights.read_back.state).toBe('on');
    // listed by Moonbeam as @mbf-ax1-vc: the market's own record of the handle reads it live
    const n = k.venues['near-agent-market'];
    expect(n.listed.state).toBe('live'); expect(n.listed.entries[0]).toMatchObject({ where: 'NEAR AI market', url: 'https://market.near.ai/a/mbf-ax1-vc', state: 'live' });
    expect(n.lights.read_back.state).toBe('on');
    // MCP and A2A name an agent by its identity: ax1.vc has none, so each directory answers without it (8004scan may not answer: unread)
    for (const id of ['mcp', 'a2a'] as const) { expect(k.venues[id].listed.state, id).toBe('absent'); expect(k.venues[id].lights.read_back.state, id).toBe('off'); }
    expect(['absent', 'unread']).toContain(k.venues.erc8004.listed.state);
    expect(k.totals).toMatchObject({ venues: 10, listed_outside: 2, vanished: 0 });
    expect(k.totals.own_usd_7d).toBeGreaterThan(0);
  });
  it('a house agent: read back on x402, Virtuals ACP, NEAR, MCP Registry, A2A Registry and ERC-8004', () => {
    const k = trackOf(clone(TRACK_HOUSE));
    expect(k.agent).toMatchObject({ ref: '8453:1176098', kind: 'house', class: 'data.onchain_query' });
    const live = VENUE_IDS.filter((id) => k.venues[id].listed.state === 'live');
    expect(live.sort()).toEqual(['a2a', 'erc8004', 'erc8183-base', 'mcp', 'near-agent-market', 'x402-base'].sort());
    for (const id of live) expect(k.venues[id].lights.read_back.state, id).toBe('on');
    expect(k.totals.listed_outside).toBe(6);
    // the one sale on record through Moonbeam (2026-10-12) is the last call; none in the 7 days
    expect(k.venues['x402-base'].sales).toMatchObject({ calls_7d: 0, from: 'sale_run' });
    expect(k.venues['x402-base'].sales.last_call).toMatch(/^2026-10-12T/);
  });
  it('every venue: a listed state, sales from the sale record, five lights; Visible on only while an entry shows it', () => {
    for (const body of [TRACK_AX1, TRACK_HOUSE]) {
      const k = trackOf(clone(body));
      for (const id of VENUE_IDS) {
        const v = k.venues[id];
        expect(Object.keys(v.lights).sort(), id).toEqual([...JOURNEY_LEDS].sort());
        for (const l of JOURNEY_LEDS) if (v.lights[l].state === 'on') expect(v.lights[l].evidence.length, `${id}.${l}`).toBeGreaterThan(0);
        expect(['live', 'paused', 'absent', 'unread', 'none']).toContain(v.listed.state);
        if (v.listed.state === 'absent') expect(v.lights.read_back.state, id).toBe('off');
        if (v.lights.read_back.state === 'on' && v.standing !== 'closed' && v.listed.state !== 'none') expect(['live', 'unread'], id).toContain(v.listed.state);
        expect(v.sales.from).toBe('sale_run');
      }
    }
  });
  it('a listing that vanished outside reads absent with when it was last seen, and Visible off', () => {
    const b = clone(TRACK_AX1); const x = b.venues.find((v: { venue_id: string }) => v.venue_id === 'x402-base');
    const seenAt = x.listed.last_seen;
    x.listed = { state: 'absent', last_seen: seenAt, entries: x.listed.entries.map((e: object) => ({ ...e, state: 'absent', vanished: true, last_seen: seenAt })) };
    x.lights.read_back = { state: 'off', why: 'every directory that showed it answers without it now', evidence: [] };
    const k = trackOf(b);
    expect(k.venues['x402-base'].listed.entries.every((e) => e.vanished && e.last_seen === seenAt)).toBe(true);
    expect(k.venues['x402-base'].lights.read_back.state).toBe('off');
  });
  it('refuses a ref that is not one before a read, and a body that breaks the schema', async () => {
    const { t, seen } = transport(() => [200, TRACK_HOUSE]);
    for (const bad of ['', 'foo', '8453:', 'x402:XYZ']) await expect(track(t, bad), bad).rejects.toThrow(RangeError);
    expect(seen).toHaveLength(0);
    expect(() => trackOf({ ...clone(TRACK_HOUSE), schema: 'listed.track.v0' })).toThrow(MarketError);
    const lacks = clone(TRACK_HOUSE); lacks.venues = lacks.venues.filter((v: { venue_id: string }) => v.venue_id !== 'a2a');
    expect(() => trackOf(lacks)).toThrow(/no row for a2a/);
    // the route's answer when the journey did not answer: no venues, the reason in unread
    expect(() => trackOf({ schema: 'listed.track.v1', agent: { ref: '8453:1' }, venues: [], unread: ['the journey did not answer'] })).toThrow(/the journey did not answer/);
  });
});

describe('list: the plan of a Virtuals ACP listing (genie.list.virtuals.v1), read and plan only', () => {
  it('Moonbeam\'s own agent, listed: every step done, its ERC-8004 id, its offerings shown, nothing for a person', async () => {
    const { t, seen } = transport(() => [200, listedRecord], 'mb_key');
    const p = await list(t, { venue: 'erc8183-base', agent: 'moonbeam', now });
    expect(seen.map((s) => [s.method, s.url])).toEqual([['GET', `https://api.acp.virtuals.io/agents/${MOON}`]]);
    expect(seen[0]!.headers['x-api-key']).toBeUndefined(); // the key is never sent to the venue
    expect(p).toMatchObject({ schema: 'genie.list.virtuals.v1', ref: MOON, venue: 'erc8183-base', account: 'house:moonbeam', erc8004AgentId: 1185268, human: null, done: true });
    expect(p.agent).toEqual({ id: MOON, name: 'Moonbeam', page: `https://app.virtuals.io/acp/agents/${MOON}`, chains: [{ chainId: 8453, erc8004AgentId: 1185268 }] });
    expect(p.steps.map((s) => s.step)).toEqual([...LIST_STEPS]);
    expect(p.steps.every((s) => s.state === 'done' && s.read_at === AT && !!s.evidence.kind)).toBe(true);
    expect(p.offerings).toEqual([{ name: 'Moonbeam text digest', priceUsdc: 0.01, shown: true }, { name: 'Moonbeam market price', priceUsdc: 0.01, shown: true }]);
    expect(JSON.stringify(p)).not.toMatch(/0x[0-9a-fA-F]{40}/);
  });
  it('a builder\'s fresh agent: the signer waits on the builder, the human item is returned with no link, nothing is sent', async () => {
    const { t, seen } = transport(() => [200, freshRecord]);
    const p = await list(t, { venue: 'erc8183-base', agent: BUILDER, now });
    expect(seen.every((s) => s.method === 'GET')).toBe(true); expect(seen).toHaveLength(1);
    expect(p.account).toBe('builder'); expect(p.erc8004AgentId).toBeNull(); expect(p.done).toBe(false);
    expect(Object.fromEntries(p.steps.map((s) => [s.step, [s.state, s.who]]))).toEqual({
      agent: ['done', 'machine'], signer: ['waiting', 'builder'], register: ['waiting', 'machine'], seller: ['waiting', 'machine'], offerings: ['waiting', 'machine'], readback: ['running', 'machine'],
    });
    expect(p.human).toMatchObject({ kind: 'approval', for: 'builder', url: null, page: `https://app.virtuals.io/acp/agents/${BUILDER}`, expires_at: null });
    expect(p.human!.chat).toMatch(/Moonbeam Studio/);
    expect(p.offerings).toEqual([{ name: 'Summarize', priceUsdc: 0.05, shown: false }]);
    expect(p.steps.some((s) => s.state === 'waiting_approval')).toBe(false); // only the Studio's run holds an approval link
  });
  it('Moonbeam\'s agent not yet registered: the approval is the owner\'s', async () => {
    const { t } = transport(() => [200, { data: { ...freshRecord.data, id: MOON } }]);
    const p = await list(t, { venue: 'erc8183-base', agent: MOON, now });
    expect(p.account).toBe('house:moonbeam'); expect(p.human?.for).toBe('owner'); expect(p.steps[1]).toMatchObject({ step: 'signer', who: 'owner' });
  });
  it('custom: the offerings a run would show, with their prices, and what would change', async () => {
    const { t } = transport(() => [200, listedRecord]);
    const same = await list(t, { venue: 'erc8183-base', agent: 'moonbeam', now, custom: { offerings: [{ name: 'Moonbeam text digest', priceUsdc: 0.01 }] } });
    expect(same.done).toBe(true); expect(same.offerings).toEqual([{ name: 'Moonbeam text digest', priceUsdc: 0.01, shown: true }]);
    const p = await list(t, { venue: 'erc8183-base', agent: 'moonbeam', now, custom: { name: 'Moonbeam listings', offerings: [{ name: 'Moonbeam text digest', priceUsdc: 0.02 }, { name: 'New one', priceUsdc: 0.03 }] } });
    const o = p.steps.find((s) => s.step === 'offerings')!;
    expect(o.state).toBe('waiting'); expect(o.evidence.why).toContain('the name'); expect(o.evidence.why).toContain('New one'); expect(o.evidence.ref).toBe('1 of 2 shown');
    expect(p.offerings).toEqual([{ name: 'Moonbeam text digest', priceUsdc: 0.02, shown: true }, { name: 'New one', priceUsdc: 0.03, shown: false }]);
    expect(p.done).toBe(false);
    for (const bad of [{ offerings: [{ name: 'x', priceUsdc: 0 }] }, { offerings: [{ name: 'x', priceUsdc: Number.NaN }] }, { name: '' }, { offerings: [{ name: '' }] }])
      await expect(list(t, { venue: 'erc8183-base', agent: 'moonbeam', custom: bad as market.ListCustom })).rejects.toThrow(RangeError);
  });
  it('no such agent: the agent step is refused and nothing follows', async () => {
    const { t } = transport(() => [404, { error: 'not found' }]);
    const p = await list(t, { venue: 'erc8183-base', agent: BUILDER, now });
    expect(p.steps).toEqual([{ step: 'agent', state: 'refused', who: 'machine', read_at: AT, evidence: { kind: 'virtuals.agent', ref: BUILDER, url: `https://api.acp.virtuals.io/agents/${BUILDER}`, why: 'no such agent on Virtuals' } }]);
    expect(p.done).toBe(false); expect(p.human).toBeNull();
  });
  it('a venue that does not answer is a MarketError, never a plan', async () => {
    const { t } = transport(() => [503, { error: 'down' }]);
    await expect(list(t, { venue: 'erc8183-base', agent: 'moonbeam' })).rejects.toBeInstanceOf(MarketError);
  });
  it('plans only on the venues it knows, names journey() for the rest, and takes only an agent id or moonbeam', async () => {
    const { t, seen } = transport(() => [200, listedRecord]);
    expect(LIST_VENUES).toEqual(['erc8183-base']);
    await expect(list(t, { venue: 'olas-base' as market.ListVenue, agent: 'moonbeam' })).rejects.toThrow(/journey\(t, ref\)/);
    for (const bad of ['', 'operator', 'Moonbeam', '01a1cc7f', '8453:1185268']) await expect(list(t, { venue: 'erc8183-base', agent: bad })).rejects.toThrow(RangeError);
    await expect(list(t, { venue: 'erc8183-base', agent: 'moonbeam', api: 'http://insecure.example' })).rejects.toThrow(/https/);
    expect(seen).toHaveLength(0);
    await list(t, { venue: 'erc8183-base', agent: MOON, api: 'https://venue.example/' });
    expect(seen[0]!.url).toBe(`https://venue.example/agents/${MOON}`);
  });
});
