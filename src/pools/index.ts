/**
 * Pools — the GLMR cover pool as a backer sees it: exact to 18 decimals.
 *
 * Every function here is pure and takes what the pool contract reports (total assets, total shares,
 * a backer's shares, free assets) as plain bigints. Nothing reads a chain, nothing rounds in the
 * backer's favour: shares = floor(deposit × S ÷ A) and assets = floor(shares × A ÷ S), the ERC-4626
 * rule, so any fraction below the last decimal stays in the pool. The deposit card's four block
 * reasons, the cap, the minimum and the withdraw preview live here so the page cannot drift from
 * the SDK, and the two calls a wallet signs (approve, deposit / redeem) are built here byte for byte.
 */
import { selector, isAddress, isHex32, utf8 } from '../onboard/index.js';
import type { Address, Hex, UnsignedCall } from '../onboard/index.js';

export const D18 = 10n ** 18n;
export const GLMR_DECIMALS = 18;
export const USDC_DECIMALS = 6;
/** 50,000 GLMR per pool while the pools are new. A rule of this surface, not of the pool contract. */
export const POOL_CAP = 50_000n * D18;
/** The smallest deposit the card accepts. */
export const MIN_DEPOSIT = 10n * D18;
/** The dispute window a withdrawal waits out when the pool holds the exit, in seconds. */
/** The layer's default challenge window (V2 holds cover only until each job ends; the window is recorded, not enforced). */
export const DISPUTE_WINDOW_S = 3600;
/** The premium is a share of each job's price; 100 % of it goes to shares. */
export const PREMIUM_TO_SHARES_BPS = 10_000;

/** Base GLMR: the immutable token the site already knows (18 decimals). */
export const BASE_GLMR = '0xB3846fD356c2149ee8D30b0449088Dc74e265459' as const;
export const BASE_CHAIN_ID = 8453 as const;
export const DEVNET_CHAIN_ID = 36927 as const;

// ── fixed-point strings ───────────────────────────────────────────────────────

