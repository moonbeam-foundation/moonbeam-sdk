---
name: moonbeam-acp-decoding
description: Decode on-chain agent-commerce event logs into typed job state and a settlement verdict. Use when reading agent-job logs from Base, asking what a job's outcome was, mapping a close reason to a verdict, correlating a dispute with its adjudication, measuring how many jobs had an independent grader, or wiring an RPC log stream into settlement. Covers decodeAcpLog, foldTask, toOutcome, attributeDispute, independentShare.
---

# Decoding agent-commerce traffic

```ts
import { decodeAcpLogs, foldTask, toOutcome, localClock } from '@moonbeam-foundation/sdk';

const state = foldTask(decodeAcpLogs(logs));   // logs for ONE job
const outcome = toOutcome(state, localClock(now));
```

`decodeAcpLog` returns `null` for anything unrecognised and never throws — most
logs in a block are not agent-commerce events, so "not mine" is the ordinary
answer. Decoding is keyed on topic0 and is address-agnostic, so it survives
redeployment.

## Three traps

**1. A close reason of "adjudicated" is not a verdict.** It says an arbitrator
decided, not *for whom*. You must find the paired `adjudicated` event carrying
the winner. `toOutcome` returns `{ verdict: null, pending:
'adjudicationWinnerUnknown' }` rather than guessing.

**2. `Disputed` is ambiguous by construction.** Two different contracts declare
an identical `Disputed(bytes32,address)`, so they share a topic0 and cannot be
told apart from the log alone. The decoder reports `source: 'ambiguous'`.
Narrow it only with a known emitting address:

```ts
attributeDispute(log, { taskSpace, escrow });  // 'taskSpace' | 'escrow' | 'ambiguous'
```

**3. A release is weaker than a verdict.** Release is called by the *buyer*, not
a judge (`basis: 'requesterReleased'`). It means the buyer declared satisfaction
— enough that no cover is owed, but it is not an adjudicated finding. Do not
describe it as one.

## Verdicts, and when there is none

| Fact | Result |
|---|---|
| approved / completed | `doneRight` |
| rejected | `rejected` — refund, no damage cover |
| expired / refunded on timeout | `notDelivered` |
| adjudicated for the provider | `doneRight` |
| adjudicated for the client | `cheated` — the only verdict cover pays on |
| dispute open | `null`, `pending: 'awaitingAdjudication'` |
| deadline passed, nothing claimed | `null`, `pending: 'refundClaimable'` |

Refunds are **claimable, not automatic** — someone must call for them, so money
sits locked until they do.

## Measuring independent grading

```ts
import { foldTasks, independentShare, findSelfGraded } from '@moonbeam-foundation/sdk';

const states = foldTasks(decodeAcpLogs(logs));
independentShare(states);   // fraction graded by a genuine third party
findSelfGraded(states);     // graded by the payer, or ungraded entirely
```

`verification` is `'none'` (no grader), `'self'` (the payer graded its own job),
or `'independent'`. On live traffic the independent share is very small — which
is the gap an assurance layer exists to fill.

## Order does not matter

`foldTask` is order-insensitive: statuses only advance, so a late-arriving early
event cannot rewind the state. Pass events for **one job only** — use
`groupByJob` or `foldTasks` to split a mixed stream.

## Do not claim

The assurance-side contracts are not deployed to mainnet. Decoding being
address-agnostic means it will work once addresses are published — that is a
property of the decoder, not evidence of deployment.
