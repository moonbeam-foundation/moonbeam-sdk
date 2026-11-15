/**
 * @moonbeam-foundation/sdk/resale — reselling on Base, the Moonbeam profile of the ONE payment scheme Moonbeam prices with.
 *
 * A reseller is a tenant of Moonbeam whose visitors buy on child keys. Every number a reseller shows or charges comes from the
 * one scheme Moonbeam itself prices with (payment-scheme.mjs, a vendored copy whose source is pinned by its sha256):
 *
 *   price_to_buyer = seller_price + our_fee + venue_fee(in) + venue_fee(out)
 *
 * The Moonbeam profile sells on Base (the buyer pays on a Base venue) and GLMR stays the money of the assurance hook; the
 * seller's leg is paid where the seller was hired, on the network, token and payTo of its own offer (sellerRailOf,
 * SETTLE_ON_SELLER_VENUE_v1). Moonbeam prices are undercut only: a reseller's child key sells at the list price, and a quote here
 * takes no reseller leg on top of it. Everything here is pure except the two reads, which take a transport (a fetch and the site's own same-origin proxy base, as ./onboard does).
 */
import {
  quoteSale as coreQuoteSale, legsOfPayment as coreLegsOfPayment, venueFeeOf, grossUp, sumOf, RULE, SCHEME_ID, LEGS as SCHEME_LEGS, VENUE_FEES, OUR_FEE,
  type Quote, type FeeRule, type SchemeLeg, type Units,
} from './payment-scheme.mjs';
import type { OnboardTransport } from '../onboard/index.js';
import { jsonOf, okOrThrow } from '../errors/index.js';

export { venueFeeOf, grossUp, sumOf, RULE, SCHEME_ID, VENUE_FEES, OUR_FEE };

/** The one formula, as Moonbeam prices: undercut only, nothing on top of the list price. */
export const FORMULA = 'price_to_buyer = seller_price + our_fee + venue_fee(in) + venue_fee(out)';

type LegId = 'our_fee' | 'venue_fee' | 'seller_share' | 'provider' | 'graders' | 'ecosystem';
const LEG_WORDS: Record<LegId, string> = {
  our_fee: 'our_fee: Moonbeam’s fee on the sale, by the rule of the door the buyer bought through; it does not depend on the venue',
  venue_fee: 'venue_fee: what the venue itself takes, on the buying side (in) and on the selling side (out); its own basis points on its own base, never part of our fee',
  seller_share: 'seller_share: what the doer receives: paid − our_fee − venue_fee; exactly its price on a paid ending',
  provider: 'provider: a metered call: the provider’s part of the list price',
  graders: 'graders: a metered call: the graders’ part of the list price',
  ecosystem: 'ecosystem: a metered call: the ecosystem’s part of the list price',
};
/** A quote as Moonbeam states it: its formula, and no reseller leg (always 0 here: undercut only). The units are untouched. */
function inMoonbeamWords(q: Quote): Quote {
  if (!q.ok) return q;
  return { ...q, formula: FORMULA, legs: q.legs.filter((l: SchemeLeg) => !(l.leg === 'reseller_markup' && BigInt(l.units) === 0n)) } as Quote;
}

/** The legs of the scheme a Moonbeam sale books, each in Moonbeam's words. */
export const LEGS = Object.freeze(SCHEME_LEGS.filter((l) => l.id in LEG_WORDS).map((l) => Object.freeze({ ...l, what: LEG_WORDS[l.id as LegId] })));

/** Book a paid sale into its legs (the scheme's legsOfPayment). Undercut only: a reseller leg on top of the list price is refused. Pure. */
export function legsOfPayment(p: Omit<Parameters<typeof coreLegsOfPayment>[0], 'reseller'>): ReturnType<typeof coreLegsOfPayment> | { ok: false; why: string } {
  if ((p as { reseller?: unknown }).reseller) return { ok: false, why: 'Moonbeam prices are undercut only: a sale books no reseller leg on top of the list price' };
  return coreLegsOfPayment({ ...p, reseller: null });
}
export type { Quote, FeeRule, SchemeLeg, Units };
/** a quote that was not refused */
export type OkQuote = Extract<Quote, { ok: true }>;

/** The venues a Moonbeam reseller may buy on or hire on: the five Base venues of the standard, and Moonbeam's own doors. */
export const BASE_VENUES = Object.freeze(['x402-base', 'erc8183-base', 'memoacp-base', 'bitagent-base', 'olas-base'] as const);
/** Moonbeam's own labels a quote may name on the selling side (our products, a reseller's own key, the devnet). */
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
  our_fee?: FeeRule;
};

/**
 * The quote a Moonbeam reseller shows: the same numbers Moonbeam charges, on Base venues only. A venue outside Base is refused
 * before the scheme is asked. Pure.
 */
