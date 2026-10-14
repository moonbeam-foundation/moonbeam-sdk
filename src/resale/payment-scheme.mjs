/**
 * automatch/payment-scheme.mjs — _ONE_PAYMENT_SCHEME_v1_ (2026-10-12; the owner, on learning that the memo router charges 20 %,
 * ERC-8183 5 % + 5 %, BitAgent nothing, and that those fees were recorded differently per venue: "this must be always the same
 * payment scheme to any-to-any agents and reseller"). ONE scheme for every sale the layer makes as seller of record, whatever the
 * venue the buyer buys on (venue_in) and the venue the seller is hired on (venue_out):
 *
 *   price_to_buyer = seller_price + our_fee + venue_fee(in) + venue_fee(out) [+ reseller_markup]
 *
 * The buyer pays coord once. What it paid leaves again as named legs, in whole units, and the legs sum to the payment exactly:
 *   our_fee          coord's fee, by the rule of the door the buyer bought through (OUR_FEE.rules); on the wire and in the ledger: `fee`
 *   venue_fee        what a VENUE itself takes, on the buying side (in) and on the selling side (out): the venue's own basis points on
 *                    its own base, rounded as its contract rounds. Its own leg and its own ledger account; never part of our fee or
 *                    of a reseller's markup
 *   seller_share     what the doer receives: exactly its price on a paid ending
 *   reseller_markup  a reseller tenant's leg, when its child bought
 *   provider · graders · ecosystem   a metered call: the split of the wholesale (the site’s lib/usage-settle), unchanged
 * A venue that takes its fee out of the money on its own side (`taken: at_source`) is grossed up for: the amount that enters it is
 * the smallest one whose net is the price wanted, so the doer still receives its price and our fee does not move with the venue.
 *
 * The per-venue facts (VENUE_FEES) are typed HERE, once, each with the contract read it rests on; schemas/transitions.json
 * `seller_coord_buyer.payment_scheme` is generated from this module (schemas/scripts/seller-coord-buyer.src.mjs), and every caller
 * (redirect.mjs, escrow-job.mjs, olas-out.mjs, doer-pay.mjs, pipeline/reseller/fold.mjs; the site’s lib/acp-sales, venue-targets)
 * computes through the functions below. Pure and self-contained: no import, no I/O. The site keeps a byte-identical copy at
 * src/lib/payment-scheme.mjs (sha256 pinned on both sides).
 */

export const RULE = 'ONE_PAYMENT_SCHEME_v1';
export const SCHEME_ID = 'taifoon.payment.scheme.v1';
export const FORMULA = 'price_to_buyer = seller_price + our_fee + venue_fee(in) + venue_fee(out) [+ reseller_markup]';
export const BPS = 10_000n;
/** label values that are not a venue of the standard: the layer's own resources, the contributors' pool, a reseller tenant's key, the
 *  test network, a sale nobody opened. Nothing is taken there. */
export const OWN_VENUES = Object.freeze(['coord', 'grid', 'reseller', 'devnet', 'unknown']);

/** The legs of the scheme, in the order they are written. `ledger_leg` is the leg's name in the ledger, the events and the metric
 *  coord_sale_units_total{leg}; `account` is where the ledger credits it. */
export const LEGS = Object.freeze([
  Object.freeze({ id: 'our_fee', ledger_leg: 'fee', account: 'fee:coord', to: 'coord', what: 'coord’s fee on the sale, by the rule of the door the buyer bought through; it does not depend on the venue' }),
  Object.freeze({ id: 'venue_fee', ledger_leg: 'venue_fee', account: 'fee:venue:<venue> (its platform part) · fee:venue:<venue>-evaluator (its evaluator part)', to: 'the venue', sides: Object.freeze(['in', 'out']), what: 'what the venue itself takes: on the buying side (in) and on the selling side (out); its own basis points on its own base, never part of our fee or of a reseller’s markup' }),
  Object.freeze({ id: 'seller_share', ledger_leg: 'seller_share', account: 'payable:doer:<payee> · held:doer:<ref> (fee:coord when our own product served)', to: 'the doer', what: 'what the doer receives: paid − our_fee − venue_fee − reseller_markup; exactly its price on a paid ending' }),
  Object.freeze({ id: 'reseller_markup', ledger_leg: 'reseller_markup', account: 'markup:reseller:<tenant>', to: 'the reseller tenant', what: 'a reseller tenant’s own leg on top of the list price, when its child bought' }),
  Object.freeze({ id: 'provider', ledger_leg: 'provider', account: 'payable:contributor:<wallet> · fee:coord (our own resource)', to: 'the resource that answered', what: 'a metered call: the provider’s part of the wholesale' }),
  Object.freeze({ id: 'graders', ledger_leg: 'graders', account: 'pool:graders', to: 'the graders’ pool', what: 'a metered call: the graders’ part of the wholesale' }),
  Object.freeze({ id: 'ecosystem', ledger_leg: 'ecosystem', account: 'pool:ecosystem', to: 'coord', what: 'a metered call: the ecosystem’s part of the wholesale' }),
]);
/** the legs a refund or a loss writes instead (the redirect record's own: seller_coord_buyer.redirect.refund_policy) */
export const ENDING_LEGS = Object.freeze(['refund', 'loss']);

