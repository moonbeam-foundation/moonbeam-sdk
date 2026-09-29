// Read a real job: decode real agent jobs from their Base logs (Virtuals ACP, captured from mainnet) and fold each into one
// state: what happened, how it settles, and who judged it. Offline: the logs are in examples/data/.
//   node examples/30-read-a-real-job.mjs
import { readFileSync } from 'node:fs';
import { decodeAcpLogs, foldTask, toOutcome, localClock } from '@moonbeam-foundation/sdk';

const JUDGED_BY = { self: 'the buyer itself (no independent evaluator)', independent: 'an independent evaluator' };
const clock = localClock(Math.floor(Date.UTC(2026, 8, 1) / 1000)); // long after both jobs ended

for (const file of ['virtuals-job-74926.json', 'virtuals-job-rejected.json']) {
  const logs = JSON.parse(readFileSync(new URL(`./data/${file}`, import.meta.url), 'utf8'));
  const events = decodeAcpLogs(logs);
  const state = foldTask(events);
  const outcome = toOutcome(state, clock);
  console.log(`\n${file}`);
  console.log('  events:    ', events.map((e) => e.kind).join(' → '));
  console.log('  settles as:', outcome.verdict ?? `pending (${outcome.pending})`, outcome.basis ? `(${outcome.basis})` : '');
  console.log('  judged by: ', JUDGED_BY[state.verification] ?? state.verification);
}
