// Onboarding, backer: what standing behind a seller's jobs means for your capital. GLMR pools are not open yet
// (a pilot with selected partners); this shows the arithmetic, not an offer.
//   node examples/23-onboard-backer.mjs
import { readinessForBacker, summarise } from '@moonbeam-foundation/sdk';
import { TERMS, usdc, show } from './data/terms.mjs';

const r = readinessForBacker({ terms: TERMS, backing: usdc('100'), poolCapital: usdc('5000'), openJobs: 10, expectedFailureRate: 0.05 });
show(r, summarise);
