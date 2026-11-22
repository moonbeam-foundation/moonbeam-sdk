// The journey of a seller's agent, as the Moonbeam product runs it: list it on the markets where agents are found, manage the
// listing (pause, go live again, delist), register its own ERC-8004 id, measure what its key used, read the plans, and read what
// it sold. Each call is one layer route over the transport given; nothing here signs, pays or sends a transaction.
import type { OnboardTransport } from '../onboard/index.js';
import { jsonOf } from '../errors/index.js';
import { MarketError, call, needKey, query, seg } from './http.js';
import { jobCalls, publishListing, readListing, type Listing, type ListingView, type PlannedCall } from './index.js';
import { keyedFetch } from '../core/keyed.js';
import { VENUE_REGISTER } from './venues-data.js';
import type { ListMarketRow } from './venues.js';

// ── list ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

// _LIST_MARKET_v1_ (2026-11-22): the list step's markets are coord's venue rows that carry list_market (lang/cue/venues-registry.cue),
// snapshotted in venues-register.json; nothing here types them. A directory row (ERC-8004, MCP Registry, A2A Registry) is listed by
// default; a market row (Virtuals ACP) when it is named, and it also lists an outside seller by its board row.
const LIST_ROWS: Readonly<Record<string, ListMarketRow>> = VENUE_REGISTER.list_markets ?? {};
/** Every market the list step lists on, by the venue it lists on (`LIST_MARKET_OF['erc8183-base']` is Virtuals ACP's). */
export const LIST_MARKET_OF: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(Object.entries(LIST_ROWS).map(([venue, r]) => [venue, r.market])));
/** The markets the list step lists on when none is named: the directories, where agents are found (ERC-8004 on Base, MCP, A2A). */
export const LIST_MARKETS: readonly string[] = Object.freeze(Object.values(LIST_ROWS).filter((r) => r.directory).map((r) => r.market));
/** Every market the list step takes, the directories and the markets (Virtuals ACP). */
export const LIST_ALL_MARKETS: readonly string[] = Object.freeze(Object.values(LIST_ROWS).map((r) => r.market));
/** A market of the list step, as coord's venue rows name it. */
export type ListMarket = string;
/** The approval a person opens on the venue (Virtuals ACP): the account holder's one click, a link that lasts minutes. */
export type ListApproval = { url: string; expires_at: string | null; kind: string };
/** One market of a list step: queued (publishing, within about ten minutes), listed (with the market's own url), held or failed (with why).
 *  On Virtuals ACP a row held on an approval carries the link (`approval`) and the one step a person takes (`owner_step`). */
export type ListRow = { state: 'queued' | 'listed' | 'held' | 'failed' | 'withdrawn'; why: string | null; url: string | null; tx: string | null; at?: string; read_at?: string;
  owner_step?: string | null; approval?: ListApproval | null; virtuals?: { agent_id: string; erc8004_agent_id: number | null; offerings_shown: number } };
