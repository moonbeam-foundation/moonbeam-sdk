// x402 on Base: read a wall's 402 quote, pick its Base entry, and build the USDC payment your wallet signs (EIP-3009
// transferWithAuthorization) and the X-PAYMENT header that carries it. Nothing is signed or paid here.
//   node examples/50-x402-pay-a-wall.mjs          a paid answer of the class mcp.digest, quoted live
//   OFFLINE=1 node examples/50-x402-pay-a-wall.mjs  the same, from the recorded quote
//   test/fork/run-fork.mjs signs it and executes it on a Base fork
import { quoteWall, baseAccept, transferAuthorization, subscribePlan } from '@moonbeam-foundation/sdk/x402';
import { quoteSale } from '@moonbeam-foundation/sdk/resale';

const t = { base: 'https://coord.taifoon.dev/v1', fetch: (u, i) => fetch(u, i) };
const recorded = { x402: { x402Version: 2, accepts: [{ scheme: 'exact', network: 'eip155:8453', amount: '11509', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', payTo: '0x3574999dd4c96eB73Bd6e11D4177010C83E14f5b', maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } }] } };
const accept = process.env.OFFLINE ? baseAccept(recorded) : (await quoteWall(t, '/x402/class/mcp.digest')).accept;
console.log(`the wall asks ${accept.amount} USDC units on ${accept.network}, paid to ${accept.payTo}`);
const q = quoteSale({ venue_in: 'x402-base', venue_out: 'x402-base', seller_price: 9207n });
console.log(`quoteSale: the seller's 9207 → the buyer pays ${q.price_to_buyer} (the same scheme the wall prices with)`);
const typed = transferAuthorization(accept, { from: '0x000000000000000000000000000000000000dEaD' });
console.log(`your wallet signs ${typed.primaryType} under ${typed.domain.name} v${typed.domain.version} on chain ${typed.domain.chainId}: value ${typed.message.value}, valid before ${typed.message.validBefore}`);
console.log('then paymentHeader(accept, typed.message, signature) is the X-PAYMENT header; a top-up starts at', JSON.stringify(subscribePlan({ usdc: 1 }).body));