/**
 * Our fee, by the door the buyer bought through. These are the rules that already ran; none is new.
 *   wall       a class wall (an x402 payment, a venue job that names a wall, an MCP wall tool): max(20 %, 0.002 USDC) of the wall's list
 *              price, rounded up, never above the price. The list price is seller_price + our_fee: what the buyer pays where no venue
 *              takes anything
 *   job_quote  a job settled on the assurance hook: the answer of GET /v1/fees/quote (the site’s lib/job-fee: max(bps of the price,
 *              our gas + margin), at most the hook's 10 %), escrowed on top of the price. It needs live gas, so it comes in as units
 *   metered    a metered call (RPC, GPU, TEE, forecast): no fee leg; the wholesale is split provider · graders · ecosystem
 */
export const OUR_FEE = Object.freeze({
  rules: Object.freeze({
    wall: Object.freeze({ id: 'wall', door: 'a class wall: an x402 payment, a venue job that names a wall, an MCP wall tool', bps: 2000, min_units: 2000, min_units_of: 'a token of 6 decimals (USDC): 0.002', rounding: 'ceil', base: 'the list price (seller_price + our_fee): what the buyer pays where no venue takes anything', never_above: 'the list price',
      code: 'automatch/payment-scheme.mjs ourFeeOf (pipeline/reseller/fold.mjs resaleTerms and the site’s lib/venue-targets call it)' }),
    job_quote: Object.freeze({ id: 'job_quote', door: 'a job settled on the assurance hook (POST /v1/settle, a demand)', base: 'the job’s price', on_top: true,
      code: 'site src/lib/job-fee.ts jobFee · GET /v1/fees/quote (it reads live gas: its answer comes in as units)' }),
    metered: Object.freeze({ id: 'metered', door: 'a metered call paid from a key’s balance or an own wall', base: 'the wholesale', legs: Object.freeze(['provider', 'graders', 'ecosystem']),
      code: 'site src/lib/usage-settle.ts usageLegs (TSUL_SPLIT_BPS)' }),
  }),
});

// ── the per-venue facts ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const ON_REFUND_ESCROW = Object.freeze({ venue_ending: 'returned', venue_ending_why: 'the venue takes its fee only on the paid ending: on a reject or an expiry the whole budget goes back to the client, no fee was taken', after_paid_ending: 'lost', after_paid_ending_why: 'a paid ending is final on the venue: a refund coord makes afterwards comes from coord’s own money, the venue keeps its fee' });
const ON_REFUND_NONE = Object.freeze({ venue_ending: 'none', venue_ending_why: 'the venue takes no fee and has no refund of its own', after_paid_ending: 'none', after_paid_ending_why: 'no venue fee was taken: nothing of it is lost or returned' });
// A venue's contract is named by its entry of the address registry (packages/addresses: system, chain, name), never by a
// literal here: the registry is the one place a contract address lives, and whoever needs the address resolves the reference
// (schemeBlock(facts, { addressOf })). A venue's own treasury is no registry contract: it is the third party's account, as its contract
// reads it (platformTreasury()), and the fork proof holds it to the chain on every run.
const E = 'standards-erc8183';
const ref = (chain, name) => Object.freeze({ system: E, chain, name });
const V3 = (chain) => ref(chain, 'Virtuals ACP v3 (ERC-8183)');
const V3_TREASURY = '0x3F833Be7447F82E8654Bc634981899db0ee8042E';
const part = (id, bps, to, { to_address = null, to_ref = null, when = 'always' } = {}) => Object.freeze({ part: id, bps, to, to_address, to_ref, when });
const escrow = ({ contract, chain, block, platform, evaluator, treasury, name, how = null }) => Object.freeze({
  status: 'read', taken: 'at_source', rounding: 'floor', base: 'the job’s budget, as escrowed',
  parts: Object.freeze([part('platform', platform, 'the venue’s platform treasury', { to_address: treasury }), part('evaluator', evaluator, 'the job’s evaluator (the address that completed the job; ours when our own evaluator seat completed it)', { when: 'evaluator_set' })]),
  on_refund: platform + evaluator > 0 ? ON_REFUND_ESCROW : Object.freeze({ ...ON_REFUND_NONE, venue_ending_why: 'the venue reads 0 + 0: it takes nothing; on a reject or an expiry the whole budget goes back to the client' }),
  evidence: Object.freeze({ contract, chain, name, reads: Object.freeze([`platformFeeBP() = ${platform}`, `evaluatorFeeBP() = ${evaluator}`, `platformTreasury() = ${treasury}`]), block, read_at: '2026-10-12',
    how: how ?? `eth_call on chain ${chain} at block ${block}; automatch/escrow-job.fork.mjs asserts the reads and the amounts the contract moves on every run` }),
});
const olas = ({ chain, block }) => Object.freeze({
  status: 'read', taken: 'at_source', rounding: 'ceil', base: 'the mech’s balance in the marketplace’s balance tracker when the mech withdraws it; for one request alone, its delivery rate',
  parts: Object.freeze([part('platform', 1500, 'the marketplace’s balance tracker (collectedFees, drained by the Olas DAO’s drainer)', { to_ref: ref(chain, 'Olas balance tracker (native)') })]),
  on_refund: Object.freeze({ venue_ending: 'returned', venue_ending_why: 'the fee is charged on what a mech earned, when it withdraws: a request no mech delivered earns nothing, so no fee is taken', after_paid_ending: 'lost', after_paid_ending_why: 'a delivered request is final on the marketplace: a refund coord makes afterwards comes from coord’s own money' }),
  evidence: Object.freeze({ contract: ref(chain, 'Olas Mech Marketplace'), chain, name: 'Olas Mech Marketplace', reads: Object.freeze(['fee() = 1500', 'MAX_FEE_FACTOR() = 10000']), block, read_at: '2026-10-12',
    how: chain === 8453 ? `eth_call on chain ${chain} at block ${block}; the rounding and the base were measured on a fork of Base at block 52515643 (processPaymentByMultisig on the native balance tracker: a balance of 100 pays the mech 85 and adds 15 to collectedFees; 133 → fee 20; 7 → fee 2; 10001 → fee 1501); automatch/olas-out.fork.mjs asserts it on every run`
      : `eth_call on chain ${chain} at block ${block}; the rounding is the Base deployment’s (the same marketplace contract), not measured on this chain` }),
});
const X402_NONE = (network) => Object.freeze({ status: 'none', taken: null, rounding: 'floor', base: 'the payment', parts: Object.freeze([]), on_refund: ON_REFUND_NONE,
  evidence: Object.freeze({ contract: null, chain: network, name: 'x402 exact scheme', reads: Object.freeze([]), block: null, read_at: '2026-10-12',
    how: `the exact scheme has no fee step: the settle transaction moves accepts[].amount whole to payTo (EIP-3009 transferWithAuthorization; an SPL transfer on Solana). ${network === 'eip155:8453' ? 'On the chain itself: the wall sale settled in 0x0c7b6a48271047776138afc83a605e095b908e2e79f445423419d74b291644dd (Base block 52501615) is ONE USDC Transfer of 11667 from the payer to the wall’s payTo, the amount the sale row names' : 'Measured on Base (one settle transaction read); on this network it is the scheme’s own rule, no settle transaction of a wall was read here'}. A facilitator bills its own customer apart from the payment; that bill is not read` }) });
