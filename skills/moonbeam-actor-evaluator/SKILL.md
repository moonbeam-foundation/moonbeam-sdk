---
name: moonbeam-actor-evaluator
description: Act as a judge/evaluator on Moonbeam-insured agent work — when a proof is required, what a bond risks, and how a verdict can be overturned. Use when the user is grading agent work, running an evaluator, asking whether approving needs proof, asking what happens if a judge is wrong or goes silent, or asking why a rejection does not pay damage cover. Covers proofRequiredFor, bondAtRisk, toOutcome. For contesting someone else's verdict see moonbeam-actor-challenger.
---

# Judging agent work

## What you risk, first

You post a bond to issue verdicts at all. If your call is overturned on
challenge, **the bond pays the challenger**. Going silent is not an escape:
the deadline resolves the job without you, and no work waits on a silent grader.

## The one rule that must never be inverted

**Refusing to pay is safe. Paying requires proof.**

```ts
import { proofRequiredFor } from '@moonbeam-foundation/sdk';
proofRequiredFor('approve'); // true  — releasing someone else's money needs proof
proofRequiredFor('reject');  // false — refusal costs no one anything
```

Approving releases funds that are not yours, so it must be backed by a proof
that verifies. Rejecting only withholds, so it never needs one. If a proof fails
to verify, the approval must fail too — an unproven deliverable can never
auto-complete.

**Absence of proof is not evidence of absence.** If the proof service is
unreachable, that is *unknown*, not *no proof exists* — and unknown must never
authorise payment.

## Your rejection does not charge the pool

A rejection settles as `rejected`: the client is refunded, the provider's
deposit is returned, and the coverage pool pays **nothing**. That is deliberate.
Because rejecting is free and unproven, letting it trigger damage cover would
make pools underwrite ordinary quality disputes rather than dishonesty.

Damage cover pays only on `cheated`, which comes from an arbitrator — a neutral
party — finding against the provider. You cannot produce that verdict alone.

Your calls are contestable: anyone may bond against one of them, and an
overturned call pays them from your bond. See `moonbeam-actor-challenger` for
that side.

## Reading where a job stands

```ts
import { foldTask, toOutcome, decodeAcpLogs, localClock } from '@moonbeam-foundation/sdk';

const state = foldTask(decodeAcpLogs(logs));
toOutcome(state, localClock(now));
// { verdict: 'rejected', basis: 'evaluatorRejected' }
// or { verdict: null, pending: 'awaitingAdjudication' }
```

`toOutcome` returns `verdict: null` whenever the chain has not actually settled
the question — a raised dispute, or a close marked "adjudicated" without a named
winner. Never treat a pending outcome as a verdict.

## Do not claim

Evaluator contracts are live on **test networks only**; nothing is deployed to
mainnet. A proof-checking evaluator *narrows* what must be trusted; it does not
remove trust, so never describe one as requiring no trust at all. Figures are
illustrative.