export function quoteBase(i: BaseQuoteInput): Quote | { ok: false; why: string } {
  // 0.13.0: undercut only, so a quote takes no reseller leg on top of the list price
  if ((i as { reseller?: unknown }).reseller) return { ok: false, why: 'Moonbeam prices are undercut only: a quote takes no reseller leg on top of the list price' };
  for (const [k, v] of [['venue_in', i.venue_in], ['venue_out', i.venue_out]] as const) {
    if (!allowed(v)) return { ok: false, why: `${k} ${v} is not a Base venue of the Moonbeam profile (${BASE_VENUES.join(' · ')}) nor one of Moonbeam's own labels (${OWN_LABELS.join(' · ')})` };
  }
  return inMoonbeamWords(coreQuoteSale({ venue_in: i.venue_in, venue_out: i.venue_out, class: i.class ?? null, seller_price: i.seller_price, reseller: null, our_fee: i.our_fee ?? { rule: 'wall' } }));
}

/** The legs of a quote by name, summed: our_fee · venue_fee · seller_share. Pure. */
export function legsByName(q: OkQuote): Record<'our_fee' | 'venue_fee' | 'seller_share', bigint> {
  const of = (leg: string) => q.legs.filter((l: SchemeLeg) => l.leg === leg).reduce((a: bigint, l: SchemeLeg) => a + BigInt(l.units), 0n);
  return { our_fee: of('our_fee'), venue_fee: of('venue_fee'), seller_share: of('seller_share') };
}

/**
 * What a reseller child key is, in Moonbeam's own words: the terms a reseller agrees to when it mints one. Pure data. Moonbeam
 * prices are undercut only, so a child key sells at the list price (`POST /v1/tenant/keys { action: 'child' }`).
 */
export function childKeyTerms(): { readonly rail: 'balance'; readonly payment_method: 'reseller-child'; readonly says: readonly string[] } {
  return Object.freeze({
    rail: 'balance', payment_method: 'reseller-child',
    says: Object.freeze([
      'the child pays from the reseller’s balance: the list price leaves the reseller’s balance for Moonbeam’s vault',
      'the child owes the reseller the list price, and nothing on top of it: Moonbeam prices are undercut only',
      'a child’s free grades a day are counted per child and per visitor address, never per user',
    ]),
  });
}

/**
 * The unsigned plan of minting a child key: the call the reseller sends with its own key. Nothing is sent here. Pure. The key
 * sells at the list price. (0.12 took a price policy first; one whose every value is 0 is still read, any other is refused.)
 */
export function childKeyPlan(label: string | null = null, ...legacy: unknown[]): { method: 'POST'; path: '/tenant/keys'; body: { action: 'child'; label?: string }; signer: 'the reseller tenant (its own key, X-API-Key)' } {
  let name: unknown = label;
  if (label !== null && typeof label === 'object') {
    if (Object.values(label as Record<string, unknown>).some((v) => v !== 0)) throw new RangeError('Moonbeam prices are undercut only: a child key sells at the list price, with nothing on top');
    name = legacy[0] ?? null;
  }
  if (name !== null && (typeof name !== 'string' || !name.trim() || name.length > 60)) throw new RangeError('a child key\'s label is 1 to 60 characters');
  return { method: 'POST', path: '/tenant/keys', body: { action: 'child', ...(name ? { label: name as string } : {}) }, signer: 'the reseller tenant (its own key, X-API-Key)' };
}

/** The unsigned plan of a child topping up its balance through Moonbeam's subscribe door (the x402 quote comes back as a 402). Pure. */
export function subscribePlan(o: { chainId?: number; usdc: number; create_key?: boolean } = { usdc: 1 }): { method: 'POST'; path: '/access/subscribe'; body: { chainId: number; usdc: number; create_key: boolean }; says: string } {
  if (!(Number.isFinite(o.usdc) && o.usdc > 0)) throw new RangeError('usdc must be a positive amount');
  const chainId = o.chainId ?? 8453;
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new RangeError('chainId is a positive chain id');
  return { method: 'POST', path: '/access/subscribe', body: { chainId, usdc: o.usdc, create_key: o.create_key ?? false },
    says: `Moonbeam answers with the x402 quote (a 402: accepts[] with the vault as payTo, one entry per network it settles on; the SDK picks chain ${chainId}'s); the child signs the dollar token's transferWithAuthorization with its own wallet; the balance is credited to the key` };
}

/** One resale sale as Moonbeam records it (GET /v1/resale/sales/{id}): the delivery grade and the seller's listing as it stands. */
export type ResaleSale = { ok: true; rule: string } & Record<string, unknown>;
export const SALE_ID_RE = /^rs_[0-9a-z]+_[0-9a-f]{10}$/i;