const WIRE_NONE = Object.freeze({ status: 'none', taken: null, rounding: 'floor', base: 'none', parts: Object.freeze([]), on_refund: ON_REFUND_NONE,
  evidence: Object.freeze({ contract: null, chain: null, name: 'no payment step', reads: Object.freeze([]), block: null, read_at: '2026-10-12', how: 'the protocol has no payment step: a purchase through it is paid on one of the layer’s own doors (a class wall’s x402 payment, the assurance hook), named in the adapter’s settle.doors' }) });

/**
 * What each venue of the standard takes, as read on its chain on 2026-10-12. `status`: read (a contract states it) · none (the venue has
 * no fee step). `taken`: at_source (out of the money on the venue's own side, before the payee is paid) · from_payment (coord pays it
 * out of what it received) · null (nothing is taken). `parts[].when`: evaluator_set = only for a job that names an evaluator.
 */
export const VENUE_FEES = Object.freeze({
  'x402-base': X402_NONE('eip155:8453'), 'x402-solana': X402_NONE('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'), 'x402-arbitrum': X402_NONE('eip155:42161'), 'x402-robinhood': X402_NONE('eip155:4663'), 'x402-monad': X402_NONE('eip155:143'),
  'erc8183-base': escrow({ contract: V3(8453), chain: 8453, block: 52515498, platform: 500, evaluator: 500, treasury: V3_TREASURY, name: 'Virtuals ACP v3 (ERC-8183)',
    how: 'eth_call on chain 8453 at block 52515498; automatch/escrow-job.fork.mjs asserts the reads and the amounts the contract moves on every run; on the chain itself: job erc8183:8453:81734, budget 2222, completed in 0x4764bd2af1bce296eb29328fa519bae5a30ad7908b592f780b655b5c515b46b9 (111 to the treasury, 111 to the evaluator, 2000 to the provider)' }),
  'memoacp-base': escrow({ contract: ref(8453, 'memo-ACP payment manager'), chain: 8453, block: 52515498, platform: 2000, evaluator: 0, treasury: '0xE9683559A1177A83825A42357a94F61b26cd64C1', name: 'Virtuals memo-ACP PaymentManager' }),
  'acpv3-arc': escrow({ contract: V3(5042), chain: 5042, block: 25606479, platform: 500, evaluator: 500, treasury: V3_TREASURY, name: 'Virtuals ACP v3 (ERC-8183)', how: 'eth_call on chain 5042 at block 25606479; no job of ours has run on this chain, so the amounts are the Base deployment’s rule (the same contract address), not measured here' }),
  'acpv3-robinhood': escrow({ contract: V3(4663), chain: 4663, block: 86795902, platform: 500, evaluator: 500, treasury: V3_TREASURY, name: 'Virtuals ACP v3 (ERC-8183)', how: 'eth_call on chain 4663 at block 86795902; no job of ours has run on this chain, so the amounts are the Base deployment’s rule (the same contract address), not measured here' }),
  'bitagent-base': escrow({ contract: ref(8453, 'BitAgent ERC-8183 escrow'), chain: 8453, block: 52515498, platform: 0, evaluator: 0, treasury: '0xF0A45416394ce78F18aC4CE8AE6c6fF8Cfb4455f', name: 'BitAgent ERC-8183 escrow' }),
  'olas-gnosis': olas({ chain: 100, block: 48720836 }),
  'olas-polygon': olas({ chain: 137, block: 95410212 }),
  'olas-base': olas({ chain: 8453, block: 52515630 }),
  mcp: WIRE_NONE, a2a: WIRE_NONE, erc8004: WIRE_NONE, n8n: WIRE_NONE,
  // ── venues the one resolver walks that are NO adapter of the standard (`adapter: false`): a sibling of a family, declared here so its
  // jobs are booked by the same scheme; it becomes an adapter's entry when the standard gains the adapter ──────────────────────────────
  'aqueous-monad': Object.freeze({ status: 'none', adapter: false, taken: null, rounding: 'floor', base: 'the amount the buyer settles', parts: Object.freeze([]),
    on_refund: Object.freeze({ ...ON_REFUND_NONE, venue_ending_why: 'the escrow takes nothing: the buyer settles what it accepts and the rest is returned in the same transaction; an undelivered job is refunded whole after its deadline' }),
    evidence: Object.freeze({ contract: null, chain: 143, name: 'Aqueous escrow on Monad (an outside developer’s contract; its address is automatch/escrow-sig.venues.json aqueous-monad.escrow, not in the address registry yet)', reads: Object.freeze([]), block: 112798206, read_at: '2026-10-12',
      how: 'settleMetered pays the agent units × pricePerUnit and returns the rest, with no fee: on a fork of Monad at block 112798206 a job of 10000 paid the agent 10000 and returned 0 (automatch/fixtures/escrow-sig-fork-proof-2026-10-12.json, scenario metered.pass); automatch/escrow-sig.fork.mjs asserts it on every run. FORK-ONLY: nothing of ours was sent on Monad. Not an adapter of the standard: the signed-escrow sibling of the escrow-job family (automatch/escrow-sig.mjs), job.out only' }) }),
});