/** A list step as Moonbeam keeps it. Moonbeam's own fields ride along. */
export type ListView = { [k: string]: unknown; id: string; agent: { ref: string; name: string; class: string | null; offer_usdc: string | null }; markets: Partial<Record<ListMarket, ListRow>>; fee?: { usdc: string } };
/** What a Virtuals ACP listing sets: the agent's name and description, and per offering its description and price (the `list` plan's ListCustom). */
export type ListStepCustom = { name?: string; description?: string; offerings?: { name: string; description?: string; priceUsdc?: number }[] };
const AGENT_REF = /^8453:\d{1,12}$/;
/** An outside seller's board row (`x402:<12 hex>`, `x402:host:<host>`): the markets that are no directory list an agent by it. */
const BOARD_REF = /^(?:x402:(?:host:[a-z0-9.-]{3,120}|[0-9a-f]{12})|(?:virtuals|bitagent|near|olas):[0-9a-f]{12})$/;
const agentRef = (ref: string, markets: readonly string[] = LIST_MARKETS) => {
  const r = String(ref ?? '').trim();
  const lower = r.toLowerCase();
  if (AGENT_REF.test(r)) return r;
  if (BOARD_REF.test(lower) && markets.length > 0 && markets.every((m) => !LIST_MARKETS.includes(m))) return lower;
  throw new RangeError(`an agent is 8453:<its ERC-8004 id>${LIST_ALL_MARKETS.some((m) => !LIST_MARKETS.includes(m)) ? `, or its board row (x402:<12 hex>, x402:host:<host>) on ${LIST_ALL_MARKETS.filter((m) => !LIST_MARKETS.includes(m)).join(', ')} alone` : ''}: ${ref}`);
};
const listOf = (j: { list?: ListView }, what: string): ListView => {
  if (!j.list || typeof j.list.id !== 'string' || !j.list.markets) throw new MarketError(502, what, j);
  return j.list;
};
const checkStepCustom = (c: ListStepCustom | undefined): ListStepCustom | undefined => {
  if (!c) return undefined;
  const line = (v: unknown, max: number, what: string) => { if (v !== undefined && (typeof v !== 'string' || !v.trim() || v.length > max)) throw new RangeError(`${what} is 1 to ${max} characters`); };
  line(c.name, 80, 'custom.name'); line(c.description, 1000, 'custom.description');
  for (const o of c.offerings ?? []) {
    line(o.name, 80, 'an offering name'); line(o.description, 1000, `${o.name}: its description`);
    if (o.priceUsdc !== undefined && !(Number.isFinite(o.priceUsdc) && o.priceUsdc > 0)) throw new RangeError(`${o.name}: priceUsdc is a positive number of USDC`);
  }
  return c;
};

/** The list step's id of an agent, derived the way Moonbeam derives it: `lst_` + the first 16 hex of sha256("list:<ref>"). */
export async function listIdOf(ref: string): Promise<string> {
  const r = String(ref ?? '').trim();
  const id = AGENT_REF.test(r) ? r : BOARD_REF.test(r.toLowerCase()) ? r.toLowerCase() : agentRef(r);
  const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`list:${id}`));
  return `lst_${[...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)}`;
}

/**
 * List an agent (`POST /list`). With no market named: the markets where agents are found, its ERC-8004 record on Base, the MCP Registry
 * and the A2A Registry. Named, also a market venue: `LIST_MARKET_OF['erc8183-base']` lists it on Virtuals ACP, where Moonbeam makes the
 * agent in its own Virtuals account with its name and words (`o.custom` sets them and its offerings' prices) and the account holder
 * approves its signer once (the row's `approval` and `owner_step`). Runs on a plan key and is part of the plan (no per-listing price is
 * set). Asking again returns the same record, read anew. `ref` is the agent's ERC-8004 id on Base, or, on a market venue alone, the
 * outside seller's board row (`x402:<12 hex>`, `x402:host:<host>`).
 */