/** Read one resale sale by its id through the transport (reads only; a bad id is refused before any call). */
export async function readSale(t: OnboardTransport, saleId: string): Promise<ResaleSale> {
  if (!SALE_ID_RE.test(saleId)) throw new RangeError('a sale id is rs_<stamp>_<10 hex> (the `sale.id` of a class wall’s 200 answer)');
  const r = await t.fetch(`${t.base}/resale/sales/${saleId}`, { method: 'GET', headers: { accept: 'application/json', ...(t.apiKey ? { 'x-api-key': t.apiKey } : {}) } });
  return okOrThrow<ResaleSale>(r, await jsonOf(r), `GET /resale/sales/${saleId}`);
}

/** The reseller's own view (GET /v1/access/reseller): its children, their calls, what it paid at list, what they owe, the margin. */
export async function readResellerView(t: OnboardTransport): Promise<Record<string, unknown>> {
  const r = await t.fetch(`${t.base}/access/reseller`, { method: 'GET', headers: { accept: 'application/json', ...(t.apiKey ? { 'x-api-key': t.apiKey } : {}) } });
  return okOrThrow<Record<string, unknown>>(r, await jsonOf(r), 'GET /access/reseller');
}

// ── quoteSale and the attested resale steps (0.7.0) ──────────────────────────────────────────────────────────────────
import { attest, attestKeccak, type Attested, type MoonbeamAttestOptions } from '../attest/index.js';

/** Every venue the payment scheme prices: where a seller can be hired (venue_out), on its own network. */
export const SELLER_VENUES = Object.freeze(Object.keys(VENUE_FEES)) as readonly string[];

/**
 * quoteSale: the buyer pays on a Base venue (or one of Moonbeam's own doors), as the Moonbeam profile requires; the seller's
 * leg is on the venue it was hired on, any venue the scheme prices (x402 on Solana or Arbitrum, ACP v3 on Arc, …), never
 * moved to Base for it (SETTLE_ON_SELLER_VENUE_v1: sellerRailOf says where that leg settles). quoteBase keeps both sides
 * on Base. Pure.
 */
export function quoteSale(i: Omit<BaseQuoteInput, 'venue_out'> & { venue_out: string }): Quote | { ok: false; why: string } {
  if (!allowed(i.venue_in)) return { ok: false, why: `venue_in ${i.venue_in} is not a Base venue of the Moonbeam profile (${BASE_VENUES.join(' · ')}) nor one of Moonbeam's own labels (${OWN_LABELS.join(' · ')})` };
  if (!SELLER_VENUES.includes(i.venue_out) && !(OWN_LABELS as readonly string[]).includes(i.venue_out)) return { ok: false, why: `venue_out ${i.venue_out} is not a venue the payment scheme prices (${SELLER_VENUES.join(' · ')})` };
  return inMoonbeamWords(coreQuoteSale({ venue_in: i.venue_in, venue_out: i.venue_out, class: i.class ?? null, seller_price: i.seller_price, reseller: null, our_fee: i.our_fee ?? { rule: 'wall' } }));
}

export { SETTLE_RULE, PAY_TOKENS, SETTLE_NETWORK_ALIASES, VENUE_RAILS, FREE_ENROLLED, sellerRailOf } from './settle-rule.js';
export type { SettleToken, SellerOffer, SellerRail } from './settle-rule.js';

/** The steps of a resale the SDK attests: quoted (the terms), paid (the buyer's payment), delivered, settled (the legs). */
export type SaleStep = 'quoted' | 'paid' | 'delivered' | 'settled' | 'refunded';
const STEP_VERDICT: Partial<Record<SaleStep, 1 | 3>> = { delivered: 1, settled: 1, refunded: 3 };
const quoteBody = (q: OkQuote) => JSON.parse(JSON.stringify(q, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

/**
 * The attested mark, the decision-log attestation and (for delivered, settled, refunded) the stamp of one resale step,
 * Base by default (`networks: 'none'` opts out). The subject is the sale key on the contract the step pays through (the
 * wall's payTo, a venue escrow) or the zero address when there is none; the digest is keccak256 of the step's canonical body.
 */
export function attestSale(a: { saleKey: string; step: SaleStep; quote?: OkQuote; tx?: string | null; contract?: string; body?: unknown; chainId?: number }, opts: MoonbeamAttestOptions = {}): Attested {
  if (!a.saleKey) throw new RangeError('a sale key names the sale');
  return attest({
    kind: `resale.${a.step}`,
    // the chain the step pays through (a seller paid on its own venue names that chain); Base by default
    subject: { chainId: a.chainId ?? 8453, contract: a.contract ?? `0x${'0'.repeat(40)}`, jobId: attestKeccak(a.saleKey) },
    body: { v: 'resale.step.v1', sale: a.saleKey, step: a.step, quote: a.quote ? quoteBody(a.quote) : null, tx: a.tx ?? null, extra: a.body ?? null },
    model: `det:resale-${a.step}-v1`,
    verdict: STEP_VERDICT[a.step] ?? null,
    mode: 1,
  }, opts);
}
