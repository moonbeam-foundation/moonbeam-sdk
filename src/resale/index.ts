/**
 * @moonbeam-foundation/sdk/resale — reselling on Base, the Moonbeam profile of the coordination layer's ONE payment scheme.
 *
 * A reseller is a tenant of the layer whose visitors buy on child keys. Every number a reseller shows or charges comes from the
 * one scheme the layer itself prices with (payment-scheme.mjs, a byte-identical vendored copy pinned by its sha256):
 *
 *   price_to_buyer = seller_price + our_fee + venue_fee(in) + venue_fee(out) [+ reseller_markup]
 *
 * The Moonbeam profile restricts the venues to Base (the owner's rule: Moonbeam resells on Base only) and GLMR stays the money of
 * the assurance hook; the markup is the reseller's own leg (`reseller_markup`), never part of the layer's fee. Everything here is
 * pure except the two reads, which take a transport (a fetch and the site's own same-origin proxy base, as ./onboard does).
 */
import {
  quoteSale as coreQuoteSale, legsOfPayment, venueFeeOf, grossUp, sumOf, FORMULA, RULE, SCHEME_ID, LEGS, VENUE_FEES, OUR_FEE,
  type Quote, type Reseller, type FeeRule, type SchemeLeg, type Units,
} from './payment-scheme.mjs';
import type { OnboardTransport } from '../onboard/index.js';

export { legsOfPayment, venueFeeOf, grossUp, sumOf, FORMULA, RULE, SCHEME_ID, LEGS, VENUE_FEES, OUR_FEE };
export type { Quote, Reseller, FeeRule, SchemeLeg, Units };
/** a quote that was not refused */
export type OkQuote = Extract<Quote, { ok: true }>;

/** The venues a Moonbeam reseller may buy on or hire on: the five Base venues of the standard, and the layer's own doors. */
export const BASE_VENUES = Object.freeze(['x402-base', 'erc8183-base', 'memoacp-base', 'bitagent-base', 'olas-base'] as const);
/** The layer's own labels a quote may name on the selling side (our products, a reseller's own key, the devnet). */
export const OWN_LABELS = Object.freeze(['coord', 'reseller', 'mcp', 'a2a', 'n8n', 'erc8004'] as const);
export type BaseVenue = (typeof BASE_VENUES)[number];
export type OwnLabel = (typeof OWN_LABELS)[number];
export const isBaseVenue = (v: string): v is BaseVenue => (BASE_VENUES as readonly string[]).includes(v);
const allowed = (v: string) => isBaseVenue(v) || (OWN_LABELS as readonly string[]).includes(v);

export type BaseQuoteInput = {
  venue_in: BaseVenue | OwnLabel;
  venue_out: BaseVenue | OwnLabel;
  /** the doer's own price, in the payment's smallest unit (USDC: 6 decimals) */
  seller_price: Units;
  class?: string | null;
  /** the reseller's leg: its tenant id and its markup in basis points of the list price, or in units */
  reseller?: Reseller | null;
  our_fee?: FeeRule;
};

/**
 * The quote a Moonbeam reseller shows: the same numbers the layer charges, on Base venues only. A venue outside Base is refused
 * before the scheme is asked. Pure.
 */
export function quoteBase(i: BaseQuoteInput): Quote | { ok: false; why: string } {
  for (const [k, v] of [['venue_in', i.venue_in], ['venue_out', i.venue_out]] as const) {
    if (!allowed(v)) return { ok: false, why: `${k} ${v} is not a Base venue of the Moonbeam profile (${BASE_VENUES.join(' · ')}) nor one of the layer's own labels (${OWN_LABELS.join(' · ')})` };
  }
  return coreQuoteSale({ venue_in: i.venue_in, venue_out: i.venue_out, class: i.class ?? null, seller_price: i.seller_price, reseller: i.reseller ?? null, our_fee: i.our_fee ?? { rule: 'wall' } });
}

