---
name: moonbeam-actor-backer
description: Back a Moonbeam coverage pool with GLMR (not open yet) — pool income, pool losses, exposure across concurrent jobs, break-even failure rate, and whether a published clearing fee is coherent. Use when the user wants to back a pool, underwrite agent work, asks what backing a pool pays or what it risks, asks about pool solvency or correlated failures, or asks whether a coverage fee is priced right. Covers runSeason, breakEvenFailureRate, poolExposure, solventUnder, clearingFeeIsCoherent. For the OTHER side of this trade — betting that a pool loses — see moonbeam-actor-doubter.
---

# Backing a coverage pool

## What you risk, first

Capital you put into a pool stands behind other people's work. When an adjudicator finds a
provider cheated, the provider's deposit is consumed first and **your pool pays
whatever the deposit cannot**. That is the risk, and it is not optional once you
have backed a pool — the exposure *is* the yield. There is no passive tier, because
rewards come from real fees rather than from newly minted tokens.

You are **not** charged when work is merely graded bad. A rejection refunds the
client and returns the deposit; the pool pays nothing.

## What you earn

The premium on every job that completes, plus fees from doubters taking the
other side.

```ts
import { runSeason, breakEvenFailureRate, parseUnits } from '@moonbeam-foundation/sdk';
const usdc = (v: string) => parseUnits(v);

// The deposit here is deliberately below the damage, so the pool is visibly
// exposed. That is the case worth reasoning about as a backer. When a bond is
// sized above the damage the residual is zero and the pool pays nothing, which
// is the intended steady state rather than the one you need to price.
runSeason({
  jobs: 5_000,
  premiumPerJob: usdc('1'),
  failureRate: 0.006,
  damagePerFailure: usdc('70'),
  depositPerJob: usdc('40'),
});
// → premiumEarned 4_970, absorbedByDeposits 1_200, paidByPool 900, net +4_070
```

## The number that decides whether to back a pool at all

```ts
breakEvenFailureRate(usdc('1'), usdc('70'), usdc('40')); // ≈ 0.032
```

Above that failure rate the pool loses money. Compare it against what the market
is charging before committing:

```ts
clearingFeeIsCoherent(34, usdc('1'), usdc('70'), usdc('40')); // false
```

A clearing fee is the market's estimate of the failure rate it is insuring. If
that implies a rate far below your break-even, the cover is underpriced and you
are being paid too little for the risk. **Always run this check.**

## Correlated failure — the question that actually ends pools

`runSeason` averages over a period and assumes failures are independent. They
are not: one bad provider fails many jobs at once.

```ts
poolExposure(terms, 10, usdc('5000'));   // { committed, utilisation, solvent }
solventUnder(usdc('100'), terms, 10);    // false — 10 simultaneous failures break it
```

## House rules

- Exit is slower than claims settle, so you cannot withdraw ahead of a loss you
  already agreed to cover.
- Caps start small and rise only as the pool's record grows.
- Read the pool's own rules before committing.

## Do not claim

Pools are not open. They open no earlier than Q4 2026, once the escrow contracts are
on mainnet — gated, not scheduled.
No APY has been published and none should be quoted. Figures above are
illustrative, not a rate card. Nothing here is an offer or a promise of yield.
