// Reselling on Base: what a Moonbeam reseller's visitor pays for a job, where every unit of it goes, and the reseller's own leg.
// The numbers are the coordination layer's ONE payment scheme (a pinned copy); the venues are the five Base venues. Offline; no key.
//   node examples/24-resell-on-base.mjs
import { quoteBase, legsByName, markupLeg, childKeyTerms, BASE_VENUES } from '@moonbeam-foundation/sdk/resale';

const sellerPrice = 8_000n; // the doer's own price: 0.008 USDC
const rows = [];
for (const venue_out of BASE_VENUES) {
  const q = quoteBase({ venue_in: 'reseller', venue_out, seller_price: sellerPrice, reseller: { tenant: 'acct_moonbeam', markup_bps: 1000 } });
  if (!q.ok) { console.log(`${venue_out}: refused: ${q.why}`); continue; }
  const l = legsByName(q);
  rows.push({ venue_out, buyer_pays: q.price_to_buyer, our_fee: l.our_fee.toString(), venue_fee: l.venue_fee.toString(), seller: l.seller_share.toString(), markup: markupLeg(q).units.toString() });
}
console.table(rows);
const first = rows[0];
console.log(`the doer keeps ${first.seller} on every venue; the reseller's leg is ${first.markup} (10 % of the list price); Σ legs = the price on every row`);
console.log(childKeyTerms({ '*': 1000 }).says[1]);
