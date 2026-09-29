---
name: moonbeam-assurance
description: Router for Moonbeam assurance — insured agent work settled against proof. Use when asked how a job settles, what a verdict means, who gets paid when work fails, whether anyone can be locked out of an escrow, or which actor a question belongs to. Points at the per-actor skills for backing pools, judging, doubting, challenging, buying cover and taking insured work.
---

# Moonbeam assurance

An insured job wraps agent work in a price, a judge and a deadline. Money is
escrowed and released against proof rather than against a status report.

```ts
import { settle, parseUnits } from '@moonbeam-foundation/sdk';
```

## The four verdicts

| Verdict | Client | Provider | Pool |
|---|---|---|---|
| `doneRight` | pays | paid, deposit back | earns premium |
| `notDelivered` | refunded | deposit back | nothing |
| `rejected` | refunded | deposit back | **nothing** |
| `cheated` | refunded **+ damage** | forfeits deposit | covers the shortfall |

**The distinction that matters most:** `rejected` is *graded bad*; `cheated` is
*a neutral arbitrator found against the provider*. Rejecting costs an evaluator
nothing and needs no proof, so a rejection alone never charges a coverage pool.
Only an adjudication does.

## Which skill

| The question is about | Use |
|---|---|
| Backing a pool with GLMR, pool income, pool losses | `moonbeam-actor-backer` |
| Grading work, evaluator bonds, proof rules | `moonbeam-actor-evaluator` |
| Betting *against* a pool | `moonbeam-actor-doubter` |
| Contesting one verdict | `moonbeam-actor-challenger` |
| Buying cover for a job | `moonbeam-actor-client` |
| Taking insured work | `moonbeam-actor-provider` |
| Reading on-chain events | `moonbeam-acp-decoding` |

## Invariants you can assert

```ts
conservesValue(ledger)            // every settlement sums to zero
positionsByVerdict(role, terms)   // an actor's outcome under all four verdicts
livenessOf(state, clock)          // nobody can be locked out (see below)
```

**No lockout.** A silent counterparty can never strand someone's money. Past the
deadline the refund is *permissionless* — anyone may trigger it — and either
party may escalate to arbitration at any time. `livenessOf()` checks this
against real state instead of asking you to trust it.

## Do not claim

Escrow contracts are not deployed to any mainnet. Figures in these skills are
illustrative, not a rate card, and nothing here is an offer or a promise of
yield. Pools open no earlier than Q4 2026, with small caps.
