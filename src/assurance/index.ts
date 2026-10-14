/**
 * @moonbeam-foundation/sdk/assurance: the job assurance machine as Moonbeam ACP runs it.
 *
 * The machine and the Moonbeam venue come from one shared, pinned file (assurance-shared.ts; do not edit it, it is
 * re-synced from its source). This module adds the Moonbeam rules on top: the hook lane at Moonbeam's hook version, and
 * GLMR as the only money (every amount from the job's own numbers, no price feed).
 */
import {
  quote as coreQuote, run, eventsOf, whoCanEnd, endingOf, VENUES,
  type Economy, type EconomyInput, type EconomyQuote, type NativeStep, type Terms, type State, type PathStep,
} from './assurance-shared.js';
import { settleAttested as sharedSettleAttested, attest as sharedAttest, type AssuredJob, type SettleAttestOptions, type AttestInput, type AttestOptions } from './assurance-shared.js';
import { MOONBEAM_HOOK } from '../acp/moonbeam-acp.generated.js';

export * from './assurance-shared.js';

/** Moonbeam ACP: the hook on Base, GLMR only, read only for public writes */
export const MOONBEAM = VENUES.moonbeam!;

/** a quote in GLMR only: any other token is refused before the economy is asked */
export function quoteGlmr(i: EconomyInput, economy: Economy): { ok: true; terms: Terms; quote: EconomyQuote } | { ok: false; why: string[] } {
  if (i.token.symbol !== 'GLMR') return { ok: false, why: [`Moonbeam ACP prices in GLMR only, not ${i.token.symbol}`] };
  return coreQuote({ ...i, attachment: 'hook' }, economy);
}

/** a Moonbeam job from its trail (event names or the hook's State enum): where it is, who may end it, how it ended */
export function readJob(trail: NativeStep[]): { ok: true; state: State; path: PathStep[]; ending: ReturnType<typeof endingOf>; exits: ReturnType<typeof whoCanEnd> } | { ok: false; error: string } {
  const ctx = MOONBEAM.ctx!;
  const r = run(eventsOf(trail), ctx);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, state: r.state, path: r.path, ending: endingOf({ ctx, state: r.state, path: r.path }), exits: whoCanEnd(r.state, ctx) };
}

// ── attested by default, on Base (the Moonbeam profile of the shared helper) ─────────────────────────────────────────

/** settle() plus its attested mark, its JevDecisionLog attestation and its stamp: Base by default; `networks: 'none'` opts out */
export const settleAttested = (job: AssuredJob, q: EconomyQuote, opts: Omit<SettleAttestOptions, 'profile' | 'contract'> & { contract?: string } = {}) =>
  sharedSettleAttested(job, q, { profile: 'moonbeam', ...opts, contract: opts.contract ?? MOONBEAM_HOOK.address });
/** the shared attest() with Moonbeam's default (Base) */
export const attest = (input: AttestInput, opts: Omit<AttestOptions, 'profile'> = {}) => sharedAttest(input, { profile: 'moonbeam', ...opts });

/**
 * The legs of a funded Moonbeam (V3 hook) job, read from the job's own GLMR amounts as the hook pays them: no price feed,
 * no rate. completed → the seller takes price + deposit, the pool the premium (the buyer gets the premium back when no
 * pool covered the job); rejected, expired, a no-show → the buyer takes price + premium back, the seller its deposit. A
 * finding of cheating depends on the arbitrator's loss and is not priced here (settle refuses it).
 */
export function hookQuote(j: { price: bigint; premium: bigint; deposit: bigint; covered: boolean }): EconomyQuote {
  const z = { buyer: 0n, seller: 0n, backers: 0n, layer: 0n, evaluator: 0n };
  const done = { ...z, seller: j.price + j.deposit, backers: j.covered ? j.premium : 0n, buyer: j.covered ? 0n : j.premium };
  const unwind = { ...z, buyer: j.price + j.premium, seller: j.deposit };
  return {
    insurable: j.covered, why: j.covered ? [] : ['no pool covers this job'], premium: j.premium, backersLeg: j.covered ? j.premium : 0n, layerLeg: 0n, jobFee: 0n,
    deposit: j.deposit, cover: j.covered ? j.price : 0n, compensation: { noShow: 0n, rejection: 0n },
    legs: { completed: done, auto_completed: done, rejected: unwind, no_show: unwind, expired_delivered: unwind, unaccepted: unwind },
  };
}
