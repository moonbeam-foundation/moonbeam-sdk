// Read live: one job's events straight from Base, decode and fold them. Read only; no key.
// The reads go through the SDK's Base reader: warmbed's measured rotation of Base endpoints, so a rate-limited or
// range-capped endpoint moves the call to the next one.
//   node examples/32-read-live-from-base.mjs          Virtuals ACP job 74926 (the one captured in data/)
//   JOB=12345 FROM_BLOCK=50000000 node examples/32-read-live-from-base.mjs
//   BASE_RPC=https://your-rpc node examples/32-read-live-from-base.mjs     (your endpoint goes first)
import { decodeAcpLogs, foldTask, toOutcome, localClock, VIRTUALS_ACP_ADDRESS, ACP_TOPIC0 } from '@moonbeam-foundation/sdk';
import { baseReader } from '@moonbeam-foundation/sdk/rpc';

const reader = baseReader();
const job = BigInt(process.env.JOB ?? 74926);
const from = Number(process.env.FROM_BLOCK ?? 50_427_200);
const SPAN = 500, WINDOWS = Number(process.env.WINDOWS ?? 4); // public RPCs cap the block range per call
const rpc = (method, params, need = 'call') => reader.call(method, params, need);

const virtuals = ['jobCreated', 'budgetSet', 'jobFunded', 'paymentReleased', 'jobRefunded', 'jobSubmitted', 'jobCompleted', 'jobRejected', 'jobExpired', 'evaluatorFeePaid'].map((k) => ACP_TOPIC0[k]);
const jobTopic = '0x' + job.toString(16).padStart(64, '0');
const logs = [];
for (let i = 0; i < WINDOWS; i++) {
  const lo = from + i * SPAN, hi = lo + SPAN - 1;
  logs.push(...(await rpc('eth_getLogs', [{ address: VIRTUALS_ACP_ADDRESS, topics: [virtuals, jobTopic], fromBlock: '0x' + lo.toString(16), toBlock: '0x' + hi.toString(16) }], 'logs')));
}
const events = decodeAcpLogs(logs);
console.log(`job ${job}, blocks ${from}–${from + WINDOWS * SPAN - 1}: ${events.length} events`);
if (!events.length) { console.log('nothing in this window: set FROM_BLOCK near the job\'s creation, or WINDOWS to read further'); process.exit(0); }
console.log(events.map((e) => e.kind).join(' → '));
const state = foldTask(events);
const now = Number((await rpc('eth_getBlockByNumber', ['latest', false])).timestamp);
const outcome = toOutcome(state, localClock(now));
console.log('settles as:', outcome.verdict ?? `pending (${outcome.pending})`, '· judged by:', state.verification);
