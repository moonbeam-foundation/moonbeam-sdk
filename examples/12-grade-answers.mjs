// Grader stage 3: Jev's answers. Four closed questions, each with a full probability distribution.
// Here the answers are supplied; with your key, gradeJob asks Jev instead (see 17-grade-live.mjs).
//   node examples/12-grade-answers.mjs
import { gradeJob } from '@moonbeam-foundation/sdk/judge';
import { CLEAN, PILOT_JOB } from './data/answers.mjs';

const receipt = await gradeJob({ jobId: PILOT_JOB, evidence: 'the report', answers: CLEAN, model: 'jev-1.13.0' });
for (const [id, a] of Object.entries(receipt.answers)) console.log(id.padEnd(18), a.value.padEnd(9), JSON.stringify(a.probabilities));
