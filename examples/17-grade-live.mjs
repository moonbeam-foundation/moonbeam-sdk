// Grade a job with Jev for real, on your own TypeSafe key (console.typesafe.ai). Without a key it explains and stops.
//   TYPESAFE_KEY=… node examples/17-grade-live.mjs
import { gradeJob, jobFacts, endJob } from '@moonbeam-foundation/sdk/judge';
import { PILOT_JOB } from './data/answers.mjs';

if (!process.env.TYPESAFE_KEY) { console.log('set TYPESAFE_KEY to your own key from console.typesafe.ai; it is sent to TypeSafe only'); process.exit(0); }
const receipt = await gradeJob({
  jobId: PILOT_JOB,
  evidence: { task: 'Summarise the attached note in one sentence', delivered: 'The note asks the team to ship on Friday.' },
  facts: await jobFacts({ delivered: true }),
  key: process.env.TYPESAFE_KEY,
});
console.log(receipt.verdict, '·', receipt.reasons[0], '·', receipt.model);
console.log('ends the job with:', endJob(PILOT_JOB, receipt)?.fn ?? 'nothing (needs review)');
