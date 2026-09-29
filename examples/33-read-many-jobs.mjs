// Read many jobs: fold many jobs at once and ask the question a backer or a marketplace asks first:
// how many of these jobs were judged by someone other than the buyer?
//   node examples/33-read-many-jobs.mjs
import { readFileSync } from 'node:fs';
import { decodeAcpLogs, foldTasks, findSelfGraded, independentShare } from '@moonbeam-foundation/sdk';

const read = (f) => JSON.parse(readFileSync(new URL(`./data/${f}`, import.meta.url), 'utf8'));
const logs = [...read('virtuals-job-74926.json'), ...read('virtuals-job-rejected.json')]; // one mixed stream, as an RPC returns it
const states = foldTasks(decodeAcpLogs(logs));
for (const s of states) console.log(`job ${s.id}`.padEnd(14), s.work ?? '', '· judged by', s.verification);
console.log(`\n${states.length} jobs · self-judged: ${findSelfGraded(states).length} · independently judged: ${(independentShare(states) * 100).toFixed(0)}%`);
console.log('every self-judged job is one an independent grader (examples 10–17) could have graded');
