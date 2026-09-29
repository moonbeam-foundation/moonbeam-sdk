// Onboarding, evaluator (the judge seat): your bond is exposed if your verdict is overturned, and an approval
// must come with a proof you can produce.
//   node examples/22-onboard-evaluator.mjs
import { readinessForEvaluator, summarise } from '@moonbeam-foundation/sdk';
import { TERMS, usdc, show } from './data/terms.mjs';

for (const canProve of [true, false]) { console.log(`\ncan prove: ${canProve}`); show(readinessForEvaluator({ terms: TERMS, freeCapital: usdc('500'), canProve }), summarise); }
