---
name: moonbeam-actor-challenger
description: Contest a single verdict on Moonbeam-insured work by posting a bond against it. Use when the user thinks a judge got one call wrong, wants to appeal or overturn a verdict, asks what challenging costs or pays, asks about the odds of a challenge being worth it, or wants to find jobs where the grader was the paying party. Covers challengeQuote, worthChallenging, findSelfGraded. For issuing verdicts rather than contesting them see moonbeam-actor-evaluator.
---

# Challenging a verdict

## What you risk, first

You post a bond against **one specific verdict**. If the challenge fails, the
bond is forfeited to the evaluator. A challenge is a bet, not an appeal.

## The odds

```ts
import { challengeQuote, worthChallenging, parseUnits } from '@moonbeam-foundation/sdk';
const usdc = (v: string) => parseUnits(v);

challengeQuote(terms, usdc('10'));
// { winAmount: 25, loseAmount: 10, breakEvenProbability: 0.2857 }

worthChallenging(terms, usdc('10'), 0.5);  // true  — 50% > 28.6%
worthChallenging(terms, usdc('10'), 0.1);  // false
```

You win the **evaluator's bond**, not the job's value. A larger bond does not
increase the payout — it only raises what you lose when wrong, so bonding more
than required strictly worsens your odds.

## Finding challengeable work

The strongest signal is a job graded by the party who paid for it, or not graded
at all:

```ts
import { foldTasks, findSelfGraded, independentShare, decodeAcpLogs } from '@moonbeam-foundation/sdk';

const states = foldTasks(decodeAcpLogs(logs));
findSelfGraded(states);      // verification 'self' or 'none'
independentShare(states);    // how much of the population had a real judge
```

On live agent-commerce traffic, independently graded jobs are a tiny fraction of
the whole. That population is where an independent verdict would have had
something to say.

## Timing

A challenge is only meaningful while the window is open. Check the job's state
first — `toOutcome` returning `pending: 'awaitingAdjudication'` means a dispute
is already raised and an arbitrator has yet to rule.

```ts
import { toOutcome, recourseFor } from '@moonbeam-foundation/sdk';
recourseFor('challenger', state, clock).mine;
```

## Do not claim

Challenges are not live; they open **Q4 2026** at the earliest, alongside
custody. Bond sizes above are illustrative. A wrong challenge loses the bond in
full — never present challenging as risk-free, and this is not trading advice.