/** "1,234.5" → 1234500000000000000000n at 18 decimals. Anything that is not a decimal number is 0n; extra decimals are cut, never rounded. */
export function parseU(str: string, decimals: number = GLMR_DECIMALS): bigint {
  const c = String(str).replace(/,/g, '').trim();
  if (!c || c === '.' || !/^\d*\.?\d*$/.test(c)) return 0n;
  const [w = '', f = ''] = c.split('.');
  return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

const commas = (x: string) => x.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** 1234500000000000000000n → "1,234.500000" with `show` decimals (cut, never rounded). */
export function formatU(v: bigint, decimals: number = GLMR_DECIMALS, show: number = 6): string {
  const neg = v < 0n; if (neg) v = -v;
  const base = 10n ** BigInt(decimals);
  const frac = (v % base).toString().padStart(decimals, '0').slice(0, show);
  return (neg ? '-' : '') + commas((v / base).toString()) + (show > 0 ? '.' + frac : '');
}

/** n ÷ d as a percentage string with `show` decimals; "0.00%" on an empty denominator. */
export function pct(n: bigint, d: bigint, show: number = 2): string {
  if (d === 0n) return '0.' + '0'.repeat(show) + '%';
  return formatU((n * 100n * 10n ** BigInt(show)) / d, show, show) + '%';
}

// ── the ERC-4626 arithmetic ───────────────────────────────────────────────────

export interface PoolState {
  /** the pool's GLMR, from totalAssets() */
  totalAssets: bigint;
  /** shares in issue, from totalSupply() */
  totalShares: bigint;
}

function assertState(p: PoolState): void {
  if (p.totalAssets < 0n || p.totalShares < 0n) throw new RangeError('pool totals must not be negative');
}

/** Shares for a deposit: floor(deposit × S ÷ A); one share per GLMR while the pool is empty. */
export function sharesFor(deposit: bigint, p: PoolState): bigint {
  assertState(p);
  if (deposit < 0n) throw new RangeError('deposit must not be negative');
  if (p.totalShares === 0n || p.totalAssets === 0n) return deposit;
  return (deposit * p.totalShares) / p.totalAssets;
}

/** GLMR for shares: floor(shares × A ÷ S). */
export function assetsFor(shares: bigint, p: PoolState): bigint {
  assertState(p);
  if (shares < 0n) throw new RangeError('shares must not be negative');
  if (p.totalShares === 0n) return 0n;
  return (shares * p.totalAssets) / p.totalShares;
}

/** GLMR per share at 18 decimals: 1.000000 while nothing has been paid in or out. */
export function sharePrice(p: PoolState): bigint {
  assertState(p);
  if (p.totalShares === 0n) return D18;
  return (p.totalAssets * D18) / p.totalShares;
}

/** What still fits under the cap. */
export function roomUnderCap(totalAssets: bigint, cap: bigint = POOL_CAP): bigint {
  return cap > totalAssets ? cap - totalAssets : 0n;
}

/** The premium a backer gets of one job's premium: floor(premium × mine ÷ S). */
export function premiumShare(premium: bigint, myShares: bigint, totalShares: bigint): bigint {
  if (totalShares === 0n) return 0n;
  return (premium * myShares) / totalShares;
}

// ── the deposit card ──────────────────────────────────────────────────────────

export type BlockCode = 'FULL' | 'EMPTY' | 'BELOW_MIN' | 'OVER_BALANCE' | 'OVER_CAP';
export interface Block { code: BlockCode; label: string; danger: boolean }

/** Why the deposit button is blocked, in the design's words, or null when it may go. Checked in the order the card shows them. */
export function depositBlock(a: { amount: bigint; balance: bigint; totalAssets: bigint; cap?: bigint; min?: bigint }): Block | null {
  const cap = a.cap ?? POOL_CAP; const min = a.min ?? MIN_DEPOSIT;
  const room = roomUnderCap(a.totalAssets, cap);
  if (room === 0n) return { code: 'FULL', label: 'This pool is full', danger: false };
  if (a.amount === 0n) return { code: 'EMPTY', label: 'Enter an amount', danger: false };
  if (a.amount < min) return { code: 'BELOW_MIN', label: `Minimum deposit is ${formatU(min, GLMR_DECIMALS, 0)} GLMR`, danger: false };
  if (a.amount > a.balance) return { code: 'OVER_BALANCE', label: 'Not enough GLMR', danger: true };
  if (a.amount > room) return { code: 'OVER_CAP', label: `Only ${formatU(room, GLMR_DECIMALS, 2)} GLMR fits under the cap`, danger: true };
  return null;
}

export interface DepositPreview {
  shares: bigint;
  price: bigint;
  /** the pool after this deposit */
  after: PoolState;
  mineAfter: bigint;
  /** basis points of the pool, before and after */
  shareBefore: bigint;
  shareAfter: bigint;
  valueBefore: bigint;
  valueAfter: bigint;
  block: Block | null;
}

/** The whole card in one fold: exact shares, the share of the pool before and after, and the reason the button is blocked. */
export function depositPreview(a: { amount: bigint; balance: bigint; pool: PoolState; myShares: bigint; cap?: bigint; min?: bigint }): DepositPreview {
  const shares = sharesFor(a.amount, a.pool);
  const after: PoolState = { totalAssets: a.pool.totalAssets + a.amount, totalShares: a.pool.totalShares + shares };
  const mineAfter = a.myShares + shares;
  const bps = (n: bigint, d: bigint) => (d === 0n ? 0n : (n * 10_000n) / d);
  return {
    shares, price: sharePrice(a.pool), after, mineAfter,
    shareBefore: bps(a.myShares, a.pool.totalShares), shareAfter: bps(mineAfter, after.totalShares),
    valueBefore: assetsFor(a.myShares, a.pool), valueAfter: assetsFor(mineAfter, after),
    block: depositBlock({ amount: a.amount, balance: a.balance, totalAssets: a.pool.totalAssets, ...(a.cap !== undefined ? { cap: a.cap } : {}), ...(a.min !== undefined ? { min: a.min } : {}) }),
  };
}

/** The largest deposit the card allows: min(balance, room under the cap). */
export function maxDeposit(balance: bigint, totalAssets: bigint, cap: bigint = POOL_CAP): bigint {
  const room = roomUnderCap(totalAssets, cap);
  return balance < room ? balance : room;
}

// ── the withdraw card ─────────────────────────────────────────────────────────

export const WITHDRAW_STEPS = [25, 50, 75, 100] as const;

export interface WithdrawPreview {
  sharesIn: bigint;
  /** GLMR for those shares at today's value */
  assetsOut: bigint;
  /** what the pool lets out right now: min(assetsOut, free assets, maxWithdraw) */
  availableNow: bigint;
  /** unix seconds when the GLMR arrives: now when nothing holds it, else the end of the window */
  availableAt: number;
  /** the window in seconds still to wait (0 when none) */
  waitS: number;
  /** premiums already earned, paid out now (USDC, 6 decimals) */
  premiumsNow: bigint;
  sharesLeft: bigint;
  /** basis points of the pool, before and after */
  shareBefore: bigint;
  shareAfter: bigint;
  block: Block | null;
}

/**
 * A withdrawal of `percent` of the backer's shares. `holdUntil` is the pool's hold (0 when it has none), `freeAssets` what is not
 * promised to an open job (undefined when the pool does not report it), `maxWithdraw` the pool's own limit for this backer.
 */
export function withdrawPreview(a: { percent: number; myShares: bigint; pool: PoolState; premiumsClaimable?: bigint; now: number; holdUntil?: number; freeAssets?: bigint; maxWithdraw?: bigint; windowS?: number }): WithdrawPreview {
  if (!Number.isFinite(a.percent) || a.percent < 0 || a.percent > 100) throw new RangeError('percent must be 0..100');
  const sharesIn = (a.myShares * BigInt(Math.floor(a.percent))) / 100n;
  const assetsOut = assetsFor(sharesIn, a.pool);
  let availableNow = assetsOut;
  if (a.freeAssets !== undefined && a.freeAssets < availableNow) availableNow = a.freeAssets;
  if (a.maxWithdraw !== undefined && a.maxWithdraw < availableNow) availableNow = a.maxWithdraw;
  const hold = a.holdUntil ?? 0;
  const held = hold > a.now || availableNow < assetsOut;
  const availableAt = hold > a.now ? hold : held ? a.now + (a.windowS ?? DISPUTE_WINDOW_S) : a.now;
  const sharesLeft = a.myShares - sharesIn;
  const afterShares = a.pool.totalShares - sharesIn;
  const bps = (n: bigint, d: bigint) => (d === 0n ? 0n : (n * 10_000n) / d);
  const block: Block | null = a.myShares === 0n ? { code: 'EMPTY', label: 'You have nothing in this pool', danger: false } : sharesIn === 0n ? { code: 'EMPTY', label: 'Pick how much to take out', danger: false } : null;
  return { sharesIn, assetsOut, availableNow, availableAt, waitS: Math.max(0, availableAt - a.now), premiumsNow: a.premiumsClaimable ?? 0n, sharesLeft, shareBefore: bps(a.myShares, a.pool.totalShares), shareAfter: bps(sharesLeft, afterShares), block };
}

// ── the three rules, with live numbers ────────────────────────────────────────

export interface Rule { n: string; title: string; formula: string; body: string }

/** "How your share is worked out": three plain rules using this pool as it stands. `typicalPrice` and `premiumBps` come from the record; null when it has none. */
export function rulesFor(a: { pool: PoolState; myShares: bigint; typicalPriceUsdc: bigint | null; premiumBps: number | null; sellerDepositX: string }): Rule[] {
  const price = sharePrice(a.pool);
  const thousand = 1000n * D18;
  const perJob = a.typicalPriceUsdc !== null && a.premiumBps !== null ? (a.typicalPriceUsdc * BigInt(a.premiumBps)) / 10_000n : null;
  const mine = perJob !== null ? premiumShare(perJob, a.myShares, a.pool.totalShares) : null;
  return [
    { n: '01', title: 'Your deposit becomes shares', formula: 'shares = deposit × S ÷ A', body: `At today’s price of ${formatU(price, 18, 6)} GLMR a share, 1,000 GLMR buys ${formatU(sharesFor(thousand, a.pool), 18, 6)} shares. Any fraction below the last decimal stays in the pool.` },
    { n: '02', title: 'Premiums split by shares', formula: 'you get premium × your shares ÷ S', body: perJob !== null && a.typicalPriceUsdc !== null ? `A typical ${formatU(a.typicalPriceUsdc, 6, 2)} USDC job pays a ${formatU(perJob, 6, 4)} USDC premium. At ${pct(a.myShares, a.pool.totalShares, 2)} of the pool, ${formatU(mine ?? 0n, 6, 6)} USDC of it is yours.` : `No premium rate is priced from this record yet, so nothing in money can be worked out. At ${pct(a.myShares, a.pool.totalShares, 2)} of the pool, that share of every premium is yours.` },
    { n: '03', title: 'Losses split the same way', formula: 'after the agent’s deposit', body: `Only a cheating finding reaches the pool, and only for what the agent’s own ${a.sellerDepositX} deposit doesn’t cover. That shortfall lowers the share price for everyone equally.` },
  ];
}

// ── grader modes ──────────────────────────────────────────────────────────────

export type GraderMode = 'judged' | 'declared';

/** How a pool's jobs are judged, in the design's words. The grader role is an address the hook accepts; Jev is one such grader. */
export const GRADER_MODES: Readonly<Record<GraderMode, { tag: string; title: string; body: string }>> = Object.freeze({
  judged: { tag: 'JEV GRADED', title: 'Graded by Jev', body: 'This agent sells judged work, so every job is graded by Jev over the sealed evidence. The grade decides whether the buyer is refunded from escrow. It can’t reach this pool: the pool only pays on a separate finding that the agent cheated.' },
  declared: { tag: 'RE-RUN CHECK', title: 'Re-run check', body: 'This agent declares the shape of its output up front, so every job is checked by re-running the check. Anyone can re-run it and get the same answer. Jev grades only the jobs whose check can’t decide.' },
});

export const GRADER_ROLE = 'The grader is a role, not a name: an address or adapter the hook accepts as evaluator. Jev is the calibrated grader this surface integrates; a deterministic check, or another grader, may hold the same seat.';

// ── unsigned calls ────────────────────────────────────────────────────────────

export const POOL_SIGNATURES = Object.freeze({
  approve: 'approve(address,uint256)',
  deposit: 'deposit(uint256,address)',
  redeem: 'redeem(uint256,address,address)',
  withdraw: 'withdraw(uint256,address,address)',
  createPool: 'createPool(address,address,string,string)',
} as const);

/** The pool factories this surface knows: one pool per (seller, asset), permissionless to open. */
export const POOL_FACTORY: Readonly<Record<number, Address>> = Object.freeze({ 8453: '0x91f078D10E3f0D05fEBcEA35f114063c696aef54', 36927: '0x9bea381ab97df2f10216c525d821412d8cae0001' });

/**
 * Chains where the pool calls may be built. GLMR pools are not open, so Base mainnet is deliberately absent: a deposit,
 * a redemption or a new pool can be built on the devnet only. The maths above (shares, previews, rules) works
 * everywhere. Add 8453 here, and to nothing else, on the day pools open.
 */
export const POOLS_OPEN_ON: readonly number[] = Object.freeze([DEVNET_CHAIN_ID]);

export class PoolsNotOpenError extends Error {
  constructor(readonly chainId: number) {
    super(`pools are not open on chain ${chainId}: pool deposits, redemptions and new pools are built on the devnet (${DEVNET_CHAIN_ID}) only`);
    this.name = 'PoolsNotOpenError';
  }
}

function assertPoolsOpen(chainId: number): void {
  if (!POOLS_OPEN_ON.includes(chainId)) throw new PoolsNotOpenError(chainId);
}

const word = (n: bigint) => { if (n < 0n) throw new RangeError('negative word'); return n.toString(16).padStart(64, '0'); };
const addrWord = (a: string) => { if (!isAddress(a)) throw new Error(`not an address: ${a}`); return a.slice(2).toLowerCase().padStart(64, '0'); };
const call = (chainId: number, to: Address, data: string, step: string, effect: string): UnsignedCall => ({ chainId, to, data: data as Hex, value: '0x0', step, signer: 'anyone', effect });

/** The two calls a deposit takes, in order: an exact-amount approve to the pool, then deposit(assets, receiver). Never a standing allowance. */
export function depositCalls(a: { chainId: number; pool: Address; asset: Address; amount: bigint; receiver: Address }): UnsignedCall[] {
  assertPoolsOpen(a.chainId);
  if (a.amount <= 0n) throw new RangeError('amount must be positive');
  return [
    call(a.chainId, a.asset, selector(POOL_SIGNATURES.approve) + addrWord(a.pool) + word(a.amount), 'approve', `Allow the pool to take exactly ${formatU(a.amount, 18, 4)} GLMR. Nothing moves yet.`),
    call(a.chainId, a.pool, selector(POOL_SIGNATURES.deposit) + word(a.amount) + addrWord(a.receiver), 'deposit', `Deposit ${formatU(a.amount, 18, 4)} GLMR; the pool mints your shares at today’s price.`),
  ];
}

/** The one call a withdrawal takes: redeem(shares, receiver, owner). The pool pays today’s value of the shares, up to what nothing holds. */
export function redeemCalls(a: { chainId: number; pool: Address; shares: bigint; owner: Address }): UnsignedCall[] {
  assertPoolsOpen(a.chainId);
  if (a.shares <= 0n) throw new RangeError('shares must be positive');
  return [call(a.chainId, a.pool, selector(POOL_SIGNATURES.redeem) + word(a.shares) + addrWord(a.owner) + addrWord(a.owner), 'redeem', `Redeem ${formatU(a.shares, 18, 4)} shares for GLMR at today’s value.`)];
}

/** ABI-encode a string: its length word, then the bytes padded to 32. */
function stringWords(v: string): string {
  const b = utf8(v); let hex = ''; for (const x of b) hex += x.toString(16).padStart(2, '0');
  return word(BigInt(b.length)) + hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
}

/**
 * The one call that opens a pool: createPool(seller, asset, name, symbol) on the chain's factory. Anyone may
 * send it; it costs gas and moves no money. Refused when the chain has no factory this surface knows.
 */
export function createPoolCalls(a: { chainId: number; seller: Address; asset: Address; name: string; symbol: string }): UnsignedCall[] {
  assertPoolsOpen(a.chainId);
  const factory = POOL_FACTORY[a.chainId];
  if (!factory) throw new Error(`no pool factory known on chain ${a.chainId}`);
  if (!a.name.trim() || !a.symbol.trim()) throw new RangeError('a pool needs a name and a symbol');
  const name = stringWords(a.name), symbol = stringWords(a.symbol);
  const head = addrWord(a.seller) + addrWord(a.asset) + word(128n) + word(BigInt(128 + name.length / 2));
  return [call(a.chainId, factory, selector(POOL_SIGNATURES.createPool) + head + name + symbol, 'createPool', `Open the pool behind ${a.seller} in ${a.symbol}: one pool per seller and asset, refused if one exists. Gas only; nothing is deposited.`)];
}

export { isAddress, isHex32 };
