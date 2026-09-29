// Onboarding, buyer: before you fund a covered job, see what the cover really pays and what it leaves uncovered.
//   node examples/20-onboard-client.mjs
import { readinessForClient, blockers, summarise } from '@moonbeam-foundation/sdk';
import { TERMS, usdc, show } from './data/terms.mjs';

const r = readinessForClient({ terms: TERMS, trueLoss: usdc('500') }); // what a failure would really cost you
show(r, summarise);
console.log('blockers:', blockers(r).length);