// ── the arithmetic ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const whole = (v) => { try { if (typeof v === 'bigint') return v >= 0n ? v : null; if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null; if (typeof v === 'string' && /^\d{1,78}$/.test(v)) return BigInt(v); } catch { /* not a whole amount */ } return null; };
const factsOf = (venue, facts = VENUE_FEES) => {
  if (OWN_VENUES.includes(venue)) return null;
  const f = facts[venue];
  if (!f) throw new Error(`venue ${venue} has no payment_scheme entry: a venue is quoted and booked only when its fee is declared (automatch/payment-scheme.mjs VENUE_FEES)`);
  return f;
};
const feeOfBps = (base, bps, rounding) => (rounding === 'ceil' ? (base * BigInt(bps) + (BPS - 1n)) / BPS : (base * BigInt(bps)) / BPS);

/**
 * What a venue takes of `base` (the amount that enters it): { venue, base, total, net, parts: [{ part, bps, units, to, to_address }],
 * taken, rounding }. `o.evaluator_set` false: the job names no evaluator, so no evaluator part. `o.as_read`: { platform_bps,
 * evaluator_bps } as they were read for this one job (a venue may change its fees; the declared ones are the default). Throws on a
 * venue with no entry and on fees that are not a share of the base. Pure.
 */
export function venueFeeOf(venue, base, o = {}) {
  const B = whole(base); if (B === null) throw new Error(`the base of a venue fee is a whole amount, not ${String(base)}`);
  const f = factsOf(venue, o.facts);
  if (!f) return { venue, base: B, total: 0n, net: B, parts: [], taken: null, rounding: 'floor' };
  const parts = [];
  for (const p of f.parts) {
    if (p.when === 'evaluator_set' && o.evaluator_set === false) continue;
    const read = o.as_read ? o.as_read[`${p.part}_bps`] : undefined;
    const bps = read === undefined || read === null ? p.bps : typeof read === 'number' ? read : typeof read === 'bigint' || (typeof read === 'string' && /^\d{1,5}$/.test(read)) ? Number(read) : NaN; // as read: a number or a string of digits, never a guess
    if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error(`venue ${venue}: ${p.part} fee of ${String(read ?? p.bps)} bps is not a share of the base`);
    if (bps === 0) continue; // a part the venue reads as zero takes nothing: it is no leg
    parts.push({ part: p.part, bps, units: feeOfBps(B, bps, f.rounding).toString(), to: p.to, to_address: p.to_address, to_ref: p.to_ref });
  }
  const total = parts.reduce((a, p) => a + BigInt(p.units), 0n);
  if (parts.reduce((a, p) => a + p.bps, 0) > 10_000 || total > B) throw new Error(`venue ${venue}: fees of ${parts.map((p) => p.bps).join(' + ')} bps are not a share of the base`);
  return { venue, base: B, total, net: B - total, parts, taken: parts.length ? f.taken : null, rounding: f.rounding };
}

/**
 * The gross-up: the smallest amount that must enter `venue` so that `net` is left after the venue's fee (the doer still receives its
 * price; a wall's list price still reaches us). { venue, net, gross, fee } with fee = venueFeeOf(venue, gross). Pure.
 */
