/**
 * Money is a bigint count of minor units (USDC has 6 decimals, so 1 USDC = 1_000_000n).
 *
 * Floats are not used anywhere in settlement. A settlement that loses a
 * fraction of a unit to rounding is a settlement that does not conserve value,
 * and conservation is the property the whole model rests on.
 */
export type Money = bigint;

/** Decimals of the settlement asset. ACP settles in USDC (6). */
export const USDC_DECIMALS = 6;

/** Basis points: 1 bp = 1/10_000. Coverage fees are quoted in bps. */
export type Bps = number;

export const ZERO: Money = 0n;

/** Parse a decimal string ("1.25") into minor units. Exact — no float path. */
export function parseUnits(value: string, decimals: number = USDC_DECIMALS): Money {
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    throw new RangeError(`not a decimal number: ${value}`);
  }
  const negative = value.startsWith('-');
  const body = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = body.split('.');
  if (fraction.length > decimals) {
    throw new RangeError(`${value} has more than ${decimals} decimal places`);
  }
  const padded = fraction.padEnd(decimals, '0');
  const magnitude = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || '0');
  return negative ? -magnitude : magnitude;
}

/** Format minor units back to a decimal string. Round-trips with parseUnits. */
export function formatUnits(value: Money, decimals: number = USDC_DECIMALS): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = magnitude / base;
  const fraction = (magnitude % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  const body = fraction ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${body}` : body;
}

/**
 * Apply a basis-point rate, rounding DOWN (toward zero).
 *
 * Rounding down is deliberate and always favours the escrow rather than a
 * claimant: a fee computed against a payer rounds in the payer's favour, and a
 * payout computed for a claimant never exceeds the exact entitlement. The
 * alternative — rounding up somewhere — can mint a unit that no one funded.
 */
export function applyBps(amount: Money, bps: Bps): Money {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new RangeError(`bps must be a non-negative integer, got ${bps}`);
  }
  const negative = amount < 0n;
  const magnitude = negative ? -amount : amount;
  const result = (magnitude * BigInt(bps)) / 10_000n;
  return negative ? -result : result;
}

/** Smaller of two amounts — used to cap payouts at what is actually bonded. */
export function min(a: Money, b: Money): Money {
  return a < b ? a : b;
}

/** Never-negative subtraction, for shortfalls. */
export function clampToZero(value: Money): Money {
  return value < 0n ? 0n : value;
}

export function sum(values: readonly Money[]): Money {
  return values.reduce<Money>((total, value) => total + value, 0n);
}