export async function listOn(t: OnboardTransport, ref: string, markets: readonly ListMarket[] = LIST_MARKETS, o: { custom?: ListStepCustom } = {}): Promise<ListView> {
  const bad = markets.filter((m) => !LIST_ALL_MARKETS.includes(m));
  if (!markets.length || bad.length) throw new RangeError(`the list step lists on ${LIST_ALL_MARKETS.join(', ')}${bad.length ? `, not ${bad.join(', ')}` : ''}`);
  const agent = agentRef(ref, markets);
  const custom = checkStepCustom(o.custom);
  needKey(t, 'POST /list');
  return listOf(await call(t, 'POST', '/list', { agent, markets: [...new Set(markets)], ...(custom ? { custom } : {}) }), 'POST /list');
}
/** Where an agent stands on each market of its list step (`GET /list/:id`), or null when it was never listed. Public. */
export async function listStatus(t: OnboardTransport, ref: string): Promise<ListView | null> {
  const id = await listIdOf(ref);
  try { return listOf(await call(t, 'GET', `/list/${seg(id)}`), 'GET /list/:id'); } catch (e) {
    if (e instanceof MarketError && e.status === 404) return null;
    throw e;
  }
}
/** The one step a person takes on a venue's listing now (the account holder's approval), or null: its words, its link and when it ends. Pure. */
export function listApproval(view: ListView | null, venue: string): { step: string; url: string; expires_at: string | null } | null {
  const row = view?.markets?.[LIST_MARKET_OF[venue] ?? ''];
  if (!row || row.state === 'listed' || !row.approval?.url || !/^https:\/\//.test(row.approval.url)) return null;
  return { step: row.owner_step ?? 'Approve the listing on the venue', url: row.approval.url, expires_at: row.approval.expires_at ?? null };
}

// ── manage ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const AL = /^al_[0-9a-f]{16}$/;
const alId = (id: string) => { if (!AL.test(id)) throw new RangeError(`not an agent listing id (al_ and 16 hex): ${id}`); return id; };
const statusTo = async (t: OnboardTransport, id: string, status: 'paused' | 'archived'): Promise<{ listing: Listing; body: Record<string, unknown> }> => {
  needKey(t, 'POST /agent-listings/:id');
  const j = await call<{ listing?: Listing }>(t, 'POST', `/agent-listings/${alId(id)}`, { status });
  if (!j.listing || typeof j.listing.id !== 'string') throw new MarketError(502, 'POST /agent-listings/:id', j);
  return { listing: j.listing, body: j as Record<string, unknown> };
};
/** Pause a live listing (`POST /agent-listings/:id { status: paused }`): it is not sold until it goes live again. On its owner's key. */
export const pauseListing = (t: OnboardTransport, id: string) => statusTo(t, id, 'paused');
/** Go live again (`POST /agent-listings/:id/publish`): one graded task per job, each job it passes is sold again. On its owner's key. */
export const resumeListing = (t: OnboardTransport, id: string): Promise<ListingView & { probes: Record<string, unknown>[] }> => publishListing(t, id);
/** Delist for good (`POST /agent-listings/:id { status: archived }`): kept for the record, never sold again. `confirm` must repeat the id. */
export async function delistListing(t: OnboardTransport, id: string, o: { confirm: string }): Promise<{ listing: Listing; body: Record<string, unknown> }> {
  if (o?.confirm !== id) throw new RangeError('delisting is for good: pass { confirm: <the listing id> }');
  return statusTo(t, id, 'archived');
}

// ── register on ERC-8004 ──────────────────────────────────────────────────────────────────────────────────────────────

/** Moonbeam's register-8004 builder takes an agentURI of at most this many characters. */
export const MAX_INLINE_URI = 2048;
const base64 = (s: string) => { let b = ''; for (const c of new TextEncoder().encode(s)) b += String.fromCharCode(c); return btoa(b); };
/** A listing's registration file as an inline `data:` URI (nothing is hosted), or why it cannot be. Pure. */
export function inlineRegistration(x: { exportable?: boolean; why?: string[]; registration?: Record<string, unknown> | null } | null | undefined): { ok: true; uri: string; file: Record<string, unknown> } | { ok: false; why: string } {
  if (!x || !x.registration) return { ok: false, why: 'the listing carries no registration file' };
  if (!x.exportable) return { ok: false, why: (x.why ?? []).join('; ') || 'this listing has no registration file yet' };
  const uri = `data:application/json;base64,${base64(JSON.stringify(x.registration))}`;
  if (uri.length > MAX_INLINE_URI) return { ok: false, why: `its file is ${uri.length} characters inline, over ${MAX_INLINE_URI}: shorten its description, or host the file at an https URL and register that` };
  return { ok: true, uri, file: x.registration };
}
/**
 * Your agent's own ERC-8004 id on Base, as unsigned calls: the listing's registration file (`export.erc8004` of
 * `GET /agent-listings/:id`) inlined as a data: URI, and `register(agentURI)` built by Moonbeam (`POST /assurance/call`).
 * Your wallet signs and owns the id; the receipt's `Registered` event names it. Nothing is signed or sent here.
 */
export async function register8004Calls(t: OnboardTransport, listingId: string): Promise<{ uri: string; file: Record<string, unknown>; calls: PlannedCall[]; signer: string; sent: false }> {
  const view = await readListing(t, listingId);
  const x = (view.export as { erc8004?: Parameters<typeof inlineRegistration>[0] } | null)?.erc8004;
  const f = inlineRegistration(x);
  if (!f.ok) throw new MarketError(422, 'register8004Calls', { ok: false, code: 'not_registrable', error: f.why });
  const { calls } = await jobCalls(t, { chainId: 8453, action: { kind: 'register-8004', agentURI: f.uri } });
  const reg = calls.filter((c) => c.action === undefined || c.action === 'register-8004');
  if (!reg.length || !reg.every((c) => /^0x[0-9a-fA-F]{40}$/.test(String(c.to ?? '')) && /^0x[0-9a-fA-F]+$/.test(String(c.data ?? '')))) throw new MarketError(502, 'POST /assurance/call', { ok: false, code: 'no_call', error: 'the register call could not be built' });
  return { uri: f.uri, file: f.file, calls: reg, signer: 'your wallet: the account that will own the agent\'s ERC-8004 id', sent: false };
}

// ── measure ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What your key (or your whole tenant) used over a window (`GET /access/usage`): calls and spend per product family, by day and by key. Keyed. */
export async function usage(t: OnboardTransport, o: { window?: '1d' | '7d' | '30d' | 'month'; scope?: 'key' | 'tenant' } = {}): Promise<{ window: string; scope: string; families: Record<string, Record<string, number>>; total: Record<string, number> | null; byDay: Record<string, unknown>[]; keys: Record<string, unknown>[]; body: Record<string, unknown> }> {
  needKey(t, 'GET /access/usage');
  const window = o.window ?? 'month'; const scope = o.scope ?? 'tenant';
  const j = await call<{ families?: Record<string, Record<string, number>>; total?: Record<string, number>; by_day?: Record<string, unknown>[]; keys?: Record<string, unknown>[]; window?: string; scope?: string }>(t, 'GET', `/access/usage${query({ window, scope })}`);
  return { window: j.window ?? window, scope: j.scope ?? scope, families: j.families ?? {}, total: j.total ?? null, byDay: j.by_day ?? [], keys: j.keys ?? [], body: j as Record<string, unknown> };
}
/** Your tenant's keys and the recent changes to them (`GET /tenant/keys`): who created, rotated or revoked a key, and when. Keyed. */
export async function tenantKeys(t: OnboardTransport): Promise<{ keys: Record<string, unknown>[]; recentChanges: Record<string, unknown>[]; body: Record<string, unknown> }> {
  needKey(t, 'GET /tenant/keys');
  const j = await call<{ keys?: Record<string, unknown>[]; recent_changes?: Record<string, unknown>[] }>(t, 'GET', '/tenant/keys');
  return { keys: j.keys ?? [], recentChanges: j.recent_changes ?? [], body: j as Record<string, unknown> };
}

// ── plans ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type PlanOffer = { plan: string; usdc: number; includes_usdc: number | null; per_minute: number | null; days: number };
/**
 * The plans and the top-up, as Moonbeam's own 402 answer names them (`POST /access/subscribe` with no key and no payment):
 * nothing is minted and nothing is paid. Buying one is the same POST with a payment, from your wallet.
 */
export async function planOffers(t: OnboardTransport): Promise<{ topup: { usdc: number; units: string; what: string | null } | null; plans: PlanOffer[]; networks: string[] }> {
  const what = 'POST /access/subscribe';
  // no key and no create_key: Moonbeam answers its terms with 402 and mints nothing
  const r = await keyedFetch(t, `${t.base}/access/subscribe`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: '{}' });
  const j = (await jsonOf(r)) as { code?: string; offer?: { usdc?: number; units?: string; what?: string }; monthly?: { plans?: Partial<PlanOffer>[] }; accepts?: { network?: string }[] } | null;
  if (r.status !== 402 || !j || j.code !== 'payment_required') throw new MarketError(r.status === 402 ? 502 : r.status, what, j);
  const plans = (j.monthly?.plans ?? []).filter((p) => typeof p.plan === 'string' && typeof p.usdc === 'number')
    .map((p) => ({ plan: p.plan!, usdc: p.usdc!, includes_usdc: p.includes_usdc ?? null, per_minute: p.per_minute ?? null, days: p.days ?? 30 }));
  const o = j.offer;
  return { topup: o && typeof o.usdc === 'number' ? { usdc: o.usdc, units: String(o.units ?? ''), what: o.what ?? null } : null, plans,
    networks: [...new Set((j.accepts ?? []).map((a) => a.network).filter((n): n is string => typeof n === 'string'))] };
}

