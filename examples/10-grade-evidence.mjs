// Grader stage 1: the evidence. What Jev reads about a job: the task as the buyer wrote it, what "done" means,
// what came back, and the job's trail. Build it from the job, never from a summary someone wrote about it.
//   node examples/10-grade-evidence.mjs
import { readFileSync } from 'node:fs';
const hire = JSON.parse(readFileSync(new URL('./data/pilot-hire.json', import.meta.url), 'utf8'));
export const evidence = {
  task: 'Deliver the agreed report and submit its digest to the hook',
  acceptance_criteria: ['1. A deliverable is submitted before the deadline', '2. The submitted digest matches the delivered file'].join('\n'),
  delivered: `digest submitted in ${hire.txs.delivered.hash} (block ${hire.txs.delivered.block})`,
  trail: Object.entries(hire.txs).map(([k, t]) => `${k}: ${t.hash} · block ${t.block}`).join('\n'),
};
console.log(JSON.stringify(evidence, null, 2));