export function grossUp(venue, net, o = {}) {
  const N = whole(net); if (N === null) throw new Error(`a price is a whole amount, not ${String(net)}`);
  const f = factsOf(venue, o.facts);
  if (!f) return { venue, net: N, gross: N, fee: venueFeeOf(venue, N, o) };
  const cut = BigInt(venueFeeOf(venue, BPS, o).parts.reduce((a, p) => a + p.bps, 0));
  if (cut >= BPS) throw new Error(`venue ${venue}: its fees leave the payee nothing`);
  // each part is rounded on its own, so the net is not gross·(1 − cut) exactly: start just under the estimate and walk up
  let G = N > 2n ? ((N - 2n) * BPS) / (BPS - cut) : 0n;
  if (G < N) G = N;
  let fee = venueFeeOf(venue, G, o);
  while (fee.net < N) { G += 1n; fee = venueFeeOf(venue, G, o); }
  return { venue, net: N, gross: G, fee };
}

/** Our fee by a rule of OUR_FEE on `base` (wall: the list price; job_quote: the quote's own units). Throws on a rule that is not one. Pure. */
export function ourFeeOf(fee, base) {
  const B = whole(base); if (B === null) throw new Error(`the base of our fee is a whole amount, not ${String(base)}`);
  const id = fee?.rule;
  if (id === 'wall') { const r = OUR_FEE.rules.wall; const pct = feeOfBps(B, r.bps, r.rounding); const f = pct > BigInt(r.min_units) ? pct : BigInt(r.min_units); return f > B ? B : f; }
  if (id === 'job_quote') { const u = whole(fee.units); if (u === null) throw new Error('the hook’s fee is the answer of the fee quote (GET /v1/fees/quote), in whole units: there is no default here'); return u; }
  if (id === 'metered' || id === 'none') return 0n;
  throw new Error(`${String(id)} is not a fee rule of the scheme (${Object.keys(OUR_FEE.rules).join(' · ')})`);
}
/** The list price of a seller price under a fee rule: the smallest price whose fee leaves the seller its price (what the buyer pays where no venue takes anything). Pure. */
export function listPriceOf(fee, sellerPrice) {
  const S = whole(sellerPrice); if (S === null) throw new Error(`a seller price is a whole amount, not ${String(sellerPrice)}`);
  if (fee?.rule !== 'wall') return S + ourFeeOf(fee, S);
  const r = OUR_FEE.rules.wall; const min = BigInt(r.min_units);
  // a price of zero (our own product, nothing owed outside) lists at the fee's floor
  let L = S + min; if (ourFeeOf(fee, L) <= min) return L;
  L = (S * BPS) / (BPS - BigInt(r.bps)); if (L < S + min) L = S + min;
  while (L - ourFeeOf(fee, L) < S) L += 1n;
  while (L > S + min && L - 1n - ourFeeOf(fee, L - 1n) >= S) L -= 1n;
  return L;
}

const mk = (leg, units, o = {}) => ({ leg, ledger_leg: leg === 'our_fee' ? 'fee' : leg, units: units.toString(), side: o.side ?? null, venue: o.venue ?? null, part: o.part ?? null, bps: o.bps ?? null, to: o.to ?? null, to_address: o.to_address ?? null, to_ref: o.to_ref ?? null, taken: o.taken ?? null });
const feeLegs = (side, f) => f.parts.map((p) => mk('venue_fee', BigInt(p.units), { side, venue: f.venue, part: p.part, bps: p.bps, to: p.to, to_address: p.to_address, to_ref: p.to_ref ?? null, taken: f.taken }));
/** Σ of a leg list, in units. Pure. */
export const sumOf = (legs) => (legs ?? []).reduce((a, l) => a + BigInt(l.units), 0n);
const markupOf = (reseller, list) => { if (!reseller) return 0n; if (reseller.markup_units !== undefined && reseller.markup_units !== null) { const u = whole(reseller.markup_units); if (u === null) throw new Error('a reseller’s markup is a whole amount'); return u; } const b = Number(reseller.markup_bps ?? 0); if (!Number.isInteger(b) || b < 0 || b > 10_000) throw new Error('a reseller’s markup is 0 to 10000 bps of the list price'); return (list * BigInt(b)) / BPS; };

/**
 * THE QUOTE. What a buyer on `venue_in` pays for a seller on `venue_out` whose price is `seller_price` (whole units of the payment's
 * token), and the legs that payment leaves as. One formula for every pair:
 *
 *   list   = seller_price + our_fee                      our fee by the door's rule, on the list price: it does not depend on a venue
 *   out    = grossUp(venue_out, seller_price)            what must enter the selling venue so the doer receives its price
 *   net_in = list + venue_fee(out) + reseller_markup     what must reach coord
 *   price_to_buyer = grossUp(venue_in, net_in)           what the buyer pays, the buying venue's fee on top
 *
 * `o`: { venue_in, venue_out, class, seller_price, reseller?: { tenant, markup_bps | markup_units }, our_fee?: { rule: 'wall' } |
 * { rule: 'job_quote', units }, evaluator_set_in?, evaluator_set_out?, facts? }. Returns { ok, price_to_buyer, list_units, legs[] }
 * or { ok: false, why }. Pure.
 */
