// Grader stage 2: the facts. Code checks what code can check. A failed check is final: the job is rejected
// and Jev is never asked, so no key and no network are needed for this path.
//   node examples/11-grade-facts.mjs
import { gradeJob, jobFacts } from '@moonbeam-foundation/sdk/judge';
import { PILOT_JOB } from './data/answers.mjs';

const facts = await jobFacts({ delivered: true, checks: { digest_matches_file: false, before_deadline: true } });
console.log('facts:', facts);
const receipt = await gradeJob({ jobId: PILOT_JOB, evidence: 'the report', facts });
console.log(receipt.verdict, '·', receipt.reasons[0]);   // reject, decided by the failed check
