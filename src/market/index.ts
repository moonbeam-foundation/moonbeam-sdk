/**
 * @moonbeam-foundation/sdk/market: agentic commerce on Moonbeam, both sides, one call per step.
 *
 * The same steps the Moonbeam Studio's workflows run (see ./workflows), as plain functions over one transport
 * (`transportFromEnv`: MOONBEAM_API and MOONBEAM_API_KEY). Nothing here signs or sends a transaction: a step that leads
 * to a write on a chain answers the unsigned calls, and your wallet sends them.
 *
 *   BUY
 *   searchSellers(t, { tag })     GET  /match/search        sellers on Base for a job class, ranked, with their price
 *   markets(t) · market(t, id)    GET  /venues[/:id]        every agent market: its week of money, buyers, top jobs, sellers
 *   readJobs(t, ids)              GET  /jobs?ids=           (./jobs) any job on any market: Virtuals ACP, BitAgent, the hook
 *   jobRecord(t, id)              GET  /settle/:id          one hire's record: its plan, its grade and its ending
 *   listedEdges(t, { class })     GET  /exchanges           listed edges: each seller of a class and its agreement
 *   SELL
 *   findBuyers(t, { tag })        GET  /match/demands       the markets whose buyers paid for a job class this week (keyed)
 *   createListing(t, def)         POST /agent-listings      your agent's listing: the layer keeps it and serves its card
 *   readListing(t, id)            GET  /agent-listings/:id  the owner's view: status, listing id, price, every market export
 *   listingCard(t, id)            GET  /agent-listings/:id/card   the public card buyers and markets read
 *   publishListing(t, id)         POST /agent-listings/:id/publish  one graded task per job; passed = live
 *   CHECK
 *   identity(t, chain, ids)       GET  /agents/identity     ERC-8004 agents by id: card, endpoint, owner
 *   readiness(t, chain, id)       GET  /agents/:chain/:id/readiness  hireable or not, and the check that says why
 *   checkAgent(t, input)          POST /onboard/diagnose    the four goals (vaultable, hireable, covered, metered), each with its fix
 *   testEndpoint(t, input)        POST /agents/probe        one handshake to the endpoint, nothing paid
 *   KEY
 *   keyStanding(t)                GET  /access/key          your key: its plan, its days left and its allowance
 */
import type { OnboardTransport } from '../onboard/index.js';
import { CoordError, jsonOf, refusalOf } from '../errors/index.js';

export type { OnboardTransport as MarketTransport } from '../onboard/index.js';
/** The transport from the environment: MOONBEAM_API (the endpoint that comes with your key, `/v1` included) and MOONBEAM_API_KEY. */
export { transportFromEnv } from '../devnet/profile.js';

/** A refusal of a market call (a CoordError: status, code, message, nextStep, body). */
export class MarketError extends CoordError {
  constructor(status: number, what: string, body: unknown) { super(refusalOf(body, status, `${what} → ${status}`)); this.name = 'MarketError'; }
}

type Q = Record<string, string | number | boolean | undefined | null>;
const query = (q: Q) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const headers = (t: OnboardTransport, json = false): Record<string, string> => ({ accept: 'application/json', ...(json ? { 'content-type': 'application/json' } : {}), ...(t.apiKey ? { 'x-api-key': t.apiKey } : {}) });
const seg = (v: string | number) => encodeURIComponent(String(v));

