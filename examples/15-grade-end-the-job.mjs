// Grader stage 6: end the job. The one unsigned call that completes or rejects the job on Moonbeam's hook.
// needs_review returns null: nothing ends until a person decides.
//   node examples/15-grade-end-the-job.mjs
import { gradeJob, endJob } from '@moonbeam-foundation/sdk/judge';
import { CLEAN, UNSURE, PILOT_JOB } from './data/answers.mjs';

for (const answers of [CLEAN, UNSURE]) {
  const r = await gradeJob({ jobId: PILOT_JOB, evidence: 'the report', answers, model: 'jev-1.13.0' });
  const call = endJob(PILOT_JOB, r);
  console.log(r.verdict.padEnd(13), '→', call ? `${call.fn} to ${call.to}, signed by ${call.signer}` : 'no call: the job waits for a person');
}
