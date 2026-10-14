import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MOONBEAM, VENUES, quoteGlmr, readJob, reachable, holdsFunds, whoCanEnd, unblockable, settle, buy,
  type Economy, type Legs, type MoneyEnding,
} from '../src/assurance/index.js';

const DIR = join(__dirname, '..', 'src', 'assurance');

describe('assurance: the shared machine, as Moonbeam ACP runs it', () => {
  it('the shared file is the pinned copy, unedited', () => {
    const pin = JSON.parse(readFileSync(join(DIR, 'assurance-shared.pin.json'), 'utf8'));
    expect(pin.profile).toBe('moonbeam');
    expect(createHash('sha256').update(readFileSync(join(DIR, 'assurance-shared.ts'))).digest('hex')).toBe(pin.sha256);
  });

  it('carries the Moonbeam venue only: GLMR, the hook on Base, no public writes', () => {
    expect(Object.keys(VENUES)).toEqual(['moonbeam']);
    expect(MOONBEAM.asset).toBe('GLMR only');
    expect(MOONBEAM.publicWrites).toBe(false);
    expect(MOONBEAM.chains.map((c) => c.chainId)).toEqual([8453]);
  });

  it('names where the GLMR sits in every held state, and every held state has an exit nobody can block', () => {
    const held = reachable(MOONBEAM.ctx!).filter(holdsFunds);
    expect(held.sort()).toEqual(Object.keys(MOONBEAM.moneyAt).sort());
    for (const s of held) expect(unblockable(s, MOONBEAM.ctx!)).not.toBeNull();
  });

  it('reads a job from its hook states: funded, delivered, completed', () => {
    const r = readJob([{ name: 'h', hookState: 1 }, { name: 'h', hookState: 2 }, { name: 'h', hookState: 3 }]);
    expect(r.ok && r.state).toBe('Settled');
    expect(r.ok && r.ending.id).toBe('completed');
    const open = readJob([{ name: 'JobFunded' }]);
    expect(open.ok && open.exits.map((e) => e.transition)).toEqual(['submit', 'expire_undelivered']);
    expect(readJob([{ name: 'h', hookState: 1 }, { name: 'h', hookState: 8 }]).ok).toBe(false);
  });

  // a stand-in economy (the real numbers come from jev-wilson): integer legs that conserve
  const stand: Economy = (i) => {
    const P = i.price, premium = P / 20n, jobFee = P / 200n, layerLeg = jobFee, backersLeg = premium - layerLeg, deposit = P * 2n, cover = P;
    const all = P + premium + jobFee;
    const legs: Partial<Record<MoneyEnding, Legs>> = {
      completed: { buyer: 0n, seller: P + deposit, backers: backersLeg, layer: layerLeg, evaluator: jobFee },
      no_show: { buyer: all, seller: deposit, backers: 0n, layer: 0n, evaluator: 0n },
    };
    return { insurable: true, why: [], premium, backersLeg, layerLeg, jobFee, deposit, cover, compensation: { noShow: 0n, rejection: 0n }, legs };
  };
  const input = { chainId: 8453, price: 10n ** 19n, record: { correct: 10, incorrect: 0 }, lockSeconds: 86_400, attachment: 'hook' as const };

  it('quotes in GLMR only, and settles a completed job from the committed legs', () => {
    expect(quoteGlmr({ ...input, token: { symbol: 'USDC', decimals: 6 } }, stand).ok).toBe(false);
    const q = quoteGlmr({ ...input, token: { symbol: 'GLMR', decimals: 18 } }, stand);
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    const b = buy({ venue: 'moonbeam', ctx: MOONBEAM.ctx!, chainId: 8453, jobId: '0x01', buyer: '0xb', seller: '0xs', evaluator: null, clock: {} }, q.terms);
    expect(b.ok && b.job.state).toBe('Funded');
    if (!b.ok) return;
    const done = { ...b.job, state: 'Settled' as const, path: [...b.job.path, { from: 'Funded' as const, to: 'Submitted' as const, transition: 'submit' as const }, { from: 'Submitted' as const, to: 'Settled' as const, transition: 'complete' as const }] };
    const s = settle(done, q.quote);
    expect(s.ok && s.legs.seller).toBe(input.price + q.terms.deposit);
    expect(whoCanEnd('Settled', MOONBEAM.ctx!)).toEqual([]);
  });
});
