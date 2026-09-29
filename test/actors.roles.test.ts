import { describe, expect, it } from 'vitest';
import {
  bestCase,
  bondAtRisk,
  canAccept,
  capitalRequired,
  challengeQuote,
  coverGap,
  doubtQuote,
  parseUnits,
  poolExposure,
  positionsByVerdict,
  proofRequiredFor,
  recoveryFor,
  sizeWithinCap,
  solventUnder,
  worstCase,
  worthChallenging,
} from '../src/index.js';
import type { JobTerms } from '../src/index.js';

const usdc = (v: string) => parseUnits(v);

const TERMS: JobTerms = {
  pay: usdc('100'),
  premium: usdc('1'),
  deposit: usdc('40'),
  evaluatorBond: usdc('25'),
  poolCapital: usdc('5000'),
  damage: usdc('70'),
};

describe('every actor can see its whole risk picture', () => {
  it('reports a position under all four verdicts', () => {
    const p = positionsByVerdict('pool', TERMS);
    expect(Object.keys(p).sort()).toEqual(['cheated', 'doneRight', 'notDelivered', 'rejected']);
  });

  it('agrees with settle() rather than restating it', () => {
    expect(positionsByVerdict('client', TERMS).cheated).toBe(recoveryFor(TERMS));
  });

  it('bounds best and worst case', () => {
    expect(worstCase('pool', TERMS)).toBeLessThanOrEqual(bestCase('pool', TERMS));
  });
});

describe('client', () => {
  it('shows the damage nobody covers', () => {
    // Bonded capital far exceeds the damage here, so there is no gap.
    expect(coverGap(TERMS)).toBe(0n);
  });

  it('exposes a gap when the loss outruns everything bonded', () => {
    const thin: JobTerms = { ...TERMS, poolCapital: usdc('10'), damage: usdc('500') };
    expect(coverGap(thin)).toBe(usdc('450'));
  });

  it('is made more than whole when cheating is established', () => {
    expect(recoveryFor(TERMS)).toBe(usdc('70'));
  });
});

describe('provider', () => {
  it('needs exactly its deposit', () => {
    expect(capitalRequired(TERMS)).toBe(usdc('40'));
  });

  it('declines with a reason rather than a bare false', () => {
    const decision = canAccept(TERMS, usdc('10'));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain('exceeds free capital');
  });

  it('accepts when capital suffices', () => {
    expect(canAccept(TERMS, usdc('40')).ok).toBe(true);
  });

  it('loses nothing on a bare rejection, but its deposit on an adjudicated finding', () => {
    const p = positionsByVerdict('provider', TERMS);
    expect(p.rejected).toBe(0n);
    expect(p.cheated).toBe(usdc('-40'));
  });
});

describe('evaluator', () => {
  /**
   * The asymmetry, asserted rather than described: paying out someone else's
   * money needs proof; refusing to does not.
   */
  it('requires proof to approve but not to reject', () => {
    expect(proofRequiredFor('approve')).toBe(true);
    expect(proofRequiredFor('reject')).toBe(false);
  });

  it('risks exactly its bond', () => {
    expect(bondAtRisk(TERMS)).toBe(usdc('25'));
  });
});

describe('pool / backer', () => {
  it('reports utilisation and solvency across concurrent jobs', () => {
    const e = poolExposure(TERMS, 10, usdc('5000'));
    expect(e.committed).toBe(usdc('300')); // 10 jobs x (70 damage - 40 deposit)
    expect(e.solvent).toBe(true);
    expect(e.utilisation).toBeCloseTo(0.06);
  });

  it('goes insolvent when enough jobs fail together', () => {
    // The question runSeason cannot ask, because it assumes independence.
    expect(solventUnder(usdc('100'), TERMS, 10)).toBe(false);
  });

  it('commits nothing when the deposit covers the damage', () => {
    expect(poolExposure({ ...TERMS, damage: usdc('40') }, 100, usdc('5000')).committed).toBe(0n);
  });
});

describe('doubter', () => {
  it('prices the fee and the payout', () => {
    const q = doubtQuote(TERMS, usdc('30'), 34);
    expect(q.fee).toBe(usdc('0.102'));
    expect(q.maxPayout).toBe(usdc('30'));
    expect(q.capped).toBe(false);
  });

  it('flags a position larger than the capital that could pay it', () => {
    const q = doubtQuote(TERMS, usdc('9000'), 34);
    expect(q.capped).toBe(true);
    expect(q.maxPayout).toBe(usdc('5040')); // deposit + pool
    expect(q.maxPayout).toBeLessThan(usdc('9000'));
  });

  it('agrees with the arson cap', () => {
    expect(sizeWithinCap(TERMS, usdc('5040'))).toBe(true);
    expect(sizeWithinCap(TERMS, usdc('5041'))).toBe(false);
  });
});

describe('challenger', () => {
  it('prices the bet against a verdict', () => {
    const q = challengeQuote(TERMS, usdc('10'));
    expect(q.winAmount).toBe(usdc('25'));
    expect(q.loseAmount).toBe(usdc('10'));
    expect(q.breakEvenProbability).toBeCloseTo(10 / 35);
  });

  it('is worth taking only above the break-even odds', () => {
    expect(worthChallenging(TERMS, usdc('10'), 0.5)).toBe(true);
    expect(worthChallenging(TERMS, usdc('10'), 0.1)).toBe(false);
  });
});