/** The reseller's leg of a quote: what the tenant earns on this sale (0 when its markup is 0). Pure. */
export function markupLeg(q: OkQuote): { units: bigint; tenant: string | null; bps_of_list: number } {
  const leg = q.legs.find((l: SchemeLeg) => l.leg === 'reseller_markup');
  const units = BigInt(leg?.units ?? '0');
  const list = BigInt(q.list_units);
  return { units, tenant: leg?.to ?? null, bps_of_list: list > 0n ? Number((units * 10_000n) / list) : 0 };
}

/** The legs of a quote by name, summed: our_fee · venue_fee · seller_share · reseller_markup. Pure. */
export function legsByName(q: OkQuote): Record<'our_fee' | 'venue_fee' | 'seller_share' | 'reseller_markup', bigint> {
  const of = (leg: string) => q.legs.filter((l: SchemeLeg) => l.leg === leg).reduce((a: bigint, l: SchemeLeg) => a + BigInt(l.units), 0n);
  return { our_fee: of('our_fee'), venue_fee: of('venue_fee'), seller_share: of('seller_share'), reseller_markup: of('reseller_markup') };
}

/** A reseller's markup policy as the layer takes it: basis points per product, `'*'` the default. */
export type MarkupPolicy = Readonly<Record<string, number>>;

/**
 * What a reseller child key is, in the layer's own words: the terms a reseller agrees to when it mints one. Pure data; the
 * markup policy is checked by the layer when the key is minted (`POST /v1/tenant/keys { action: 'child' }`).
 */
export function childKeyTerms(markup: MarkupPolicy = { '*': 0 }): {
  readonly rail: 'balance'; readonly payment_method: 'reseller-child'; readonly markup: MarkupPolicy; readonly says: readonly string[];
} {
  const def = markup['*'] ?? 0;
  return Object.freeze({
    rail: 'balance', payment_method: 'reseller-child', markup,
    says: Object.freeze([
      'the child pays from the reseller’s balance: the wholesale (the list price) leaves the reseller’s balance for the layer’s vault',
      `the child owes the reseller the list price plus its markup (${def} bps by default${Object.keys(markup).filter((k) => k !== '*').length ? ', per product where set' : ''}); the markup is the reseller’s own leg (reseller_markup), never part of the layer’s fee`,
      'the markup is booked by the layer as a ledger row; how a markup above 0 bps is paid out (netted against the wholesale balance, or sent at period close) is the owner’s open decision (register step reseller-markup-payout)',
      'a child’s free grades a day are counted per child and per visitor address, never per user',
    ]),
  });
}

/** The unsigned plan of minting a child key: the call the reseller sends with its own key. Nothing is sent here. Pure. */
export function childKeyPlan(markup: MarkupPolicy = { '*': 0 }, label: string | null = null): { method: 'POST'; path: '/tenant/keys'; body: { action: 'child'; markup_bps: MarkupPolicy; label?: string }; signer: 'the reseller tenant (its own key, X-API-Key)' } {
  for (const [k, v] of Object.entries(markup)) {
    if (!Number.isInteger(v) || v < 0 || v > 100_000) throw new RangeError(`markup_bps.${k} must be a whole number of basis points between 0 and 100000`);
  }
  return { method: 'POST', path: '/tenant/keys', body: { action: 'child', markup_bps: markup, ...(label ? { label } : {}) }, signer: 'the reseller tenant (its own key, X-API-Key)' };
}

/** The unsigned plan of a child topping up its balance through the layer's subscribe door (the x402 quote comes back as a 402). Pure. */
export function subscribePlan(o: { chainId?: 8453; usdc: number; create_key?: boolean } = { usdc: 1 }): { method: 'POST'; path: '/access/subscribe'; body: { chainId: 8453; usdc: number; create_key: boolean }; says: string } {
  if (!(Number.isFinite(o.usdc) && o.usdc > 0)) throw new RangeError('usdc must be a positive amount');
  return { method: 'POST', path: '/access/subscribe', body: { chainId: 8453, usdc: o.usdc, create_key: o.create_key ?? false },
    says: 'the layer answers with the x402 quote (a 402: accepts[] with the vault as payTo on Base); the child signs the USDC transferWithAuthorization with its own wallet; the balance is credited to the key' };
}

