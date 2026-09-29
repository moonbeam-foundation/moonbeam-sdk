import { describe, it, expect } from 'vitest';
import {
  D18, POOL_CAP, MIN_DEPOSIT, DISPUTE_WINDOW_S, parseU, formatU, pct, sharesFor, assetsFor, sharePrice, roomUnderCap, premiumShare,
  depositBlock, depositPreview, maxDeposit, withdrawPreview, rulesFor, GRADER_MODES, depositCalls, redeemCalls, createPoolCalls, POOL_SIGNATURES, POOL_FACTORY,
  POOLS_OPEN_ON, PoolsNotOpenError,
} from '../src/pools/index.js';
import { selector } from '../src/onboard/index.js';

const G = (s: string) => parseU(s, 18);
// the devnet pool as read on 2026-09-24 after one 250 GLMR deposit: A = S = 250e18
const DEVNET = { totalAssets: G('250'), totalShares: G('250') };
const POOL = '0x731Cda5A2e0D49d7b6ff47eEab604E5b762222f9' as const;
const ASSET = '0x948C28425A86BE14b8a637aF7471E87b8396318a' as const;
const ME = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;

describe('fixed point', () => {
  it('parses to 18 decimals, cuts extra digits, rejects junk', () => {
    expect(parseU('1')).toBe(D18);
    expect(parseU('1,234.5')).toBe(1234500000000000000000n);
    expect(parseU('0.0000000000000000001')).toBe(0n); // 19th decimal cut, never rounded
    expect(parseU('1.1234567890123456789')).toBe(1123456789012345678n);
    expect(parseU('abc')).toBe(0n); expect(parseU('')).toBe(0n); expect(parseU('.')).toBe(0n); expect(parseU('1e5')).toBe(0n);
    expect(parseU('2.5', 6)).toBe(2500000n);
  });
  it('formats with commas and cut decimals', () => {
    expect(formatU(1234500000000000000000n, 18, 6)).toBe('1,234.500000');
    expect(formatU(1234500000000000000000n, 18, 0)).toBe('1,234');
    expect(formatU(999999999999999999n, 18, 2)).toBe('0.99');
    expect(formatU(-D18, 18, 1)).toBe('-1.0');
    expect(formatU(4182311n, 6, 6)).toBe('4.182311');
  });
  it('percent of a pool, empty denominator is 0', () => {
    expect(pct(G('1500'), G('38420'), 2)).toBe('3.90%');
    expect(pct(0n, 0n, 2)).toBe('0.00%');
    expect(pct(G('50000'), POOL_CAP, 0)).toBe('100%');
  });
});

describe('4626 arithmetic', () => {
  it('one share per GLMR while the pool is empty', () => {
    expect(sharesFor(G('10'), { totalAssets: 0n, totalShares: 0n })).toBe(G('10'));
    expect(sharePrice({ totalAssets: 0n, totalShares: 0n })).toBe(D18);
    expect(assetsFor(G('1'), { totalAssets: 0n, totalShares: 0n })).toBe(0n);
  });
  it('floors in the pool’s favour: the fraction below the last decimal stays', () => {
    const p = { totalAssets: G('300'), totalShares: G('100') }; // 3 GLMR a share
    expect(sharesFor(G('10'), p)).toBe(3333333333333333333n); // 3.333333333333333333, not …34
    expect(assetsFor(3333333333333333333n, p)).toBe(9999999999999999999n); // 9.999999999999999999 back, 1 wei stays
    expect(sharePrice(p)).toBe(3n * D18);
  });
  it('the devnet pool prices at exactly 1.000000 because no cover was paid', () => {
    expect(formatU(sharePrice(DEVNET), 18, 6)).toBe('1.000000');
    expect(sharesFor(G('1000'), DEVNET)).toBe(G('1000'));
  });
  it('refuses negative inputs', () => {
    expect(() => sharesFor(-1n, DEVNET)).toThrow(RangeError);
    expect(() => assetsFor(1n, { totalAssets: -1n, totalShares: 1n })).toThrow(RangeError);
  });
  it('room under the cap and the premium split', () => {
    expect(roomUnderCap(G('38420'))).toBe(G('11580'));
    expect(roomUnderCap(G('50000'))).toBe(0n);
    expect(roomUnderCap(G('60000'))).toBe(0n);
    expect(premiumShare(25200n, G('1500'), G('38420'))).toBe(983n); // floor(25200 × 1500 ÷ 38420)
    expect(premiumShare(25200n, G('1500'), 0n)).toBe(0n);
  });
});

