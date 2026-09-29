import { describe, expect, it } from 'vitest';
import {
  applyBps,
  breakEvenFailureRate,
  clearingFeeIsCoherent,
  formatUnits,
  impliedFailureRate,
  parseUnits,
  runSeason,
  settle,
} from '../src/index.js';
import type { JobTerms } from '../src/index.js';

const usdc = (value: string) => parseUnits(value);

describe('money never loses a unit', () => {
  it('round-trips through parse and format', () => {
    for (const value of ['0', '1', '0.000001', '100.5', '1234.567891']) {
      expect(formatUnits(parseUnits(value))).toBe(value);
    }
  });

  it('rejects more precision than the asset has', () => {
    expect(() => parseUnits('1.0000001')).toThrow(RangeError);
  });

  it('rounds bps down so no unit is ever minted', () => {
    // 1 unit at 34bps is 0.0034 units, which must floor to zero rather than
    // rounding up into value nobody funded.
    expect(applyBps(1n, 34)).toBe(0n);
    expect(applyBps(usdc('100'), 34)).toBe(usdc('0.34'));
  });
});

describe('a season of coverage', () => {
  const base = {
    jobs: 5_000,
    premiumPerJob: usdc('1'),
    damagePerFailure: usdc('70'),
    depositPerJob: usdc('40'),
  };

  it('profits at a low failure rate', () => {
    const result = runSeason({ ...base, failureRate: 0.006 });
    expect(result.failures).toBe(30);
    expect(result.profitable).toBe(true);
  });

  it('shows the providers absorbing the first loss', () => {
    const result = runSeason({ ...base, failureRate: 0.006 });
    expect(result.absorbedByDeposits).toBe(usdc('1200'));
    expect(result.paidByPool).toBe(usdc('900'));
  });

  it('turns negative once failures outrun the premium', () => {
    const result = runSeason({ ...base, failureRate: 0.2 });
    expect(result.profitable).toBe(false);
    expect(result.net).toBeLessThan(0n);
  });

  it('cannot lose when the deposit always covers the damage', () => {
    const result = runSeason({ ...base, damagePerFailure: usdc('40'), failureRate: 0.5 });
    expect(result.paidByPool).toBe(0n);
    expect(result.profitable).toBe(true);
  });

  it('rejects an impossible failure rate', () => {
    expect(() => runSeason({ ...base, failureRate: 1.5 })).toThrow(RangeError);
  });
});

describe('break-even, and whether a published fee agrees with it', () => {
  it('is undefined when the pool has no exposure', () => {
    expect(breakEvenFailureRate(usdc('1'), usdc('40'), usdc('40'))).toBeNull();
  });

  it('computes the rate at which a pool stops making money', () => {
    const rate = breakEvenFailureRate(usdc('1'), usdc('70'), usdc('40'));
    expect(rate).toBeCloseTo(1 / 31, 6);
  });

  it('reads a clearing fee as the failure rate the market is pricing', () => {
    expect(impliedFailureRate(34)).toBeCloseTo(0.0034, 6);
  });

  /**
   * This is the check that would have caught the mismatch between a published
   * 34bps clearing fee and a worked pool-backing example that only breaks even
   * around 3%. The two numbers describe the same thing and must agree.
   */
  it('flags a clearing fee an order of magnitude below break-even', () => {
    const coherent = clearingFeeIsCoherent(34, usdc('1'), usdc('70'), usdc('40'));
    expect(coherent).toBe(false);
  });

  it('accepts a fee priced near break-even', () => {
    const breakEven = breakEvenFailureRate(usdc('1'), usdc('70'), usdc('40'))!;
    const bps = Math.round(breakEven * 10_000);
    expect(clearingFeeIsCoherent(bps, usdc('1'), usdc('70'), usdc('40'))).toBe(true);
  });
});

/**
 * The season model and the settlement model must agree.
 *
 * `runSeason` used to compute its per-failure pool loss as a bare
 * `damage - deposit`, dropping the pool-capital cap that `settle` enforces. On
 * a thin pool (damage 900, deposit 40, capital 5) it projected a loss of 860
 * where `settle` pays 5 — a 172x overstatement of the figure a backer sizes
 * their capital against. Nothing compared the two, because each module was
 * tested in isolation.
 */
describe('a season never projects a loss settlement cannot produce', () => {
  const THIN: JobTerms = {
    pay: parseUnits('100'),
    premium: parseUnits('1'),
    deposit: parseUnits('40'),
    evaluatorBond: parseUnits('25'),
    poolCapital: parseUnits('5'),
    damage: parseUnits('900'),
  };

  it('caps the per-failure loss at pool capital, as settle does', () => {
    const { ledger } = settle({ terms: THIN, verdict: 'cheated' });
    const settled = -ledger.pool;

    const season = runSeason({
      jobs: 1,
      failureRate: 1,
      premiumPerJob: THIN.premium,
      damagePerFailure: THIN.damage,
      depositPerJob: THIN.deposit,
      poolCapital: THIN.poolCapital,
    });

    expect(season.capped).toBe(true);
    expect(season.paidByPool).toBe(settled);
    expect(season.paidByPool).toBeLessThanOrEqual(THIN.poolCapital);
  });

  /**
   * Across a spread of terms, not just the one that exposed the bug — a single
   * example can be satisfied by a coincidence.
   */
  it('agrees with settle over many shapes', () => {
    const damages = ['10', '50', '70', '400', '900'];
    const capitals = ['0', '5', '30', '5000'];
    for (const d of damages) {
      for (const c of capitals) {
        const terms: JobTerms = { ...THIN, damage: parseUnits(d), poolCapital: parseUnits(c) };
        const settled = -settle({ terms, verdict: 'cheated' }).ledger.pool;
        const season = runSeason({
          jobs: 1,
          failureRate: 1,
          premiumPerJob: terms.premium,
          damagePerFailure: terms.damage,
          depositPerJob: terms.deposit,
          poolCapital: terms.poolCapital,
        });
        expect(season.paidByPool, `damage ${d}, capital ${c}`).toBe(settled);
      }
    }
  });

  /**
   * Omitting capital is still allowed, and still uncapped — but it now says so,
   * so a caller cannot mistake the projection for a settlement figure.
   */
  it('marks an uncapped projection as uncapped', () => {
    const season = runSeason({
      jobs: 1,
      failureRate: 1,
      premiumPerJob: THIN.premium,
      damagePerFailure: THIN.damage,
      depositPerJob: THIN.deposit,
    });
    expect(season.capped).toBe(false);
    expect(season.paidByPool).toBeGreaterThan(THIN.poolCapital);
  });

  it('reports the same break-even whether asked directly or through terms', () => {
    const capped = breakEvenFailureRate(THIN.premium, THIN.damage, THIN.deposit, THIN.poolCapital);
    const uncapped = breakEvenFailureRate(THIN.premium, THIN.damage, THIN.deposit);
    expect(capped).not.toBeNull();
    expect(uncapped).not.toBeNull();
    // The cap makes the pool's loss smaller, so it breaks even at a HIGHER rate.
    expect(capped as number).toBeGreaterThan(uncapped as number);
  });
});
