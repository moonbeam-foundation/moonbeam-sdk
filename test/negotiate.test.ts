import { describe, it, expect } from 'vitest';
import {
  open,
  bid,
  checkBid,
  accept,
  bestBid,
  expire,
  coverSplit,
  lockedByBuyer,
  parseUnits,
  settle,
  conservesValue,
} from '../src/index.js';
import type { Intent, Bid, CoverQuote } from '../src/index.js';

const usdc = (v: string) => parseUnits(v);

const INTENT: Intent = {
  id: 'intent-1',
  specDigest: '0xspec',
  acceptanceDigest: '0xaccept',
  capabilities: ['summarize'],
  maxPay: usdc('100'),
  damage: usdc('70'),
  closesAt: 100,
};

/* Cover sized to the residual behind a 120 bond, which is zero here. */
const COVER: CoverQuote = {
  premium: usdc('1'),
  poolCapital: usdc('5000'),
  evaluatorBond: usdc('25'),
};

const GOOD: Bid = {
  intentId: 'intent-1',
  agent: 'agent-a',
  pay: usdc('100'),
  deposit: usdc('120'),
  capabilities: ['summarize'],
  at: 10,
};

describe('negotiation refuses what settlement could not honour', () => {
  it('refuses a bond that does not outweigh the job', () => {
    const thin = { ...GOOD, deposit: usdc('40') };
    const r = checkBid(INTENT, thin, COVER, 10);
    expect(r?.code).toBe('DEPOSIT_BELOW_JOB');
  });

  it('refuses a bond exactly equal to the job, because equal is not outweighing', () => {
    const equal = { ...GOOD, deposit: usdc('100') };
    expect(checkBid(INTENT, equal, COVER, 10)?.code).toBe('DEPOSIT_BELOW_JOB');
  });

  it('refuses cover that cannot pay the residual behind the bond', () => {
    /* Damage 300 against a 120 bond leaves 180 residual. A pool holding 50
       cannot pay it, and saying so while the buyer still has a choice is the
       whole point of checking before anything is locked. */
    const big = { ...INTENT, damage: usdc('300') };
    const poor: CoverQuote = { ...COVER, poolCapital: usdc('50') };
    expect(checkBid(big, GOOD, poor, 10)?.code).toBe('COVER_CANNOT_PAY');

    /* The same job with a pool that can cover the residual clears. */
    const rich: CoverQuote = { ...COVER, poolCapital: usdc('180') };
    expect(checkBid(big, GOOD, rich, 10)).toBeNull();
  });

  it('refuses a bid above what the buyer will pay', () => {
    expect(checkBid(INTENT, { ...GOOD, pay: usdc('101') }, COVER, 10)?.code).toBe('ABOVE_MAX_PAY');
  });

  it('refuses an agent that never published the capability', () => {
    const r = checkBid(INTENT, { ...GOOD, capabilities: ['translate'] }, COVER, 10);
    expect(r?.code).toBe('CAPABILITY_MISSING');
    expect(r?.reason).toContain('summarize');
  });

  it('refuses a bid that arrives after the window closes', () => {
    expect(checkBid(INTENT, GOOD, COVER, 101)?.code).toBe('INTENT_CLOSED');
  });

  it('accepts a bid that clears every check', () => {
    expect(checkBid(INTENT, GOOD, COVER, 10)).toBeNull();
  });
});

describe('the machine records rather than throws', () => {
  it('keeps refused bids with their reason instead of dropping them', () => {
    const n = bid(open(INTENT), { ...GOOD, deposit: usdc('40') }, COVER, 10);
    expect(n.bids).toHaveLength(0);
    expect(n.refused).toHaveLength(1);
    expect(n.refused[0]?.code).toBe('DEPOSIT_BELOW_JOB');
  });

  it('takes the cheapest bid that cleared, not the first', () => {
    let n = open(INTENT);
    n = bid(n, GOOD, COVER, 10);
    n = bid(n, { ...GOOD, agent: 'agent-b', pay: usdc('80'), deposit: usdc('120') }, COVER, 11);
    expect(bestBid(n)?.agent).toBe('agent-b');
  });

  it('expires an intent nobody bid on', () => {
    expect(expire(open(INTENT), 101).phase).toBe('expired');
  });

  it('will not accept into a closed negotiation', () => {
    const n = expire(open(INTENT), 101);
    const r = accept(n, GOOD, COVER);
    expect('code' in r && r.code).toBe('INTENT_CLOSED');
  });
});

describe('the terms it produces are the terms settlement prices', () => {
  it('hands settle() complete terms that conserve value', () => {
    let n = open(INTENT);
    n = bid(n, GOOD, COVER, 10);
    const result = accept(n, GOOD, COVER);
    expect('terms' in result).toBe(true);
    if (!('terms' in result)) return;

    expect(result.negotiation.phase).toBe('agreed');

    /* Every verdict the settlement core knows still conserves value on terms
       this machine produced. That is the join working. */
    for (const verdict of ['doneRight', 'notDelivered', 'rejected', 'cheated'] as const) {
      const s = settle({ terms: result.terms, verdict });
      expect(conservesValue(s.ledger)).toBe(true);
    }
  });

  it('produces terms where cheating never nets the worker a profit', () => {
    let n = open(INTENT);
    n = bid(n, GOOD, COVER, 10);
    const result = accept(n, GOOD, COVER);
    if (!('terms' in result)) throw new Error('expected terms');

    const { ledger } = settle({ terms: result.terms, verdict: 'cheated' });
    /* the provider is always worse off than the job would have paid it */
    expect(ledger.provider).toBeLessThan(0n);
    expect(ledger.client).toBeGreaterThan(0n);
  });

  it('shows cover coming from the bond, with the pool as the tail', () => {
    const split = coverSplit({
      pay: usdc('100'),
      premium: usdc('1'),
      deposit: usdc('120'),
      evaluatorBond: usdc('25'),
      poolCapital: usdc('5000'),
      damage: usdc('70'),
    });
    expect(split.fromDeposit).toBe(usdc('70'));
    expect(split.fromPool).toBe(0n);
  });

  it('states what the buyer locks as its parts, not one summed figure', () => {
    const locked = lockedByBuyer({
      pay: usdc('100'),
      premium: usdc('1'),
      deposit: usdc('120'),
      evaluatorBond: usdc('25'),
      poolCapital: usdc('5000'),
      damage: usdc('70'),
    });
    expect(locked.pay).toBe(usdc('100'));
    expect(locked.premium).toBe(usdc('1'));
    expect(locked.total).toBe(usdc('101'));
  });
});