describe('the deposit card', () => {
  const bal = G('12400');
  it('names each block reason in the order the card checks them', () => {
    expect(depositBlock({ amount: G('100'), balance: bal, totalAssets: G('50000') })?.code).toBe('FULL');
    expect(depositBlock({ amount: 0n, balance: bal, totalAssets: G('100') })?.code).toBe('EMPTY');
    expect(depositBlock({ amount: G('9.999999999999999999'), balance: bal, totalAssets: G('100') })).toMatchObject({ code: 'BELOW_MIN', label: 'Minimum deposit is 10 GLMR' });
    expect(depositBlock({ amount: G('12400.000000000000000001'), balance: bal, totalAssets: G('100') })).toMatchObject({ code: 'OVER_BALANCE', danger: true });
    expect(depositBlock({ amount: G('12000'), balance: bal, totalAssets: G('38420') })).toMatchObject({ code: 'OVER_CAP', label: 'Only 11,580.00 GLMR fits under the cap', danger: true });
    expect(depositBlock({ amount: G('10'), balance: bal, totalAssets: G('100') })).toBeNull();
    expect(depositBlock({ amount: G('11580'), balance: bal, totalAssets: G('38420') })).toBeNull(); // exactly to the cap is allowed
  });
  it('previews shares, share of pool and value before and after', () => {
    const p = depositPreview({ amount: G('1000'), balance: bal, pool: DEVNET, myShares: 0n });
    expect(p.shares).toBe(G('1000'));
    expect(p.after).toEqual({ totalAssets: G('1250'), totalShares: G('1250') });
    expect(p.shareBefore).toBe(0n);
    expect(p.shareAfter).toBe(8000n); // 80.00 %
    expect(p.valueAfter).toBe(G('1000'));
    expect(p.block).toBeNull();
  });
  it('max is the smaller of the balance and the room', () => {
    expect(maxDeposit(bal, G('38420'))).toBe(G('11580'));
    expect(maxDeposit(G('100'), G('38420'))).toBe(G('100'));
    expect(maxDeposit(bal, G('50000'))).toBe(0n);
  });
});

describe('the withdraw card', () => {
  const now = 1_790_260_000;
  it('25/50/75/MAX of the shares, today’s value, premiums now, GLMR after the window when held', () => {
    const w = withdrawPreview({ percent: 50, myShares: G('1500'), pool: { totalAssets: G('38420'), totalShares: G('38420') }, premiumsClaimable: 4182311n, now, holdUntil: now + 3 * 86400 });
    expect(w.sharesIn).toBe(G('750'));
    expect(w.assetsOut).toBe(G('750'));
    expect(w.premiumsNow).toBe(4182311n);
    expect(w.sharesLeft).toBe(G('750'));
    expect(w.availableAt).toBe(now + 3 * 86400);
    expect(w.waitS).toBe(3 * 86400);
    expect(w.shareBefore).toBe(390n); expect(w.shareAfter).toBe(199n);
    expect(w.block).toBeNull();
  });
  it('arrives now when nothing holds it (the devnet pool: free assets = total)', () => {
    const w = withdrawPreview({ percent: 100, myShares: G('250'), pool: DEVNET, now, holdUntil: 0, freeAssets: G('250'), maxWithdraw: G('250') });
    expect(w.assetsOut).toBe(G('250')); expect(w.availableNow).toBe(G('250')); expect(w.availableAt).toBe(now); expect(w.waitS).toBe(0);
    expect(w.sharesLeft).toBe(0n); expect(w.shareAfter).toBe(0n);
  });
  it('waits the dispute window when the pool has promised the capital to an open job', () => {
    const w = withdrawPreview({ percent: 100, myShares: G('250'), pool: DEVNET, now, freeAssets: G('100') });
    expect(w.availableNow).toBe(G('100'));
    expect(w.availableAt).toBe(now + DISPUTE_WINDOW_S);
  });
  it('blocks an empty position and a 0 % pick', () => {
    expect(withdrawPreview({ percent: 50, myShares: 0n, pool: DEVNET, now }).block?.label).toBe('You have nothing in this pool');
    expect(withdrawPreview({ percent: 0, myShares: G('1'), pool: DEVNET, now }).block?.code).toBe('EMPTY');
    expect(() => withdrawPreview({ percent: 101, myShares: G('1'), pool: DEVNET, now })).toThrow(RangeError);
  });
});

describe('the three rules', () => {
  it('use the pool as it stands and the record’s typical price', () => {
    const r = rulesFor({ pool: DEVNET, myShares: G('250'), typicalPriceUsdc: 2_100_000n, premiumBps: 120, sellerDepositX: '1.25×' });
    expect(r).toHaveLength(3);
    expect(r[0]!.body).toContain('1.000000 GLMR a share, 1,000 GLMR buys 1,000.000000 shares');
    expect(r[1]!.body).toContain('A typical 2.10 USDC job pays a 0.0252 USDC premium. At 100.00% of the pool, 0.025200 USDC of it is yours.');
    expect(r[2]!.body).toContain('1.25× deposit');
  });
  it('says so when the record carries no price', () => {
    const r = rulesFor({ pool: DEVNET, myShares: 0n, typicalPriceUsdc: null, premiumBps: null, sellerDepositX: '1.2×' });
    expect(r[1]!.body).toContain('No premium rate is priced from this record yet');
  });
  it('carries the two grader modes in the design’s words', () => {
    expect(GRADER_MODES.judged.tag).toBe('JEV GRADED');
    expect(GRADER_MODES.declared.body).toContain('Anyone can re-run it and get the same answer');
  });
});

