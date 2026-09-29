// Grader stage 4: the verdict. Code composes complete, reject or needs_review from the answers under published
// thresholds. Mid-band answers are needs_review: nothing ends, the job goes to appeal.
//   node examples/13-grade-verdict.mjs
import { gradeJob } from '@moonbeam-foundation/sdk/judge';
import { CLEAN, REJECT, UNSURE, PILOT_JOB } from './data/answers.mjs';

for (const [name, answers] of Object.entries({ CLEAN, REJECT, UNSURE })) {
  const r = await gradeJob({ jobId: PILOT_JOB, evidence: 'the report', answers, model: 'jev-1.13.0' });
  console.log(name.padEnd(7), '→', r.verdict.padEnd(13), r.reasons[0]);
}
