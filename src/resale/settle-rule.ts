/**
 * Where a seller's leg settles: the layer's rule SETTLE_ON_SELLER_VENUE_v1, and its resolver, held to the rule's own vectors
 * (test/fixtures/settle-rule.vectors.json).
 *
 * The buyer's payment is confirmed wherever it was made. A seller's leg is paid on the network, token and payTo of the offer
 * it delivered on, in this order: (1) its x402 `accepts` entry for the class it delivered; (2) its venue's rail, the one chain
 * of the venue it was hired on, to the payTo it registered; (3) a seller with no paid rail of its own (a free tool or agent
 * admitted as a paid seller): Base USDC to the payTo it registered. A network the seller did not publish is never chosen for
 * it: a rail the layer holds no pay token on is Held (network_not_served), another asset is Held (token_not_served), and no
 * payTo is Held (no_payee). Nothing is bridged or swapped. Pure.
 */
export const SETTLE_RULE = 'SETTLE_ON_SELLER_VENUE_v1' as const;
export type SettleToken = { readonly symbol: string; readonly address: string; readonly decimals: number };

const BASE = 'eip155:8453';
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

/** The dollar token the layer pays a seller's leg in, per network (CAIP-2). A network missing here is not served. */
export const PAY_TOKENS: Readonly<Record<string, SettleToken>> = Object.freeze({
  'eip155:8453': Object.freeze({ symbol: 'USDC', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 }),
  'eip155:42161': Object.freeze({ symbol: 'USDC', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', decimals: 6 }),
  'eip155:5042': Object.freeze({ symbol: 'USDC', address: '0x3600000000000000000000000000000000000000', decimals: 6 }),
  'eip155:4663': Object.freeze({ symbol: 'USDG', address: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', decimals: 6 }),
  'eip155:143': Object.freeze({ symbol: 'USDC', address: '0x754704bc059f8c67012fed69bc8a327a5aafb603', decimals: 6 }),
  [SOLANA]: Object.freeze({ symbol: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 }),
});
/** x402 v1 network names, read as CAIP-2 */
export const SETTLE_NETWORK_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  base: BASE, 'base-sepolia': 'eip155:84532', arbitrum: 'eip155:42161', polygon: 'eip155:137', avalanche: 'eip155:43114',
  monad: 'eip155:143', robinhood: 'eip155:4663', arc: 'eip155:5042', solana: SOLANA,
});
/** The one chain of each venue a seller can be hired on (its rail). */
export const VENUE_RAILS: Readonly<Record<string, string>> = Object.freeze({
  'x402-base': BASE, 'x402-solana': SOLANA, 'x402-arbitrum': 'eip155:42161', 'x402-robinhood': 'eip155:4663', 'x402-monad': 'eip155:143',
  'erc8183-base': BASE, 'memoacp-base': BASE, 'acpv3-arc': 'eip155:5042', 'acpv3-robinhood': 'eip155:4663', 'bitagent-base': BASE,
  'olas-gnosis': 'eip155:100', 'olas-base': BASE, 'olas-polygon': 'eip155:137', 'moonbeam-acp': BASE, 'pons-robinhood': 'eip155:4663',
  nosana: SOLANA,
});
/** A seller with no paid rail of its own settles here. */
export const FREE_ENROLLED = Object.freeze({ network: BASE, token: PAY_TOKENS[BASE]! });

/** What a seller published or registered: its x402 accepts entry for the class it delivered, its venue, its registered payTo. */
export type SellerOffer = { accepts?: { network: string; asset: string; payTo: string } | null; venue?: string | null; registered_pay_to?: string | null };
export type SellerRail = {
  source: 'x402_accepts' | 'venue_rail' | 'free_enrolled';
  network: string; token: SettleToken | null; pay_to: string | null;
  state: 'owed' | 'held'; held_by: 'no_payee' | 'network_not_served' | 'token_not_served' | null;
};

/** The rail a seller's leg settles on (SETTLE_ON_SELLER_VENUE_v1). Pure. */
export function sellerRailOf(o: SellerOffer): SellerRail {
  const acc = o.accepts && o.accepts.network && o.accepts.asset && o.accepts.payTo ? o.accepts : null;
  const reg = typeof o.registered_pay_to === 'string' && o.registered_pay_to ? o.registered_pay_to : null;
  const rail = !acc && o.venue ? VENUE_RAILS[o.venue] ?? null : null;
  const source: SellerRail['source'] = acc ? 'x402_accepts' : rail ? 'venue_rail' : 'free_enrolled';
  const network = acc ? (SETTLE_NETWORK_ALIASES[acc.network] ?? acc.network) : rail ?? FREE_ENROLLED.network;
  const evm = network.startsWith('eip155:');
  const raw = acc ? acc.payTo : reg;
  const pay_to = raw === null ? null : evm ? raw.toLowerCase() : raw;
  const tok = PAY_TOKENS[network] ?? null;
  const assetOk = acc && tok ? (evm ? acc.asset.toLowerCase() === tok.address : acc.asset === tok.address) : true;
  const held_by: SellerRail['held_by'] = !tok ? 'network_not_served' : !assetOk ? 'token_not_served' : pay_to === null ? 'no_payee' : null;
  return { source, network, token: assetOk ? tok : null, pay_to, state: held_by ? 'held' : 'owed', held_by };
}
