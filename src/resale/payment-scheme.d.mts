// Types of src/resale/payment-scheme.mjs (the byte-identical copy of the coordination layer’s packages/resale/core/payment-scheme.mjs, _ONE_PAYMENT_SCHEME_v1_):
// ONE payment scheme for every sale the layer makes as seller of record, whatever the venue pair.
//   price_to_buyer = seller_price + our_fee + venue_fee(in) + venue_fee(out) [+ reseller_markup]
export const RULE: 'ONE_PAYMENT_SCHEME_v1';
export const SCHEME_ID: 'taifoon.payment.scheme.v1';
export const FORMULA: string;
export const BPS: bigint;
export const OWN_VENUES: readonly string[];
export type Units = bigint | number | string;
export type SchemeLegId = 'our_fee' | 'venue_fee' | 'seller_share' | 'reseller_markup' | 'provider' | 'graders' | 'ecosystem';
export const LEGS: readonly { id: SchemeLegId; ledger_leg: string; account: string; to: string; what: string; sides?: readonly ('in' | 'out')[] }[];
export const ENDING_LEGS: readonly string[];
export type FeeRule = { rule: 'wall' } | { rule: 'job_quote'; units: Units } | { rule: 'metered' } | { rule: 'none' };
export const OUR_FEE: { rules: { wall: { id: 'wall'; door: string; bps: number; min_units: number; rounding: 'ceil'; base: string; never_above: string; code: string }; job_quote: { id: 'job_quote'; door: string; base: string; on_top: true; code: string }; metered: { id: 'metered'; door: string; base: string; legs: readonly string[]; code: string } } };
/** an entry of the address registry (src/lib/addresses.generated.ts contract(system, chain, name)): a venue's contract is named by reference, never by a literal */
export type RegistryRef = { system: string; chain: number; name: string };
export type VenueFeePart = { part: 'platform' | 'evaluator'; bps: number; to: string; to_address: string | null; to_ref: RegistryRef | null; when: 'always' | 'evaluator_set' };
export type VenueFeeFacts = {
  status: 'read' | 'none'; /** false: a venue the resolver walks that the standard has no adapter for yet */ adapter?: false; taken: 'at_source' | 'from_payment' | null; rounding: 'floor' | 'ceil'; base: string; parts: readonly VenueFeePart[];
  on_refund: { venue_ending: string; venue_ending_why: string; after_paid_ending: string; after_paid_ending_why: string };
  evidence: { contract: RegistryRef | null; chain: number | string | null; name: string; reads: readonly string[]; block: number | null; read_at: string; how: string };
};
export const VENUE_FEES: Readonly<Record<string, VenueFeeFacts>>;
export type VenueFee = { venue: string; base: bigint; total: bigint; net: bigint; parts: { part: string; bps: number | null; units: string; to: string; to_address: string | null; to_ref?: RegistryRef | null }[]; taken: 'at_source' | 'from_payment' | null; rounding: 'floor' | 'ceil' };
export type FeeOpts = { facts?: Record<string, VenueFeeFacts>; evaluator_set?: boolean; as_read?: { platform_bps?: number | null; evaluator_bps?: number | null } | null };
export function venueFeeOf(venue: string, base: Units, o?: FeeOpts): VenueFee;
export function grossUp(venue: string, net: Units, o?: FeeOpts): { venue: string; net: bigint; gross: bigint; fee: VenueFee };
export function ourFeeOf(fee: FeeRule, base: Units): bigint;
export function listPriceOf(fee: FeeRule, sellerPrice: Units): bigint;
export type SchemeLeg = { leg: SchemeLegId | 'refund' | 'loss'; ledger_leg: string; units: string; side: 'in' | 'out' | null; venue: string | null; part: string | null; bps: number | null; to: string | null; to_address: string | null; to_ref: RegistryRef | null; taken: string | null };
export function sumOf(legs: readonly { units: string }[]): bigint;
export type Reseller = { tenant: string; markup_bps?: number; markup_units?: Units };
export type Quote = { ok: true; schema: 'taifoon.payment.quote.v1'; rule: string; formula: string; venue_in: string; venue_out: string; class: string | null; seller_price: string; fee_rule: string;
  list_units: string; out_units: string; net_in_units: string; price_to_buyer: string; legs: SchemeLeg[]; venue_fee: { in: { venue: string; units: string; taken: string | null }; out: { venue: string; units: string; taken: string | null } } } | { ok: false; why: string };
export function quoteSale(o: { venue_in: string; venue_out: string; class?: string | null; seller_price: Units; reseller?: Reseller | null; our_fee?: FeeRule; evaluator_set_in?: boolean; evaluator_set_out?: boolean; facts?: Record<string, VenueFeeFacts> }): Quote;
export type Observed = { provider: Units; evaluator?: Units };
export type PaymentLegs = { ok: true; rule: string; ending: string; venue_in?: string; venue_out?: string; paid_units?: string; net_in_units: string; out_units?: string; legs: SchemeLeg[]; sum_ok: boolean; fee_rule_ok: boolean | null; fees_as: string;
  venue_fee?: { in: { venue: string; units: string; taken: string | null }; out: { venue: string; units: string; taken: string | null } }; venue_fee_on_refund?: string } | { ok: false; why: string };
export function legsOfPayment(p: { venue_in: string; venue_out: string; paid_units: Units; out_units?: Units; reseller?: Reseller | null; lost_units?: Units; out_direct?: boolean; ending?: 'paid' | 'venue_refund' | 'share_refund'; our_fee?: FeeRule;
  observed?: { in?: Observed | null; out?: Observed | null } | null; as_read_in?: FeeOpts['as_read']; as_read_out?: FeeOpts['as_read']; evaluator_set_in?: boolean; evaluator_set_out?: boolean; facts?: Record<string, VenueFeeFacts> }): PaymentLegs;
export function pairsOf(adapters: readonly { venue: string; transforms?: Record<string, { state?: string }> }[]): { venue_in: string; venue_out: string }[];
export function schemeGaps(adapters: readonly { venue: string }[], facts?: Record<string, VenueFeeFacts>): { missing: string[]; extra: string[] };
export type VenueFeeRow = { venue: string; status: string; adapter?: false; platform_bps: number; evaluator_bps: number; total_bps: number; taken: string | null; rounding: string; to: string | null; on_refund: string; after_paid_ending: string; contract: string | null; contract_ref: RegistryRef | null; chain: number | string | null; block: number | null; net_of_10000: string; gross_for_10000: string };
export type Resolve = { addressOf?: ((r: RegistryRef) => string) | null };
export function venueFeeTable(facts?: Record<string, VenueFeeFacts>, o?: Resolve): VenueFeeRow[];
export function schemeBlock(facts?: Record<string, VenueFeeFacts>, o?: Resolve): Record<string, unknown>;
