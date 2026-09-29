import { describe, expect, it } from 'vitest';
import {
  conservesValue,
  ledgerTotal,
  lockedValue,
  maxDoubtPayout,
  parseUnits,
  settle,
} from '../src/index.js';
import type { JobTerms, Role, Verdict } from '../src/index.js';

const usdc = (value: string) => parseUnits(value);

/** The site's worked example, in USDC. */
const TERMS: JobTerms = {
  pay: usdc('100'),
  premium: usdc('1'),
  deposit: usdc('40'),
  evaluatorBond: usdc('25'),
  poolCapital: usdc('5000'),
  damage: usdc('70'),
};

const VERDICTS: readonly Verdict[] = ['doneRight', 'notDelivered', 'rejected', 'cheated'];

describe('value conservation', () => {
  it.each(VERDICTS)('conserves value on %s', (verdict) => {
    const { ledger } = settle({ terms: TERMS, verdict });
    expect(ledgerTotal(ledger)).toBe(0n);
    expect(conservesValue(ledger)).toBe(true);
  });

  it('conserves value with doubt and a challenge in play', () => {
    for (const verdict of VERDICTS) {
      for (const upheld of [true, false]) {
        const { ledger } = settle({
          terms: TERMS,
          verdict,
          doubt: { notional: usdc('30'), feeBps: 34 },
          challenge: { bond: usdc('10'), upheld },
        });
        expect(ledgerTotal(ledger), `${verdict}/${upheld}`).toBe(0n);
      }
    }
  });

  it('conserves value when the pool cannot cover the damage', () => {
    const thin: JobTerms = { ...TERMS, poolCapital: usdc('5'), damage: usdc('900') };
    const { ledger } = settle({ terms: thin, verdict: 'cheated' });
    expect(ledgerTotal(ledger)).toBe(0n);
  });
});

describe('the vault total is derived, not asserted', () => {
  it('locks pay + premium + deposit', () => {
    expect(lockedValue(TERMS)).toBe(usdc('141'));
  });

  it('follows its inputs when they change', () => {
    expect(lockedValue({ ...TERMS, pay: usdc('200') })).toBe(usdc('241'));
  });
});

describe('cheating pays the victim', () => {
  it('leaves the client better off than whole', () => {
    const { ledger } = settle({ terms: TERMS, verdict: 'cheated' });
    expect(ledger.client).toBe(usdc('70'));
    expect(ledger.client).toBeGreaterThan(0n);
  });

  it('funds the client only from the provider and the pool', () => {
    const { ledger } = settle({ terms: TERMS, verdict: 'cheated' });
    expect(ledger.provider).toBe(usdc('-40'));
    expect(ledger.pool).toBe(usdc('-30'));
    expect(ledger.provider + ledger.pool).toBe(-ledger.client);
  });

  it('takes the provider deposit before touching the pool', () => {
    const small = { ...TERMS, damage: usdc('30') };
    const { ledger, poolShortfall } = settle({ terms: small, verdict: 'cheated' });
    expect(poolShortfall).toBe(0n);
    expect(ledger.pool).toBe(0n);
    expect(ledger.provider).toBe(usdc('-30'));
  });

  it('never charges the pool more than it put up', () => {
    const thin: JobTerms = { ...TERMS, poolCapital: usdc('5'), damage: usdc('900') };
    const { ledger } = settle({ terms: thin, verdict: 'cheated' });
    expect(-ledger.pool).toBeLessThanOrEqual(thin.poolCapital);
  });
});

describe('nobody delivered', () => {
  it('punishes no one and strands nothing', () => {
    const { ledger } = settle({ terms: TERMS, verdict: 'notDelivered' });
    expect(ledger.client).toBe(0n);
    expect(ledger.provider).toBe(0n);
    expect(ledger.pool).toBe(0n);
  });
});

describe('graded bad (rejected)', () => {
  it('walks everything back without charging the pool', () => {
    const { ledger, poolShortfall } = settle({ terms: TERMS, verdict: 'rejected' });
    expect(ledger.client).toBe(0n);
    expect(ledger.provider).toBe(0n);
    expect(ledger.pool).toBe(0n);
    expect(poolShortfall).toBe(0n);
  });

  /**
   * The protection this verdict exists for: an evaluator can refuse for free
   * and without proof, so a bare rejection must never reach the pool. Only an
   * adjudicated finding of dishonesty does.
   */
  it('never pays damage cover, however large the damage', () => {
    const huge: JobTerms = { ...TERMS, damage: usdc('100000') };
    const { ledger } = settle({ terms: huge, verdict: 'rejected' });
    expect(ledger.pool).toBe(0n);
    expect(ledger.client).toBe(0n);
  });

  it('costs the provider nothing, unlike cheating', () => {
    const rejected = settle({ terms: TERMS, verdict: 'rejected' });
    const cheated = settle({ terms: TERMS, verdict: 'cheated' });
    expect(rejected.ledger.provider).toBe(0n);
    expect(cheated.ledger.provider).toBeLessThan(0n);
  });
});