// ── what it sold ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type Share = 'paid' | 'kept' | 'held' | 'owed' | 'refunded';
/** One sale through a class wall or to a seller: when, through which market, what the buyer paid and where the seller's share stands. */
export type SaleRow = { at: string | null; class: string | null; seller: string | null; venue_in: string | null; venue_out: string | null; network: string | null; buyer_paid_units: string; seller_share_units: string; share: Share; held_by: string | null; tx: string };
/** One slice of the sale run: an agent's class wall (`class:<class>`) or a seller (`seller:<host>`), by day and buying market. Units are USDC × 10⁶. */
export type SaleSlice = { key: string; kind: 'class' | 'seller'; sales: number; buyer_paid_units: string; seller_share_units: string; first_at: string | null; last_at: string | null; split: Record<Share, string>; held_by: Record<string, number>; venues: Record<string, number>; days: { day: string; venue_in: string | null; sales: number; buyer_paid_units: string }[]; recent: SaleRow[] };
const OWN_HOST = /taifoon|n8n|genie/i;
const OURS = 'ours';
const keyOfRef = (ref: string): string => {
  const r = String(ref ?? '').trim().toLowerCase();
  if (/^(class|seller):[a-z0-9._-]{2,253}$/.test(r)) return r;
  if (/^[a-z0-9_]+(\.[a-z0-9_]+){1,3}$/.test(r)) return `class:${r}`;
  try { const h = new URL(r).hostname; if (h) return `seller:${h}`; } catch { /* not a URL */ }
  throw new RangeError(`an agent's sales are read by its class (mcp.digest), class:<class>, seller:<host> or its endpoint URL: ${ref}`);
};
/**
 * What an agent sold, as the sale run counts it: the slice of its class wall or of its seller host, every sale by day and buying
 * market, and where each seller share stands (paid, kept, held, owed, refunded). The sale run is a published file: pass its URL
 * as `salesUrl` or set MOONBEAM_SALES_URL (it comes with your key). The operator's own seller hosts are said as `ours`.
 * null when the agent has no sale.
 */
