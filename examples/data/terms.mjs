import { parseUnits } from '@moonbeam-foundation/sdk';
export const usdc = (v) => parseUnits(v);
// A 100 USDC job with 1 USDC of cover. The deposit is deliberately thin (40): onboarding should flag it.
export const TERMS = { pay: usdc('100'), premium: usdc('1'), deposit: usdc('40'), evaluatorBond: usdc('25'), poolCapital: usdc('5000'), damage: usdc('70') };

/** Print a readiness report the way a person should read it: the verdict, what you put up, what you can lose, what to fix. */
export function show(r, summarise) {
  console.log(summarise(r));
  console.log(`  you put up: ${r.youBond}\n  you can lose: ${r.youRisk}`);
  for (const f of r.findings) console.log(`  [${f.severity}] ${f.message}${f.remedy ? `\n      → ${f.remedy}` : ''}`);
}