describe('done right', () => {
  it('pays the provider and leaves the premium with the pool', () => {
    const { ledger } = settle({ terms: TERMS, verdict: 'doneRight' });
    expect(ledger.client).toBe(usdc('-101'));
    expect(ledger.provider).toBe(usdc('100'));
    expect(ledger.pool).toBe(usdc('1'));
  });
});

describe('the arson rule', () => {
  it('caps doubt at the capital already bonded', () => {
    expect(maxDoubtPayout(TERMS)).toBe(usdc('5040'));
  });

  it('never pays a doubter more than is bonded, however large the position', () => {
    const { ledger } = settle({
      terms: TERMS,
      verdict: 'cheated',
      doubt: { notional: usdc('9000'), feeBps: 34 },
    });
    const fee = usdc('9000') * 34n / 10_000n;
    expect(ledger.doubter).toBe(maxDoubtPayout(TERMS) - fee);
    expect(ledger.doubter).toBeLessThan(usdc('9000'));
  });

  it('makes sabotage unprofitable: the payout cap never exceeds what an attacker must burn', () => {
    // An attacker causing a failure forfeits the provider deposit, and can
    // never collect more than deposit + pool. So there is no position size at
    // which burning the job pays more than the capital it destroys.
    const payout = maxDoubtPayout(TERMS);
    expect(payout).toBe(TERMS.deposit + TERMS.poolCapital);
  });

  it('charges the doubt fee even when the work is delivered', () => {
    const { ledger } = settle({
      terms: TERMS,
      verdict: 'doneRight',
      doubt: { notional: usdc('30'), feeBps: 34 },
    });
    expect(ledger.doubter).toBeLessThan(0n);
    expect(ledger.pool).toBeGreaterThan(TERMS.premium);
  });
});

describe('challenges', () => {
  it('pays an upheld challenger from the evaluator bond', () => {
    const { ledger } = settle({
      terms: TERMS,
      verdict: 'doneRight',
      challenge: { bond: usdc('10'), upheld: true },
    });
    expect(ledger.evaluator).toBe(usdc('-25'));
    expect(ledger.challenger).toBe(usdc('25'));
  });

  it('forfeits the bond of a failed challenge to the evaluator', () => {
    const { ledger } = settle({
      terms: TERMS,
      verdict: 'doneRight',
      challenge: { bond: usdc('10'), upheld: false },
    });
    expect(ledger.challenger).toBe(usdc('-10'));
    expect(ledger.evaluator).toBe(usdc('10'));
  });
});

describe('input validation', () => {
  it('rejects negative terms rather than settling nonsense', () => {
    expect(() => settle({ terms: { ...TERMS, pay: -1n }, verdict: 'doneRight' })).toThrow(RangeError);
  });
});

describe('explanations', () => {
  it('traces every transfer it makes', () => {
    const { explain } = settle({ terms: TERMS, verdict: 'cheated' });
    expect(explain.length).toBeGreaterThan(0);
    expect(explain.join(' ')).toContain('deposit');
  });
});

/**
 * The conservation check must range over *every* role.
 *
 * `ROLES` was once a hand-written array typed `readonly Role[]`, so dropping an
 * entry compiled cleanly and `conservesValue` then summed a subset — returning
 * true for a ledger that did not conserve. The package's headline invariant
 * could pass on a broken ledger. It is now derived from `EMPTY_LEDGER`, which
 * is `Record<Role, Money>` and cannot omit a role without failing to compile.
 */
describe('conservation ranges over every role', () => {
  it('reports every role in the ledger', () => {
    const { ledger } = settle({ terms: TERMS, verdict: 'doneRight' });
    const roles: Role[] = ['client', 'provider', 'evaluator', 'pool', 'doubter', 'challenger'];
    for (const role of roles) {
      expect(ledger, `missing ${role}`).toHaveProperty(role);
    }
    expect(Object.keys(ledger)).toHaveLength(roles.length);
  });

  /**
   * The specific failure the old code allowed: an imbalance parked on a role
   * outside the summed set would have gone unnoticed.
   */
  it('detects an imbalance on any single role', () => {
    const { ledger } = settle({ terms: TERMS, verdict: 'doneRight' });
    for (const role of Object.keys(ledger) as Role[]) {
      const tampered = { ...ledger, [role]: ledger[role] + 1n };
      expect(conservesValue(tampered), `imbalance on ${role} went undetected`).toBe(false);
    }
  });
});
