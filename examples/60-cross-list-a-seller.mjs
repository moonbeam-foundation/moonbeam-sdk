// Cross-list a seller: take an agent that sells on one market, and price the same job on every other market Moonbeam reaches.
// Every number comes from the one payment scheme: price to buyer = seller price + our fee + each market's own fee [+ your markup].
//   node examples/60-cross-list-a-seller.mjs                       two real sellers, as recorded on 2026-11-06 (offline)
//   MOONBEAM_API=… MOONBEAM_API_KEY=… node examples/60-cross-list-a-seller.mjs    the top sellers by 30-day pay, read live
//   MARKUP_BPS=200 node examples/60-cross-list-a-seller.mjs        the same, resold on your own child keys at +2 %
import { readFileSync } from 'node:fs';
import { quoteSale, legsByName } from '@moonbeam-foundation/sdk/resale';
import { transportFromEnv, sellerRecords } from '@moonbeam-foundation/sdk/market';

const recorded = JSON.parse(readFileSync(new URL('./data/cross-list.recorded.json', import.meta.url), 'utf8'));
const MARKETS = ['x402-base', 'mcp', 'a2a', 'erc8183-base', 'bitagent-base', 'memoacp-base', 'olas-base'];
const markup = Number(process.env.MARKUP_BPS ?? 0);
const usdc = (u) => (Number(u) / 1e6).toFixed(2);
const units = (s) => BigInt(Math.round(Number(s) * 1e6));

let sellers = recorded.sellers; let source = `recorded ${recorded.read_at}: ${recorded.sellers_on_record} sellers with a record, ${recorded.sellers_on_more_than_one_market} on more than one market`;
if (!process.env.OFFLINE && process.env.MOONBEAM_API && process.env.MOONBEAM_API_KEY) {
  const r = await sellerRecords(transportFromEnv(), { chainId: 8453, limit: 100 });
  const venue = { 'acp-base': 'erc8183-base', bitagent: 'bitagent-base', 'memo-acp': 'memoacp-base' };
  sellers = r.sellers.filter((s) => s.history.typical_price_usdc).sort((a, b) => (b.history.d30?.paid_usdc ?? 0) - (a.history.d30?.paid_usdc ?? 0)).slice(0, 2).map((s) => ({
    seller: s.sellerId, market: venue[Object.entries(s.job_sources).find(([, n]) => n > 0)?.[0]] ?? 'erc8183-base', job: String(s.history.top_tasks?.[0]?.task ?? 'its job').split(' where ')[0],
    price_usdc: String(s.history.typical_price_usdc), jobs: s.jobs, paid_usdc: s.history.paid_usdc, buyers: s.buyers?.distinct ?? null, paid_30d_usdc: s.history.d30?.paid_usdc ?? 0 }));
  source = `read live: ${r.total} sellers with a record`;
}
console.log(source);
for (const s of sellers) {
  console.log(`\n${s.job}: ${s.seller} sells on ${s.market} at ${s.price_usdc} USDC · ${s.jobs} jobs · ${s.paid_usdc} USDC paid · ${s.buyers} buyers · ${s.paid_30d_usdc} USDC in 30 days`);
  console.log('  sold on          buyer pays   seller   our fee   market fees   your markup');
  for (const m of MARKETS.filter((x) => x !== s.market)) {
    const q = quoteSale({ venue_in: m, venue_out: s.market, seller_price: units(s.price_usdc), ...(markup ? { reseller: { tenant: 'you', markup_bps: markup } } : {}) });
    if (!q.ok) { console.log(`  ${m.padEnd(16)} not sold there: ${q.why ?? q.error}`); continue; }
    const l = legsByName(q);
    console.log(`  ${m.padEnd(16)} ${usdc(q.price_to_buyer).padStart(10)}   ${usdc(l.seller_share).padStart(6)}   ${usdc(l.our_fee).padStart(7)}   ${usdc(l.venue_fee).padStart(11)}   ${usdc(l.reseller_markup).padStart(11)}`);
  }
}
console.log('\nthe seller keeps its own price on every market; the legs sum to what the buyer pays');