export async function agentSales(t: OnboardTransport, ref: string, o: { salesUrl?: string } = {}): Promise<{ slice: SaleSlice; days: string[]; readAt: string } | null> {
  const key = keyOfRef(ref);
  const url = (o.salesUrl ?? (typeof process !== 'undefined' ? process.env?.['MOONBEAM_SALES_URL'] : undefined) ?? '').trim();
  if (!/^https:\/\//.test(url)) throw new RangeError('agentSales reads the sale run: pass { salesUrl } or set MOONBEAM_SALES_URL (https)');
  const r = await keyedFetch(t, url, { method: 'GET', headers: { accept: 'application/json' } });
  const j = (await jsonOf(r)) as { generated_at?: string; by_agent?: { rule?: string; days?: unknown[]; slices?: SaleSlice[] } } | null;
  const b = j?.by_agent;
  if (!r.ok || !b || b.rule !== 'SALE_SLICES_v1' || !Array.isArray(b.slices)) throw new MarketError(r.ok ? 502 : r.status, 'GET sale run', j);
  const scrub = (s: SaleSlice): SaleSlice => ({ ...s, key: s.kind === 'seller' && OWN_HOST.test(s.key) ? `seller:${OURS}` : s.key, recent: (s.recent ?? []).map((x) => (x.seller && OWN_HOST.test(x.seller) ? { ...x, seller: OURS } : x)) });
  const slice = b.slices.map(scrub).find((s) => s.key === key) ?? null;
  if (!slice || !slice.sales) return null;
  return { slice, days: (b.days ?? []).filter((d): d is string => typeof d === 'string'), readAt: j?.generated_at ?? new Date().toISOString() };
}

// ── a venue's own job ─────────────────────────────────────────────────────────────────────────────────────────────────

/** One Olas Mech request on Base as its evidence reads (`GET /judge/evidence/olas/:requestId`, the marketplace's 32-byte request id):
 *  the prompt, tool, mech, fee and response, its request and delivery transactions, and the grade call to make. Public. */
export async function olasRequest(t: OnboardTransport, requestId: string): Promise<Record<string, unknown>> {
  const id = String(requestId ?? '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) throw new RangeError(`an Olas request id is 0x and 64 hex: ${requestId}`);
  return call<Record<string, unknown>>(t, 'GET', `/judge/evidence/olas/${seg(id)}`);
}
