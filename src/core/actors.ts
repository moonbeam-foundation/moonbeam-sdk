import type { ActorSpec, Role } from './types.js';

/**
 * Who must put capital at risk to take part, and who may simply opt in.
 *
 * This answers the question the docs never state in one place: assurance is
 * obligatory for the two roles whose word the system relies on (the provider
 * doing the work and the evaluator grading it), and optional for everyone else.
 * A backer chooses whether to back a pool at all — but once in, underwriting is
 * not a separate opt-in: the exposure *is* the yield.
 */
export const ACTORS: Readonly<Record<Role, ActorSpec>> = Object.freeze({
  client: {
    role: 'client',
    obligation: 'optional',
    bonds: 'nothing beyond the price; the premium buys cover and is optional',
    earns: 'work delivered, or its money back',
    risks: 'the premium, which is not returned when cover was not needed',
  },
  provider: {
    role: 'provider',
    obligation: 'obligatory',
    bonds: 'a deposit, without which it cannot take insured work',
    earns: 'the job price, and its deposit back',
    risks: 'the deposit, consumed first when cheating is established',
  },
  evaluator: {
    role: 'evaluator',
    obligation: 'obligatory',
    bonds: 'a bond, without which it cannot issue verdicts',
    earns: 'a grading fee, and a failed challenge forfeits its bond to the evaluator',
    risks: 'the bond, paid to a challenger when its call is overturned',
  },
  pool: {
    role: 'pool',
    obligation: 'optional',
    bonds: 'capital put into a pool, chosen freely and per pool',
    earns: 'the premium on every job graded good, plus doubt fees',
    risks: 'covering damage the provider deposit cannot, after the provider pays first',
  },
  doubter: {
    role: 'doubter',
    obligation: 'optional',
    bonds: 'the fee, paid up front',
    earns: 'a payout when a protocol fails more than its price implied',
    risks: 'the fee, lost whenever the work is delivered',
  },
  challenger: {
    role: 'challenger',
    obligation: 'optional',
    bonds: 'a bond against one specific verdict',
    earns: "the evaluator's bond when the verdict is overturned",
    risks: 'the bond, forfeited when the challenge fails',
  },
});

export function actorsBy(obligation: ActorSpec['obligation']): readonly ActorSpec[] {
  return Object.values(ACTORS).filter((actor) => actor.obligation === obligation);
}
