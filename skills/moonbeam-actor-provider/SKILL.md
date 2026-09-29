---
name: moonbeam-actor-provider
description: Take insured agent work as the provider/seller — the deposit required, what a rejection costs versus an adjudicated finding, and how to avoid being stranded by a silent buyer. Use when the user is doing paid agent work, asks what bond is needed to accept an insured job, asks what happens if the buyer never releases payment or the evaluator rejects, or asks whether they can afford to take a job. Covers capitalRequired, canAccept, positionsByVerdict, recourseFor. For buying the cover rather than working under it see moonbeam-actor-client.
---

# Taking insured work

## What you risk, first

You post a deposit to take insured work at all, and it is the **first** capital
consumed if an arbitrator finds you cheated. Your own money is what makes your
promise worth anything.

## Can you afford this job?

```ts
import { capitalRequired, canAccept, parseUnits } from '@moonbeam-foundation/sdk';
const usdc = (v: string) => parseUnits(v);

capitalRequired(terms);              // exactly the deposit
canAccept(terms, freeCapital);       // { ok: false, reason: '...' } when it does not fit
```

`canAccept` returns a reason rather than a bare false, so a refusal can be
reported rather than guessed at.

## What each outcome costs you

```ts
positionsByVerdict('provider', terms);
// { doneRight: +100, notDelivered: 0, rejected: 0, cheated: -40 }
```

The important row is `rejected: 0`. Being **graded bad costs you nothing beyond
the job** — your deposit comes back. You only forfeit it when a neutral
arbitrator finds against you. Do not treat a rejection as a slashing event.

## A silent buyer cannot strand you

Only the buyer can call release, so a buyer who simply stops responding could
otherwise sit on delivered work forever. Your escape is to escalate:

```ts
import { recourseFor, waitingOn } from '@moonbeam-foundation/sdk';

waitingOn(state, clock);                     // who is holding this up
recourseFor('provider', state, clock).mine;  // includes { id: 'dispute' }
```

Either party may raise a dispute, which freezes the escrow and forces an
arbitrator to decide. You never have to wait indefinitely on someone else's
cooperation.

## Getting paid

Payment releases against **proof of the work**, not a status report. An
evaluator cannot approve without a proof that verifies — which cuts both ways:
it is a bar to clear, and it is also why an approval cannot later be waved away.

## Do not claim

Escrow is not deployed to mainnet; no insured work can be taken today. Deposit
ratios are illustrative policy defaults, not fixed protocol parameters.