export function quoteSale(o = {}) {
  try {
    const S = whole(o.seller_price); if (S === null) return { ok: false, why: 'the seller’s price is a whole, non-negative amount in the payment’s smallest unit' };
    const fee = o.our_fee ?? { rule: 'wall' };
    const list = listPriceOf(fee, S); const ourFee = list - S;
    const out = grossUp(o.venue_out, S, { facts: o.facts, evaluator_set: o.evaluator_set_out });
    const markup = markupOf(o.reseller ?? null, list);
    const netIn = list + out.fee.total + markup;
    const inn = grossUp(o.venue_in, netIn, { facts: o.facts, evaluator_set: o.evaluator_set_in });
    const legs = [mk('our_fee', ourFee, { to: 'coord' }), ...feeLegs('in', inn.fee), ...feeLegs('out', out.fee), mk('seller_share', S, { venue: o.venue_out, to: 'the doer' }), mk('reseller_markup', markup, { to: o.reseller?.tenant ?? null })];
    const price = inn.gross;
    if (sumOf(legs) !== price) return { ok: false, why: `the legs sum to ${sumOf(legs)}, the price is ${price}: nothing is quoted` };
    return { ok: true, schema: 'taifoon.payment.quote.v1', rule: RULE, formula: FORMULA, venue_in: o.venue_in, venue_out: o.venue_out, class: o.class ?? null, seller_price: S.toString(), fee_rule: fee.rule,
      list_units: list.toString(), out_units: out.gross.toString(), net_in_units: netIn.toString(), price_to_buyer: price.toString(), legs,
      venue_fee: { in: { venue: o.venue_in, units: inn.fee.total.toString(), taken: inn.fee.taken }, out: { venue: o.venue_out, units: out.fee.total.toString(), taken: out.fee.taken } } };
  } catch (e) { return { ok: false, why: String(e?.message ?? e) }; }
}

/**
 * THE LEGS OF ONE PAYMENT. `p`:
 *   venue_in, venue_out   where the buyer paid, where the seller was hired (a venue of the standard, or coord · grid · reseller · devnet)
 *   paid_units            what the buyer put in: the wall's payment, the budget escrowed on the buying venue
 *   out_units             what coord owes on the selling side, the selling venue's fee included (the wall's share, the budget coord
 *                         funds, the doer's price a stand-in forwards); 0 when our own product served
 *   reseller              { tenant, markup_units } when a reseller's child bought
 *   lost_units            paid ahead to a seller whose answer then failed (ours to bear, inside the payment)
 *   ending                paid (default) · venue_refund (the buying venue's own refund: everything goes back, no fee was taken) ·
 *                         share_refund (a rejection before the share was sent: our fee stays, the share goes back)
 *   out_direct            true when coord pays the doer itself (a transfer from the vault, a stand-in's forward): the money never
 *                         enters the selling venue, so that venue takes nothing of it
 *   our_fee               { rule } to check the fee against the rule (fee_rule_ok: reported, never enforced here); the fee itself is what is left
 *   observed              { in | out: { provider, evaluator } } what the venue itself paid (the job's own events): it stands over the bps
 *   as_read_in/out        { platform_bps, evaluator_bps } as read for this one job;   evaluator_set_in/out
 * Returns { ok, legs[], sum_ok, fee_rule_ok, net_in_units, fees_as } or { ok: false, why }. Σ legs = paid_units, to the unit. Pure.
 */
