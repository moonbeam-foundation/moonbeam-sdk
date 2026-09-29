import { applyBps, clampToZero, min, sum, ZERO } from './money.js';
import type { Money } from './money.js';
import type {
  JobTerms,
  Ledger,
  Role,
  Settlement,
  SettlementInput,
} from './types.js';

const EMPTY_LEDGER: Ledger = Object.freeze({
  client: ZERO,
  provider: ZERO,
  evaluator: ZERO,
  pool: ZERO,
  doubter: ZERO,
  challenger: ZERO,
});

/**
 * Every role, derived rather than listed.
 *
 * This used to be a hand-written array typed `readonly Role[]`, which meant a
 * *missing* entry compiled cleanly — and `ledgerTotal` would then sum a subset,
 * so `conservesValue` returned true for a ledger that did not conserve. The
 * package's headline invariant could pass on a broken ledger.
 *
 * `EMPTY_LEDGER` is `Record<Role, Money>`, so it cannot omit a role without
 * failing to compile. Reading the keys from it makes that protection cover the
 * conservation check too.
 */
const ROLES = Object.keys(EMPTY_LEDGER) as readonly Role[];

/** Escrowed for the duration of the job: the client's money plus the provider's bond. */
export function lockedValue(terms: JobTerms): Money {
  return terms.pay + terms.premium + terms.deposit;
}

/**
 * The most a doubt position can ever pay out — "the arson rule".
 *
 * Doubt is capped by the capital already bonded to the job. Without this cap,
 * a party could take a large doubt position and then cause the failure it bet
 * on. With it, causing a failure always costs more than doubting it can pay.
 */
export function maxDoubtPayout(terms: JobTerms): Money {
  return terms.deposit + terms.poolCapital;
}

/**
 * What the pool actually loses on one established cheating.
 *
 * The provider's deposit is consumed first, and the pool can never be charged
 * more than it put up — so the loss is the damage minus the deposit, capped at
 * pool capital. Both bounds matter and dropping either one changes the answer.
 *
 * This exists because four modules were each computing this quantity and two of
 * them omitted the cap: `runSeason` and the backer's readiness check both used
 * a bare `damage - deposit`. On a thin pool (damage 900, deposit 40, capital 5)
 * that reported a loss of 860 where `settle` pays 5 — a 172x overstatement of
 * the number a backer sizes their capital against. The models disagreed because
 * the quantity had four definitions rather than one.
 *
 * `settle` is the authority on what money moves, so the definition lives here
 * and everyone else calls it. Same reasoning as `maxDoubtPayout` above, which
 * has been shared from the start and has never drifted.
 */
export function poolLossPerFailure(terms: JobTerms): Money {
  return min(clampToZero(terms.damage - terms.deposit), terms.poolCapital);
}

function assertNonNegative(terms: JobTerms): void {
  const entries: readonly (readonly [string, Money])[] = [
    ['pay', terms.pay],
    ['premium', terms.premium],
    ['deposit', terms.deposit],
    ['evaluatorBond', terms.evaluatorBond],
    ['poolCapital', terms.poolCapital],
    ['damage', terms.damage],
  ];
  for (const [name, value] of entries) {
    if (value < 0n) throw new RangeError(`${name} must not be negative`);
  }
}

/**
 * Settle one insured job and return every actor's net position.
 *
 * The function is total and pure: same input, same output, no clock, no chain,
 * no I/O. That is what makes the economic invariants testable — conservation of
 * value, the arson cap, and "cheating pays the victim" are assertions over this
 * return value rather than claims in prose.
 *
 * Sign convention: positive is received, negative is paid.
 */