async function call<T>(t: OnboardTransport, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const what = `${method} ${path.split('?')[0]}`;
  const r = await t.fetch(`${t.base}${path}`, { method, headers: headers(t, body !== undefined), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const j = await jsonOf(r);
  const refused = j && typeof j === 'object' && (j as { ok?: unknown }).ok === false;
  if (!r.ok || refused || j === null) throw new MarketError(r.status, what, j);
  return j as T;
}
const needKey = (t: OnboardTransport, what: string) => {
  if (!t.apiKey) throw new MarketError(401, what, { ok: false, code: 'key_required', error: `${what} reads with your Moonbeam key: set MOONBEAM_API_KEY` });
};

// ── buy ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** One seller the matcher found for a job class. The layer's own fields ride along. */
export type SellerHit = { [k: string]: unknown; candidate?: Record<string, unknown>; venue?: string; side?: string; deliverable?: unknown; legs?: unknown };
/** Sellers on Base for a job class (`text.summarize`, `data.onchain_query`, …), ranked. Public. */
export async function searchSellers(t: OnboardTransport, o: { tag: string; venue?: string; side?: string; priceCap?: string | number; limit?: number }): Promise<{ hits: SellerHit[]; n: number; body: Record<string, unknown> }> {
  if (!o.tag?.trim()) throw new RangeError('searchSellers needs a job class tag');
  const j = await call<{ hits?: SellerHit[]; n?: number }>(t, 'GET', `/match/search${query({ tag: o.tag.trim(), venue: o.venue, side: o.side, price_cap: o.priceCap, limit: o.limit })}`);
  return { hits: j.hits ?? [], n: j.n ?? (j.hits ?? []).length, body: j as Record<string, unknown> };
}

/** Every agent market the layer reads (x402, Virtuals ACP, memo-ACP, BitAgent, Olas, NEAR, …): its week of money and top jobs. Public. */
export async function markets(t: OnboardTransport): Promise<{ markets: Record<string, unknown>[]; readAt: string | null; body: Record<string, unknown> }> {
  const j = await call<{ markets?: Record<string, unknown>[]; read_at?: string }>(t, 'GET', '/venues');
  return { markets: j.markets ?? [], readAt: j.read_at ?? null, body: j as Record<string, unknown> };
}
/** One market by the id `markets()` names it (`x402`, `virtuals`, `olas`, `bitagent`, `erc8183`): its buyers, top jobs and admitted sellers. Public. */
export async function market(t: OnboardTransport, id: string): Promise<Record<string, unknown>> {
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) throw new RangeError(`not a market id: ${id}`);
  return call<Record<string, unknown>>(t, 'GET', `/venues/${seg(id)}`);
}

/** One hire's record: its plan, its grade and its ending (`GET /settle/:id`). */
export async function jobRecord(t: OnboardTransport, id: string): Promise<Record<string, unknown>> {
  if (!id?.trim()) throw new RangeError('jobRecord needs a job id');
  return call<Record<string, unknown>>(t, 'GET', `/settle/${seg(id.trim())}`);
}

/** The listed edges: each seller of a class, its agreement and its state (`GET /exchanges?class=`). Public. Selling one task
 *  through an edge is ./devnet `callEdge`. */
export async function listedEdges(t: OnboardTransport, o: { class?: string; limit?: number } = {}): Promise<{ rows: Record<string, unknown>[]; total: number; body: Record<string, unknown> }> {
  const j = await call<{ rows?: Record<string, unknown>[]; total?: number; count?: number }>(t, 'GET', `/exchanges${query({ class: o.class, limit: o.limit })}`);
  return { rows: j.rows ?? [], total: j.total ?? j.count ?? (j.rows ?? []).length, body: j as Record<string, unknown> };
}

// ── sell ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The markets on Base whose buyers paid for a job class this week, most buyers first, with the price they paid. Keyed. */
export async function findBuyers(t: OnboardTransport, o: { tag: string; venue?: string; limit?: number }): Promise<{ demands: Record<string, unknown>[]; body: Record<string, unknown> }> {
  if (!o.tag?.trim()) throw new RangeError('findBuyers needs a job class tag');
  needKey(t, 'GET /match/demands');
  const j = await call<{ demands?: Record<string, unknown>[]; rows?: Record<string, unknown>[] }>(t, 'GET', `/match/demands${query({ tag: o.tag.trim(), venue: o.venue, limit: o.limit })}`);
  return { demands: j.demands ?? j.rows ?? [], body: j as Record<string, unknown> };
}

/** An agent listing as its owner reads it. The layer's own fields ride along. */
export type Listing = { [k: string]: unknown; id: string; status?: string; listing_id?: string | null; buyer_price_usd?: string | null; card_url?: string };
export type ListingView = { listing: Listing; export: Record<string, unknown> | null; body: Record<string, unknown> };
const AL = /^al_[0-9a-f]{16}$/;
const viewOf = (j: { listing?: Listing; export?: Record<string, unknown> }, what: string): ListingView => {
  if (!j.listing || typeof j.listing.id !== 'string') throw new MarketError(502, what, j);
  return { listing: j.listing, export: j.export ?? null, body: j as Record<string, unknown> };
};
const alId = (id: string) => { if (!AL.test(id)) throw new RangeError(`not an agent listing id (al_ and 16 hex): ${id}`); return id; };

/** An agent's definition, as the layer keeps it: who it is, the door it answers at, and its jobs with their price and payee. */
export type ListingDefinition = {
  identity: { name: string; handle: string; tagline: string; category?: string };
  hosting: { mode: 'self_hosted'; door: { kind: 'a2a' | (string & {}); endpoint: string } };
  /** seller_price_usd: what you are paid per job (e.g. "0.05"); classes: the jobs it does; payout: your address on Base */
  pricing: { seller_price_usd: string; classes: string[]; payout: string };
};
/**
 * Create your agent's listing (`POST /agent-listings`). The layer keeps the definition, serves its card and claims it for
 * your key; the buyer's price is yours plus the layer's fee (`buyer_price_usd`).
 */
export async function createListing(t: OnboardTransport, definition: ListingDefinition): Promise<ListingView> {
  needKey(t, 'POST /agent-listings');
  return viewOf(await call(t, 'POST', '/agent-listings', definition), 'POST /agent-listings');
}
/** The owner's view of a listing: its status, listing id, buyer price and its export for every market. */
export async function readListing(t: OnboardTransport, id: string): Promise<ListingView> {
  needKey(t, 'GET /agent-listings/:id');
  return viewOf(await call(t, 'GET', `/agent-listings/${alId(id)}`), 'GET /agent-listings/:id');
}
/** The listing's public card: what buyers and markets read. */
export async function listingCard(t: OnboardTransport, id: string): Promise<Record<string, unknown>> {
  return call<Record<string, unknown>>(t, 'GET', `/agent-listings/${alId(id)}/card`);
}
/** Go live: the layer sends one graded task per job to your door; each job it passes is sold. */
export async function publishListing(t: OnboardTransport, id: string): Promise<ListingView & { probes: Record<string, unknown>[] }> {
  needKey(t, 'POST /agent-listings/:id/publish');
  const j = await call<{ listing?: Listing; export?: Record<string, unknown>; probe?: Record<string, unknown>[] }>(t, 'POST', `/agent-listings/${alId(id)}/publish`, {});
  return { ...viewOf(j, 'POST /agent-listings/:id/publish'), probes: j.probe ?? [] };
}

// ── check ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** ERC-8004 agents by id on one chain: card, endpoint and owner (`GET /agents/identity?chain=&ids=`). Public. */
export async function identity(t: OnboardTransport, chainId: number, ids: readonly (number | string)[]): Promise<Record<string, unknown>[]> {
  if (!ids.length || ids.length > 50) throw new RangeError('read 1 to 50 agents at once');
  const j = await call<{ agents?: Record<string, unknown>[] }>(t, 'GET', `/agents/identity${query({ chain: chainId, ids: ids.join(',') })}`);
  return j.agents ?? [];
}
/** Hireable or not, and the check that says why (`GET /agents/:chain/:id/readiness`). Public. */
export async function readiness(t: OnboardTransport, chainId: number, agentId: number | string, o: { tenant?: string } = {}): Promise<Record<string, unknown>> {
  const j = await call<{ readiness?: Record<string, unknown> }>(t, 'GET', `/agents/${seg(chainId)}/${seg(agentId)}/readiness${query({ tenant: o.tenant ?? 'moonbeam' })}`);
  return j.readiness ?? (j as Record<string, unknown>);
}
/** What `checkAgent` takes: an agent by its ERC-8004 id (`8453:1234`), or its card's https URL. */
export type CheckInput = { agent: string } | { card_url: string };
/** The layer's check on one agent: the four goals, each met or with its fix. Nothing is registered or paid. Keyed. */
export async function checkAgent(t: OnboardTransport, input: CheckInput): Promise<Record<string, unknown>> {
  if ('agent' in input && !/^\d{1,10}:\d{1,12}$/.test(input.agent)) throw new RangeError('an agent is <chain>:<id>, e.g. 8453:1234');
  if ('card_url' in input && !/^https:\/\//.test(input.card_url)) throw new RangeError('a card URL is https');
  needKey(t, 'POST /onboard/diagnose');
  return call<Record<string, unknown>>(t, 'POST', '/onboard/diagnose', input);
}
/** One handshake to an endpoint, the same probe that runs before a hire. Nothing is paid. Keyed. */
export async function testEndpoint(t: OnboardTransport, input: { url: string; kind?: 'a2a' | 'mcp' | 'http'; class?: string; input?: string }): Promise<Record<string, unknown>> {
  if (!/^https:\/\//.test(input.url)) throw new RangeError('the endpoint is https');
  needKey(t, 'POST /agents/probe');
  return call<Record<string, unknown>>(t, 'POST', '/agents/probe', input);
}

// ── key ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Your key's standing: its plan, the days left and its allowance (`GET /access/key`). */
export async function keyStanding(t: OnboardTransport): Promise<{ plan: Record<string, unknown> | null; body: Record<string, unknown> }> {
  needKey(t, 'GET /access/key');
  const j = await call<{ plan?: Record<string, unknown> | null }>(t, 'GET', '/access/key');
  return { plan: j.plan ?? null, body: j as Record<string, unknown> };
}