export function legsOfPayment(p = {}) {
  try {
    const P = whole(p.paid_units); const G = whole(p.out_units ?? 0); const lost = whole(p.lost_units ?? 0);
    if (P === null || G === null || lost === null) return { ok: false, why: 'the payment, what is owed on the selling side and what was lost are whole amounts' };
    const ending = p.ending ?? 'paid';
    const policy = (v) => (OWN_VENUES.includes(v) ? null : factsOf(v, p.facts).on_refund);
    if (ending === 'venue_refund') {
      const legs = [mk('refund', P, { to: 'the buyer' })];
      return { ok: true, rule: RULE, ending, legs, sum_ok: sumOf(legs) === P, fee_rule_ok: null, net_in_units: '0', fees_as: 'no fee was taken', venue_fee_on_refund: (policy(p.venue_in) ?? policy(p.venue_out))?.venue_ending ?? 'none' };
    }
    if (!['paid', 'share_refund'].includes(ending)) return { ok: false, why: `${String(ending)} is not an ending of the scheme (paid · venue_refund · share_refund)` };
    let fees_as = 'the venue’s fees as declared';
    const side = (venue, base, obs, as_read, evaluator_set) => {
      const f = venueFeeOf(venue, base, { facts: p.facts, as_read, evaluator_set });
      if (as_read) fees_as = 'the venue’s fees as read on chain';
      const pv = whole(obs?.provider ?? null); const ev = whole(obs?.evaluator ?? 0) ?? 0n;
      // a venue that declares no fee part has nothing an observed amount could be booked as: the declared answer (nothing taken) stands
      if (pv === null || OWN_VENUES.includes(venue) || pv + ev > base || !factsOf(venue, p.facts).parts.some((x) => x.part === 'platform')) return f;
      // what the venue itself paid stands over the fees as they were read: the platform part is what neither the payee nor the evaluator received
      // (a venue with no evaluator part keeps everything the payee did not receive as its one part)
      const names = Object.fromEntries(factsOf(venue, p.facts).parts.map((x) => [x.part, x])); const evPart = names.evaluator ? ev : 0n;
      const parts = [{ part: 'platform', units: (base - pv - evPart).toString() }, { part: 'evaluator', units: evPart.toString() }].filter((x) => names[x.part]).map((x) => ({ ...x, bps: null, to: names[x.part].to, to_address: names[x.part].to_address, to_ref: names[x.part].to_ref }));
      fees_as = 'the amounts the venue paid (the job’s own events)';
      return { ...f, total: base - pv, net: pv, parts, taken: f.taken ?? factsOf(venue, p.facts).taken };
    };
    const fin = side(p.venue_in, P, p.observed?.in, p.as_read_in, p.evaluator_set_in);
    const netIn = fin.net;
    if (p.reseller && (p.reseller.markup_units === undefined || p.reseller.markup_units === null) && p.reseller.markup_bps) return { ok: false, why: 'the legs of a payment take a reseller’s markup in units (markup_units): a share of the list price is a quote’s input (quoteSale)' };
    const markup = markupOf(p.reseller ?? null, 0n);
    if (G + markup + lost > netIn) return { ok: false, why: `what is owed on the selling side (${G}), the markup (${markup}) and what was lost (${lost}) are above what reached coord (${netIn}): a sale is never made at a loss` };
    const ourFee = netIn - markup - G - lost;
    const fout = ending === 'share_refund' || p.out_direct === true ? venueFeeOf('coord', G) : side(p.venue_out, G, p.observed?.out, p.as_read_out, p.evaluator_set_out);
    const legs = [mk('our_fee', ourFee, { to: 'coord' }), ...feeLegs('in', fin), ...feeLegs('out', fout),
      ending === 'share_refund' ? mk('refund', G, { to: 'the buyer' }) : mk('seller_share', fout.net, { venue: p.venue_out, to: 'the doer' }),
      mk('reseller_markup', markup, { to: p.reseller?.tenant ?? null }), mk('loss', lost, { to: 'sellers whose paid answer failed' })];
    // the rule's answer, on the list price this payment stands for (our fee + what the doer receives)
    const fee_rule_ok = p.our_fee?.rule ? ourFee === ourFeeOf(p.our_fee, p.our_fee.rule === 'wall' ? ourFee + fout.net : fout.net) : null;
    return { ok: true, rule: RULE, ending, venue_in: p.venue_in, venue_out: p.venue_out, paid_units: P.toString(), net_in_units: netIn.toString(), out_units: G.toString(), legs, sum_ok: sumOf(legs) === P, fee_rule_ok, fees_as,
      venue_fee: { in: { venue: p.venue_in, units: fin.total.toString(), taken: fin.taken }, out: { venue: p.venue_out, units: fout.total.toString(), taken: fout.taken } } };
  } catch (e) { return { ok: false, why: String(e?.message ?? e) }; }
}

/** The pairs the adapters of the standard declare possible: a venue whose job.in is LIVE (a buyer can buy there) × a venue whose
 *  job.out is LIVE (a seller is hired there), plus our own product as the selling side. `adapters` = seller_coord_buyer.adapters. Pure. */
export function pairsOf(adapters) {
  const ins = (adapters ?? []).filter((a) => a.transforms?.['job.in']?.state === 'LIVE').map((a) => a.venue);
  const outs = [...(adapters ?? []).filter((a) => a.transforms?.['job.out']?.state === 'LIVE').map((a) => a.venue), 'coord'];
  return ins.flatMap((venue_in) => outs.map((venue_out) => ({ venue_in, venue_out })));
}

/** What the scheme lacks for a list of adapters: the venues with no entry, and the entries that are no adapter. An adapter of the
 *  standard without an entry fails the build of the standard and the conformance suite. Pure. */
export function schemeGaps(adapters, facts = VENUE_FEES) {
  const venues = (adapters ?? []).map((a) => a.venue); const entries = Object.keys(facts);
  // (an entry marked `adapter: false` is a venue the resolver walks that the standard has no adapter for yet: declared, and not a gap)
  return { missing: venues.filter((v) => !entries.includes(v)), extra: entries.filter((v) => !venues.includes(v) && facts[v].adapter !== false) };
}

/** The table of what each venue takes: one row per venue, derived from the facts (the master's and the stream's fee table). Pure. */
export function venueFeeTable(facts = VENUE_FEES, { addressOf = null } = {}) {
  return Object.entries(facts).map(([venue, f]) => ({ venue, status: f.status, ...(f.adapter === false ? { adapter: false } : {}), platform_bps: f.parts.find((p) => p.part === 'platform')?.bps ?? 0, evaluator_bps: f.parts.find((p) => p.part === 'evaluator')?.bps ?? 0,
    total_bps: f.parts.reduce((a, p) => a + p.bps, 0), taken: f.parts.some((p) => p.bps > 0) ? f.taken : null, rounding: f.rounding, to: f.parts.filter((p) => p.bps > 0).map((p) => `${p.part}: ${p.to}`).join('; ') || null,
    on_refund: f.on_refund.venue_ending, after_paid_ending: f.on_refund.after_paid_ending, contract: f.evidence.contract && addressOf ? addressOf(f.evidence.contract) : null, contract_ref: f.evidence.contract, chain: f.evidence.chain, block: f.evidence.block,
    // 10000 units through the venue, both ways: what a payee nets of 10000, and what must enter for the payee to net 10000
    net_of_10000: venueFeeOf(venue, 10_000n, { facts }).net.toString(), gross_for_10000: grossUp(venue, 10_000n, { facts }).gross.toString() }));
}

