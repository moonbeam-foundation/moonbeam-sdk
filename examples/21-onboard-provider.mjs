// Onboarding, seller: can you post the deposit this job needs, given what is already locked on your other jobs?
//   node examples/21-onboard-provider.mjs
import { readinessForProvider, summarise } from '@moonbeam-foundation/sdk';
import { TERMS, usdc, show } from './data/terms.mjs';

for (const freeCapital of ['1000', '30']) {
  const r = readinessForProvider({ terms: TERMS, freeCapital: usdc(freeCapital), committed: usdc('10') });
  console.log(`\nfree capital ${freeCapital} USDC:`); show(r, summarise);
}