describe('unsigned calls', () => {
  it('approve exactly the amount to the pool, then deposit(amount, receiver): pinned against the devnet deposit of 2026-09-24', () => {
    const c = depositCalls({ chainId: 36927, pool: POOL, asset: ASSET, amount: G('250'), receiver: ME });
    expect(c).toHaveLength(2);
    expect(c[0]!.to).toBe(ASSET);
    expect(c[0]!.data).toBe('0x095ea7b3' + '000000000000000000000000731cda5a2e0d49d7b6ff47eeab604e5b762222f9' + '00000000000000000000000000000000000000000000000d8d726b7177a80000');
    expect(c[1]!.to).toBe(POOL);
    // the calldata cast sent as tx 0xf97f2c8c… on the devnet: deposit(250e18, anvil#0)
    expect(c[1]!.data).toBe('0x6e553f65' + '00000000000000000000000000000000000000000000000d8d726b7177a80000' + '000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266');
    expect(c.map((x) => x.chainId)).toEqual([36927, 36927]);
    expect(() => depositCalls({ chainId: 36927, pool: POOL, asset: ASSET, amount: 0n, receiver: ME })).toThrow(RangeError);
  });
  it('redeem(shares, receiver, owner) with the owner as both', () => {
    const c = redeemCalls({ chainId: 36927, pool: POOL, shares: G('1'), owner: ME });
    expect(c[0]!.data.startsWith(selector(POOL_SIGNATURES.redeem))).toBe(true);
    expect(c[0]!.data).toBe('0xba087652' + '0000000000000000000000000000000000000000000000000de0b6b3a7640000' + '000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266'.repeat(2));
  });
  it('createPool(seller, asset, name, symbol): dynamic strings encoded as the factory decodes them, pinned against cast calldata for the devnet pool of 2026-09-24', () => {
    const c = createPoolCalls({ chainId: 36927, seller: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', asset: ASSET, name: 'Moonbeam cover · dGLMR · seller 0x7099…79C8', symbol: 'mbp-cover-7099' });
    expect(c).toHaveLength(1); expect(c[0]!.to).toBe(POOL_FACTORY[36927]);
    expect(c[0]!.data).toBe('0x3d5c8e3100000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8000000000000000000000000948c28425a86be14b8a637af7471e87b8396318a000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000002f4d6f6f6e6265616d20636f76657220c2b72064474c4d5220c2b72073656c6c657220307837303939e280a6373943380000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e6d62702d636f7665722d37303939000000000000000000000000000000000000');
    // Base mainnet is refused until pools open: the call would be real, so it is not built.
    expect(() => createPoolCalls({ chainId: 8453, seller: '0x515e7bce44baa5f6e42d16d4b5f27768e7f2f8cc', asset: '0xB3846fD356c2149ee8D30b0449088Dc74e265459', name: 'x', symbol: 'y' })).toThrow(PoolsNotOpenError);
    expect(() => createPoolCalls({ chainId: 1, seller: ME, asset: ASSET, name: 'x', symbol: 'y' })).toThrow(PoolsNotOpenError);
    expect(() => createPoolCalls({ chainId: 36927, seller: ME, asset: ASSET, name: ' ', symbol: 'y' })).toThrow(RangeError);
  });
  it('pools are not open: no deposit, redemption or new pool is built for Base mainnet', () => {
    expect(POOLS_OPEN_ON).toEqual([36927]);
    expect(() => depositCalls({ chainId: 8453, pool: ME, asset: '0xB3846fD356c2149ee8D30b0449088Dc74e265459', amount: 10n ** 19n, receiver: ME })).toThrow(PoolsNotOpenError);
    expect(() => redeemCalls({ chainId: 8453, pool: ME, shares: 1n, owner: ME })).toThrow(/pools are not open on chain 8453/);
  });
  it('selectors are the ERC-20 / ERC-4626 ones', () => {
    expect(selector(POOL_SIGNATURES.approve)).toBe('0x095ea7b3');
    expect(selector(POOL_SIGNATURES.deposit)).toBe('0x6e553f65');
    expect(selector(POOL_SIGNATURES.redeem)).toBe('0xba087652');
    expect(selector(POOL_SIGNATURES.withdraw)).toBe('0xb460af94');
    expect(MIN_DEPOSIT).toBe(10n * D18);
  });
});
