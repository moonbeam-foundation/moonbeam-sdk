# Test fixtures

Captured event logs used to exercise the decoder and the job state machine
without touching the network.

Between them these eight files cover **all 19 event types the decoder
recognises**, and `onboarding.test.ts` fails if that ever stops being true — a
type with no fixture is a decoding path nothing has ever run.

## Why fixtures at all

Every synthetic fixture reflects what its author expected the chain to look
like. That is exactly the assumption a decoder needs tested, so wherever an
event actually occurs on a live network, the fixture is a real capture rather
than something hand-written. Three defects were found this way that no
hand-authored fixture would have surfaced: two unrecognised event types
(`Refunded`, `PaymentReleased`) in production traffic, and jobs carrying a
literal zero value where the worked examples assumed hundreds.

## Real captures — Virtuals ACP, Base mainnet

Taken from the live agent-commerce ledger at
`0x238E541BfefD82238730D00a2208E5497F1832E0` (chain 8453), August 2026. Each
file is one job's **complete** history, so folding it produces a settled
outcome rather than a fragment.

| File | Job | Logs | Settles as | Covers |
|---|---|---|---|---|
| `base-job.json` | 74926 | 6 | `doneRight` | jobCreated, budgetSet, jobFunded, jobSubmitted, jobCompleted, paymentReleased |
| `base-job-evaluator-fee.json` | 74931 | 7 | `doneRight` | above, plus **evaluatorFeePaid** |
| `base-job-expired.json` | 74899 | 3 | `notDelivered` | jobCreated, jobFunded, **jobExpired** |
| `base-job-refunded.json` | 74894 | 6 | `notDelivered` | …, **jobRefunded**, jobExpired |
| `base-job-rejected.json` | 74891 | 6 | `rejected` | …, **jobRejected**, jobRefunded |

Notes on these:

- **Amounts are genuinely zero.** Much live agent traffic is agents exercising
  the rails rather than buying anything, and `base-job.json` asserts it — the
  adapter declines to insure a job worth nothing, and that behaviour needs a
  real example behind it.
- **`evaluatorFeePaid` is rare** — 122 of 8,718 logs in one nine-day window, so
  about 1.4%. It needed a targeted search to capture, which is precisely why a
  short sweep can report full coverage while never having seen it.
- **`jobRejected` was never observed at all** for several days of sweeping
  before it appeared. Live agent work fails by silence far more often than by
  rejection.

## Synthetic — Moonbeam ACP

The assurance-side contracts (`AcpTaskSpace`, `AcpEscrow`, `TaifoonEvaluator`)
are not deployed to any mainnet, so their events **cannot** be captured. These
are hand-built from the contract signatures, which is stated plainly here
because a synthetic fixture proves the decoder handles a shape, not that the
shape occurs.

| File | Logs | Settles as | Covers |
|---|---|---|---|
| `moonbeam-task-adjudicated.json` | 6 | `cheated` | taskOpened, locked, deliverablePosted, **disputed**, **adjudicated**, **taskClosed** |
| `moonbeam-task-released.json` | 4 | `doneRight` | taskOpened, locked, **released**, **evaluated** |
| `moonbeam-task-refunded.json` | 2 | `notDelivered` | locked, **refunded** |

`moonbeam-task-adjudicated.json` is the one worth reading: it walks a dispute
through to an arbitrator finding for the client, which is the **only** path
that draws on a coverage pool. Every other ending refunds without touching one.

## Shape

Each file is a JSON array of logs in the shape any JSON-RPC returns:

```json
{ "address": "0x…", "topics": ["0x…"], "data": "0x…",
  "blockNumber": "0x…", "transactionHash": "0x…", "logIndex": "0x…" }
```

Only `topics` and `data` are needed to decode; the rest is kept so a capture
can be traced back to the chain.

## Capturing more

`scripts/proof-sweep.mjs` reports any topic0 appearing in live traffic that the
decoder does not recognise, and exits non-zero so it can gate a build. When it
finds one, page the window, group logs by `topics[1]` (the job id), and keep a
job whose history contains both the new event and its `jobCreated` — a fixture
that starts mid-lifecycle folds into a state no real job would ever be in.
