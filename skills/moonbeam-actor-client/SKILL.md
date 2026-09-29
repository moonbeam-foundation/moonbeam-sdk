---
name: moonbeam-actor-client
description: Buy cover for agent work as the client/buyer — what a premium costs, what is recovered when work fails, and the damage nobody covers. Use when the user is paying an agent for work, asks whether a job can be insured, asks what happens to their money if the agent fails or cheats, asks what a guarantee costs, or asks whether their deadline is safe. Covers quote, coverGap, recoveryFor, deadline status. For the other side of the job — doing the work under cover — see moonbeam-actor-provider; for selling the cover itself see moonbeam-actor-backer.
---

# Buying cover for a job

## What you risk, first

The premium is not returned when cover was not needed — that is the cost of the
guarantee. And cover is bounded: if a failure could cost you more than the
capital bonded to the job, the excess falls on you.

## Check the gap before you rely on cover

```ts
import { coverGap, recoveryFor, parseUnits } from '@moonbeam-foundation/sdk';
const usdc = (v: string) => parseUnits(v);

coverGap(terms);      // damage - (deposit + poolCapital); 0 means fully covered
recoveryFor(terms);   // what you actually receive if cheating is established
```

`coverGap` is the number no escrow shows you before you commit. If it is above
zero, you are self-insuring the difference.

## What each outcome means for you

| Outcome | You get |
|---|---|
| Work delivered | the work; premium spent |
| Nothing arrived | full refund |
| Graded bad | full refund — but no damage cover |
| Arbitrator finds against the provider | refund **plus** damage cover |

Note the third row. A rejection refunds you but does **not** pay for the
consequences of the failure. Damage cover requires an adjudication.

## Can this job be insured at all?

```ts
import { acpAdapter, DEFAULT_ACP_POLICY, isInsurable } from '@moonbeam-foundation/sdk';

isInsurable(job);                              // false → cannot be covered
acpAdapter.toTerms(job, DEFAULT_ACP_POLICY);   // null for the same reason
```

Declined when: unpriced, above the policy cap, past the point where the outcome
is already being decided, missing a signed agreement (nothing to grade against),
or missing a deadline (nothing resolves it if a grader goes silent).

## You cannot be stranded

Past the deadline, the refund is **permissionless** — anyone can trigger it, so
you never need a silent provider's cooperation to get your money back.

```ts
import { recourseFor, livenessOf } from '@moonbeam-foundation/sdk';
recourseFor('client', state, clock).guaranteedExit;  // { id: 'claimRefund', by: 'anyone' }
```

Refunds are *claimable*, not automatic — someone must call it.

## Do not claim

Escrow is not deployed to mainnet, so no job can actually be insured today.
Figures are illustrative, not a rate card, and nothing here is an offer.
