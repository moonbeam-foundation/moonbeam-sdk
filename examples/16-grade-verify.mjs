// Grader stage 7: verify. Anyone can recompute every digest of a receipt; a changed answer or verdict is caught.
//   node examples/16-grade-verify.mjs
import { gradeJob, verifyGrade } from '@moonbeam-foundation/sdk/judge';
import { CLEAN, PILOT_JOB } from './data/answers.mjs';

const receipt = await gradeJob({ jobId: PILOT_JOB, evidence: 'the report', answers: CLEAN, model: 'jev-1.13.0' });
console.log('as issued:', (await verifyGrade(receipt, { chain: false })).ok);
const tampered = { ...receipt, verdict: 'reject' };
console.log('tampered: ', (await verifyGrade(tampered, { chain: false })).ok);