export function settle(input: SettlementInput): Settlement {
  const { terms, verdict, doubt, challenge } = input;
  assertNonNegative(terms);

  const ledger: Record<Role, Money> = { ...EMPTY_LEDGER };
  const explain: string[] = [];
  const credit = (role: Role, amount: Money, why: string): void => {
    if (amount === ZERO) return;
    ledger[role] += amount;
    explain.push(why);
  };

  // ── Doubt premium is paid up front, whatever the outcome ──
  // The doubter buys the right to be paid on failure; the pool sells it.
  if (doubt && doubt.notional > ZERO) {
    const fee = applyBps(doubt.notional, doubt.feeBps);
    credit('doubter', -fee, `doubter pays ${fee} fee on ${doubt.notional} notional at ${doubt.feeBps}bps`);
    credit('pool', fee, `pool receives ${fee} doubt fee`);
  }

  let poolShortfall = ZERO;

  switch (verdict) {
    case 'doneRight': {
      // Work delivered and graded good: the client pays, the provider is paid,
      // the pool keeps the premium for cover it did not have to honour.
      credit('client', -(terms.pay + terms.premium), `client pays ${terms.pay} for work and ${terms.premium} for cover`);
      credit('provider', terms.pay, `provider receives ${terms.pay}; deposit returned`);
      credit('pool', terms.premium, `pool earns the ${terms.premium} premium`);
      break;
    }

    case 'notDelivered': {
      // ACP's SLA-expiry path: escrow unwinds. Nobody is punished, nothing is
      // stuck, and the pool earns nothing because it covered nothing.
      explain.push('nobody delivered: escrow unwinds, client refunded in full, deposit returned, no penalty');
      break;
    }

    case 'rejected': {
      // Work arrived and was graded bad. Numerically identical to notDelivered
      // today — everything walks back — but kept distinct because the two are
      // different facts about the world, and a pool that wants to price
      // rejection rate separately from fraud rate needs them separable.
      // Crucially: NO damage cover. An evaluator's refusal costs it nothing and
      // requires no proof, so it cannot on its own be grounds to charge a pool.
      explain.push('graded bad: escrow unwinds, client refunded, deposit returned, no damage cover');
      break;
    }

    case 'cheated': {
      // The case a bare escrow cannot answer. The client is refunded (net zero
      // on the job price) and additionally compensated: first from the
      // provider's deposit, then from the pool for whatever the deposit cannot
      // cover. Every unit paid to the client comes from someone who did wrong
      // or who sold cover — never from an uninvolved party.
      const fromDeposit = min(terms.damage, terms.deposit);
      credit('provider', -fromDeposit, `provider forfeits ${fromDeposit} of its deposit`);
      credit('client', fromDeposit, `client receives ${fromDeposit} from the provider's deposit`);

      poolShortfall = poolLossPerFailure(terms);
      credit('pool', -poolShortfall, `pool covers ${poolShortfall} the deposit could not`);
      credit('client', poolShortfall, `client receives ${poolShortfall} from the pool`);

      if (doubt && doubt.notional > ZERO) {
        const payout = min(doubt.notional, maxDoubtPayout(terms));
        credit('doubter', payout, `doubter paid ${payout} (capped at bonded capital)`);
        credit('pool', -payout, `pool pays ${payout} to doubt`);
      }
      break;
    }
  }

  // ── A challenge is a separate, bonded claim about the verdict itself ──
  if (challenge && (challenge.bond > ZERO || terms.evaluatorBond > ZERO)) {
    if (challenge.upheld) {
      credit('evaluator', -terms.evaluatorBond, `evaluator's call overturned: forfeits ${terms.evaluatorBond}`);
      credit('challenger', terms.evaluatorBond, `challenger paid ${terms.evaluatorBond} from the evaluator's bond`);
    } else {
      credit('challenger', -challenge.bond, `challenge failed: challenger forfeits ${challenge.bond}`);
      credit('evaluator', challenge.bond, `evaluator keeps its bond and takes ${challenge.bond}`);
    }
  }

  return {
    ledger: Object.freeze({ ...ledger }),
    locked: lockedValue(terms),
    poolShortfall,
    explain: Object.freeze(explain),
  };
}

/**
 * Total of every position. Must always be zero: settlement moves value between
 * actors, it never creates or destroys it.
 */
export function ledgerTotal(ledger: Ledger): Money {
  return sum(ROLES.map((role) => ledger[role]));
}

/** True when the ledger conserves value. Every settlement must satisfy this. */
export function conservesValue(ledger: Ledger): boolean {
  return ledgerTotal(ledger) === ZERO;
}