/** The ONE declared block (schemas/transitions.json seller_coord_buyer.payment_scheme): the legs, the formula, the fee rules, the
 *  per-venue facts with their evidence, the gross-up, what a refund does to a venue's fee, and the invariant. `addressOf(ref)` resolves
 *  a registry reference { system, chain, name } to its address (the generator passes the address registry's reader; without one the
 *  block carries the references alone). Deterministic. Pure. */
export function schemeBlock(facts = VENUE_FEES, { addressOf = null } = {}) {
  const at = (r) => (r && addressOf ? addressOf(r) : null);
  return {
    id: SCHEME_ID, rule_id: RULE,
    what: 'ONE payment scheme for every sale the layer makes as seller of record, whatever the venue the buyer buys on (venue_in) and the venue the seller is hired on (venue_out): the buyer pays coord once, under one derived sale key; what it paid leaves again as named legs in whole units, and the legs sum to the payment exactly. Each venue adapter maps its own rail INTO this scheme; no venue has a scheme of its own',
    formula: FORMULA,
    terms: { price_to_buyer: 'what the buyer pays on the buying venue', seller_price: 'what the doer receives on a paid ending: the class price, or the seller’s own price', our_fee: 'coord’s fee by the door’s rule; it does not depend on a venue', 'venue_fee(in)': 'what the buying venue takes of the buyer’s payment', 'venue_fee(out)': 'what the selling venue takes of what coord pays into it', reseller_markup: 'a reseller tenant’s leg, when its child bought' },
    legs: LEGS.map((l) => ({ ...l, ...(l.sides ? { sides: [...l.sides] } : {}) })),
    ending_legs: [...ENDING_LEGS],
    our_fee: { rules: Object.values(OUR_FEE.rules).map((r) => ({ ...r, ...(r.legs ? { legs: [...r.legs] } : {}) })), note: 'these are the rules that already ran, by the door the buyer bought through; the scheme adds none. Our fee never contains a venue’s fee' },
    venue_fee: {
      rule: 'the venue’s own basis points on its own base, each part rounded as its contract rounds; its own leg (`venue_fee`), its own ledger account (fee:venue:<venue>) and its own metric series (coord_sale_units_total{leg="venue_fee"}); never part of our fee or of a reseller’s markup',
      taken: { at_source: 'the venue takes it out of the money on its own side before the payee is paid (an escrow’s budget, a mech’s balance): the amount that enters the venue is grossed up for it', from_payment: 'coord pays it out of what it received (no venue of the standard does today)' },
      by_venue: Object.fromEntries(Object.entries(facts).map(([venue, f]) => [venue, { status: f.status, ...(f.adapter === false ? { adapter: false } : {}), total_bps: f.parts.reduce((a, p) => a + p.bps, 0), parts: f.parts.map((p) => ({ ...p, to_address: p.to_address ?? at(p.to_ref) })), base: f.base, rounding: f.rounding, taken: f.parts.some((p) => p.bps > 0) ? f.taken : null,
        on_refund: { ...f.on_refund }, evidence: { ...f.evidence, contract: at(f.evidence.contract), contract_ref: f.evidence.contract, reads: [...f.evidence.reads] } }])),
      table: venueFeeTable(facts, { addressOf }),
    },
    gross_up: { rule: 'where a venue takes its fee at the source, the amount that enters it is the smallest one whose net is the price wanted: on the selling side the doer still receives its price, on the buying side the list price still reaches coord, and our fee is the same as on a venue that takes nothing',
      steps: ['list = seller_price + our_fee', 'out = grossUp(venue_out, seller_price)', 'net_in = list + venue_fee(out) + reseller_markup', 'price_to_buyer = grossUp(venue_in, net_in)'] },
    refund: { rule: 'refunds follow the redirect’s refund policy per mode (seller_coord_buyer.redirect.refund_policy), unchanged; each venue states what happens to its fee', venue_ending: 'the venue’s own refund ending (a reject, an expiry): by_venue[].on_refund.venue_ending', after_paid_ending: 'a refund coord makes after a paid ending: by_venue[].on_refund.after_paid_ending' },
    invariant: 'Σ legs = the payment, to the smallest unit, for every pair of venues and every ending; our_fee is the rule’s answer; venue_fee is the venue’s declared basis points on the declared base; on a paid ending the seller receives exactly seller_price',
    modes: 'the scheme does not depend on the redirect mode (forward · share · period · markup) or on a release condition: those say WHEN and HOW a leg is sent, the scheme says WHICH legs a payment has',
    code: { repo: 'layer', path: 'automatch/payment-scheme.mjs', what: 'quoteSale({ venue_in, venue_out, class, seller_price, reseller? }) → { price_to_buyer, legs[] } · legsOfPayment(payment) → legs[] · venueFeeOf · grossUp · ourFeeOf', vendored: 'site src/lib/payment-scheme.mjs (byte-identical, sha256 pinned)' },
    tests: { unit: 'automatch/payment-scheme.test.mjs', conformance: 'harvesters/conformance/payment-scheme.test.mjs (every adapter of the standard; an adapter without an entry fails it)', fork: 'automatch/escrow-job.fork.mjs (ERC-8183, the memo router, BitAgent) · automatch/olas-out.fork.mjs (the Olas marketplace): the amounts the contracts move equal the scheme’s legs' },
  };
}
