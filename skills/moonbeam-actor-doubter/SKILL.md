---
name: moonbeam-actor-doubter
description: Size, price and evaluate a DOUBT position against a Moonbeam coverage pool — the bet that insured work fails. Use when the user wants to bet against a pool or a provider, short coverage, take the other side of a guarantee, size a doubt notional, ask whether doubting is worth the fee, or asks why a doubt payout is capped (the arson rule). Covers doubtQuote, maxDoubtPayout, sizeWithinCap. For the OTHER side of this trade — earning the fee by backing the work — see moonbeam-actor-backer.
---

# Doubting a pool

## What you risk, first

You pay the fee up front, every time, and you lose it whenever the work is
delivered. Doubt is a position that bleeds while nothing goes wrong.

## Pricing a position

```ts
import { doubtQuote, parseUnits } from '@moonbeam-foundation/sdk';
const usdc = (v: string) => parseUnits(v);

doubtQuote(terms, usdc('30'), 34);
// { fee: 0.102, maxPayout: 30, capped: false, breakEvenProbability: 0.0034 }
```

`breakEvenProbability` is the failure rate at which the position is EV-neutral.
Take it only if you believe the real failure rate is higher than the fee implies.

## The cap you must check before sizing

```ts
doubtQuote(terms, usdc('9000'), 34).capped;   // true
sizeWithinCap(terms, usdc('9000'));           // false
maxDoubtPayout(terms);                        // 5040 = deposit + poolCapital
```

**A doubt payout can never exceed the capital already bonded to the job.** Size
above that and you are paying a fee on notional that cannot pay out — the excess
is spent for nothing. Always check `capped` before committing.

## Why the cap exists (the arson rule)

If doubt could pay more than the capital exposed, the profitable move would be
to bet against a job and then cause it to fail. The cap makes causing a failure
always cost more than betting on it can return. The rule protects you too: it is
why the market you are trading in is not simply a sabotage game.

## When you get paid

Only on `cheated` — an arbitrator finding against the provider. Note what this
excludes: a job that is merely **graded bad** settles as `rejected` and pays
doubters nothing. Do not model rejections as wins.

## Do not claim

Doubt positions are not live; coverage auctions open **Q2 2027** at the earliest.
No fee schedule has been published — the 34bps used above is illustrative, not a
rate card. Nothing here is an offer, and this is not trading advice.
