// Grader stage 5: the record. Every grade comes with the unsigned calls that put its answers and its decision on chain,
// on Base by default; a stamp registry Base does not have is listed as missing. network 'none' turns recording off.
// Nothing here signs or sends; hand the calls to your own wallet.
//   node examples/14-grade-record.mjs
import { gradeJob, recordGrade } from '@moonbeam-foundation/sdk/judge';
import { CLEAN, PILOT_JOB } from './data/answers.mjs';

const receipt = await gradeJob({ jobId: PILOT_JOB, evidence: 'the report', answers: CLEAN, model: 'jev-1.13.0' });
const base = await recordGrade(receipt);
for (const c of base.calls) console.log(`${c.fn} on chain ${c.chainId} → ${c.to} · ${c.data.length / 2 - 1} bytes of calldata`);
for (const m of base.missing) console.log(`missing: ${m.why}`);
const none = await recordGrade(receipt, { network: 'none' });
console.log('network none →', none.calls.length, 'calls; digests only:', none.digests.decision);
