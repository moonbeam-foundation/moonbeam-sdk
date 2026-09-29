// Settle one covered job four ways. Positive is received, negative is paid, and every ledger sums to zero.
//   node examples/01-settle-a-covered-job.mjs
import { settle, parseUnits, formatUnits, conservesValue } from '@moonbeam-foundation/sdk';

const usdc = (v) => parseUnits(v); // 6 decimals
const terms = {
  pay: usdc('100'),          // what the client pays for the work
  premium: usdc('1'),        // what it pays for cover
  deposit: usdc('120'),      // the provider's bond, sized above the job
  evaluatorBond: usdc('25'), // the judge's bond
  poolCapital: usdc('5000'), // backers standing behind the provider
  damage: usdc('70'),        // consequential loss if the work is bad
};
const fmt = (m) => `${m < 0n ? '-' : '+'}${formatUnits(m < 0n ? -m : m)}`.padStart(9);
for (const verdict of ['doneRight', 'notDelivered', 'rejected', 'cheated']) {
  const { ledger } = settle({ terms, verdict });
  console.log(`${verdict.padEnd(12)} client ${fmt(ledger.client)}  provider ${fmt(ledger.provider)}  pool ${fmt(ledger.pool)}  sums to zero: ${conservesValue(ledger)}`);
}
