// Arbitration: the three tiers of the ArbitratorRouter as unsigned calls, the verdict the second grader signs, and what
// a ruling writes into the seller's record. Offline.
//   node examples/52-arbitration-calls.mjs
import { ARBITRATION_ON_BASE, resolveByCode, secondGraderTypedData, verdictDigest, councilApprove, resolveByCouncil, recordEffectOf } from '@moonbeam-foundation/sdk/arbitration';

console.log(ARBITRATION_ON_BASE.says);
const router = '0x00000000000000000000000000000000000000ab'; // pass the router's address once it is deployed
const jobId = '0x' + '11'.repeat(32);
console.log('tier 0, anyone:', resolveByCode(router, jobId).fn);
const v = { jobId, verdict: 'Cheated', loss: 10n ** 18n, decisionDigest: '0x' + '22'.repeat(32) };
console.log('tier 1, the second grader signs', secondGraderTypedData(router, v).primaryType, '→ digest', verdictDigest(router, v));
console.log('tier 2, the human seat:', councilApprove(router, jobId, 'Cheated', 10n ** 18n).fn, '· then anyone:', resolveByCouncil(router, jobId).fn);
console.log('a Cheated ruling:', recordEffectOf('Cheated').hook, '· seller record:', recordEffectOf('Cheated').sellerRecord);