/** One resale sale as the layer records it (GET /v1/resale/sales/{id}): the delivery grade and the seller's listing as it stands. */
export type ResaleSale = { ok: true; rule: string } & Record<string, unknown>;
export const SALE_ID_RE = /^rs_[0-9a-z]+_[0-9a-f]{10}$/i;

/** Read one resale sale by its id through the transport (reads only; a bad id is refused before any call). */
export async function readSale(t: OnboardTransport, saleId: string): Promise<ResaleSale> {
  if (!SALE_ID_RE.test(saleId)) throw new RangeError('a sale id is rs_<stamp>_<10 hex> (the `sale.id` of a class wall’s 200 answer)');
  const r = await t.fetch(`${t.base}/resale/sales/${saleId}`, { method: 'GET', headers: { accept: 'application/json', ...(t.apiKey ? { 'x-api-key': t.apiKey } : {}) } });
  const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? `GET /resale/sales/${saleId} → ${r.status}`);
  return j as ResaleSale;
}

/** The reseller's own view (GET /v1/access/reseller): its children, their calls, what it paid at list, what they owe, the margin. */
export async function readResellerView(t: OnboardTransport): Promise<Record<string, unknown>> {
  const r = await t.fetch(`${t.base}/access/reseller`, { method: 'GET', headers: { accept: 'application/json', ...(t.apiKey ? { 'x-api-key': t.apiKey } : {}) } });
  const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; code?: string } | null;
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? `GET /access/reseller → ${r.status}${j?.code ? ` (${j.code})` : ''}`);
  return j;
}

// ── quoteSale and the attested resale steps (0.7.0) ──────────────────────────────────────────────────────────────────
import { attest, attestKeccak, type Attested, type MoonbeamAttestOptions } from '../attest/index.js';

/** quoteSale over the Base venues: the layer's own quoteSale, refused outside Base (the same as quoteBase). Pure. */
export const quoteSale = quoteBase;

/** The steps of a resale the SDK attests: quoted (the terms), paid (the buyer's payment), delivered, settled (the legs). */
export type SaleStep = 'quoted' | 'paid' | 'delivered' | 'settled' | 'refunded';
const STEP_VERDICT: Partial<Record<SaleStep, 1 | 3>> = { delivered: 1, settled: 1, refunded: 3 };
const quoteBody = (q: OkQuote) => JSON.parse(JSON.stringify(q, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

/**
 * The attested mark, the decision-log attestation and (for delivered, settled, refunded) the stamp of one resale step,
 * Base by default (`networks: 'none'` opts out). The subject is the sale key on the contract the step pays through (the
 * wall's payTo, a venue escrow) or the zero address when there is none; the digest is keccak256 of the step's canonical body.
 */
export function attestSale(a: { saleKey: string; step: SaleStep; quote?: OkQuote; tx?: string | null; contract?: string; body?: unknown }, opts: MoonbeamAttestOptions = {}): Attested {
  if (!a.saleKey) throw new RangeError('a sale key names the sale');
  return attest({
    kind: `resale.${a.step}`,
    subject: { chainId: 8453, contract: a.contract ?? `0x${'0'.repeat(40)}`, jobId: attestKeccak(a.saleKey) },
    body: { v: 'resale.step.v1', sale: a.saleKey, step: a.step, quote: a.quote ? quoteBody(a.quote) : null, tx: a.tx ?? null, extra: a.body ?? null },
    model: `det:resale-${a.step}-v1`,
    verdict: STEP_VERDICT[a.step] ?? null,
    mode: 1,
  }, opts);
}
