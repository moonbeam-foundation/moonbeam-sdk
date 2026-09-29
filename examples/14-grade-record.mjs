// Grader stage 5: the record (optional). The unsigned calls that put the answers and the decision on chain.
// Recording is your choice: nothing here signs or sends; hand the calls to your own wallet.
//   node examples/14-grade-record.mjs
import { gradeJob, recordGrade } from '@moonbeam-foundation/sdk/judge';
import { CLEAN, PILOT_JOB } from './data/answers.mjs';

const receipt = await gradeJob({ jobId: PILOT_JOB, evidence: 'the report', answers: CLEAN, model: 'jev-1.13.0' });
const none = await recordGrade(receipt, { network: 'none' });
console.log('network none →', none.calls.length, 'calls; digests only:', none.digests.decision);
const base = await recordGrade(receipt, { network: 'base' });
for (const c of base.calls) console.log(`${c.fn} on chain ${c.chainId} → ${c.to} · ${c.data.length / 2 - 1} bytes of calldata`);
