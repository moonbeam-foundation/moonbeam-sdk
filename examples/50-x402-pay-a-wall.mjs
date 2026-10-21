// x402: read a wall's 402 quote, pick the entry of the network you pay from, and build the payment your wallet signs
// (EIP-3009 transferWithAuthorization) and the PAYMENT-SIGNATURE header that carries it. Nothing is signed or paid here.
//   node examples/50-x402-pay-a-wall.mjs                                 the recorded quote (six networks, Solana included)
//   MOONBEAM_API=<your coordination endpoint>/v1 node examples/50-x402-pay-a-wall.mjs   the same, quoted live
//   NETWORK=eip155:42161 node examples/50-x402-pay-a-wall.mjs           pay from another network the wall offers
//   test/fork/run-fork.mjs signs it and executes it on a Base fork
import { readFileSync } from 'node:fs';
import { quoteWall, pickAccept, chainIdOf, transferAuthorization, paymentHeaders, subscribePlan } from '@moonbeam-foundation/sdk/x402';
import { quoteSale, sellerRailOf } from '@moonbeam-foundation/sdk/resale';

const network = process.env.NETWORK ?? 'eip155:8453';
const recorded = JSON.parse(readFileSync(new URL('./data/x402-wall-402.json', import.meta.url), 'utf8'));
const api = process.env.OFFLINE ? null : process.env.MOONBEAM_API ?? null;
const live = api ? await quoteWall({ base: api, fetch: (u, i) => fetch(u, i) }, '/x402/class/mcp.digest', { network }) : null;
const accept = live ? live.accept : pickAccept(recorded, { network });
console.log(`the wall offers ${(live ? live.body : recorded.x402).accepts.map((a) => a.network).join(', ')}; on ${accept.network} it asks ${accept.amount} units of ${accept.asset}, paid to ${accept.payTo}`);
const q = quoteSale({ venue_in: 'x402-base', venue_out: 'x402-base', seller_price: 9207n });
console.log(`quoteSale: the seller's 9207 → the buyer pays ${q.price_to_buyer} (the same scheme the wall prices with)`);
const rail = sellerRailOf({ accepts: { network: 'solana', asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', payTo: 'GQcEn5pLcweo7qaiy3rDdsiUPiygygmFBaixNtNqhQVD' } });
console.log(`a seller who published a Solana offer is paid there: ${rail.network} ${rail.token?.symbol} to ${rail.pay_to} (${rail.state})`);
if (chainIdOf(accept.network) === null) {
  console.log(`${accept.network} is not an EIP-3009 network: your Solana wallet sends ${accept.amount} units of ${accept.asset} to ${accept.payTo} (fee payer ${accept.extra?.feePayer ?? 'yours'})`);
  process.exit(0);
}
const typed = transferAuthorization(accept, { from: '0x000000000000000000000000000000000000dEaD' });
console.log(`your wallet signs ${typed.primaryType} under ${typed.domain.name} v${typed.domain.version} on chain ${typed.domain.chainId}: value ${typed.message.value}, valid before ${typed.message.validBefore}`);
const headers = paymentHeaders(accept, typed.message, `0x${'11'.repeat(65)}`);
console.log(`then the request carries ${Object.keys(headers).join(' + ')} (x402 v2: the accepted entry and the signed authorization); a top-up starts at`, JSON.stringify(subscribePlan({ usdc: 1 }).body));
