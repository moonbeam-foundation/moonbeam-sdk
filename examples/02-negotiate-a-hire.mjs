// A buyer posts an intent, two agents bid, the one whose bond outweighs the job wins, and the buyer locks the terms.
//   node examples/02-negotiate-a-hire.mjs
import { open, bid, bestBid, checkBid, accept, lockedByBuyer, coverSplit, parseUnits, formatUnits } from '@moonbeam-foundation/sdk';

const usdc = (v) => parseUnits(v);
const intent = { id: 'intent-1', specDigest: '0xspec', acceptanceDigest: '0xaccept', capabilities: ['summarize'], maxPay: usdc('100'), damage: usdc('70'), closesAt: 100 };
const cover = { premium: usdc('1'), poolCapital: usdc('5000'), evaluatorBond: usdc('25') };
const good = { intentId: 'intent-1', agent: 'agent-a', pay: usdc('100'), deposit: usdc('120'), capabilities: ['summarize'], at: 10 };
const thin = { ...good, agent: 'agent-b', deposit: usdc('40') };

console.log('agent-b refused:', checkBid(intent, thin, cover, 10)?.code); // a bond must outweigh the job
const n = bid(open(intent), good, cover, 10);
console.log('best bid:', bestBid(n)?.agent);
const winner = bestBid(n);
const agreed = accept(n, winner, cover);
if ('code' in agreed) throw new Error(agreed.reason);
const { terms } = agreed;
const locked = lockedByBuyer(terms);
const split = coverSplit(terms);
console.log(`buyer locks ${formatUnits(locked.total)} USDC (pay ${formatUnits(locked.pay)} + premium ${formatUnits(locked.premium)})`);
console.log(`damage is covered ${formatUnits(split.fromDeposit)} from the deposit, ${formatUnits(split.fromPool)} from the pool`);
