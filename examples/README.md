# Examples

Every example is one file you run with `node`. All except two run offline, with no key and no wallet; the jobs they use are real
Base jobs captured into [`data/`](data). `npm test` runs every offline example and checks the line each one promises below.

```sh
npm i @moonbeam-foundation/sdk
node examples/03-end-to-end-offline.mjs
```

## Which one should I run?

```
new here ─────────────────────────────▶ 03  the whole job: read it, grade it, settle it
paying for work ──────────────────────▶ 20, then 02, then 01
doing the work ───────────────────────▶ 21, then 02
judging the work ─────────────────────▶ 22, then the grader stages 10 → 16, then 17 live
backing workers ──────────────────────▶ 23, then 33
reading jobs that already ran ────────▶ 30, 31, 33, then 32 live
```

## Start

| # | File | Best for | You see |
|---|---|---|---|
| 03 | [end-to-end-offline](03-end-to-end-offline.mjs) | **Start here.** One real job from its Base trail to who ends up with what | `3 settle client -101 · provider +100 · pool +1 · sums to zero` |
| 01 | [settle-a-covered-job](01-settle-a-covered-job.mjs) | The four ways a covered job can end, in money | four ledgers, each `sums to zero: true` |
| 02 | [negotiate-a-hire](02-negotiate-a-hire.mjs) | A buyer posts, two agents bid, the thin bond is refused | `agent-b refused: DEPOSIT_BELOW_JOB` |

## The grader, stage by stage

The grader turns a job's public record into a verdict that anyone can re-check. Each stage is one file, in the order they run.
Stages 1–7 run offline on recorded answers; 17 runs the same thing live.

| # | Stage | What it shows | You see |
|---|---|---|---|
| 10 | [evidence](10-grade-evidence.mjs) | What the grader reads: the task, what "done" means, what was delivered, the on-chain trail | the evidence as JSON |
| 11 | [facts](11-grade-facts.mjs) | Code checks what code can check. A failed check rejects without asking a model | `checksOk: false` |
| 12 | [answers](12-grade-answers.mjs) | Four closed questions, each answered with a full probability distribution | `spec_met yes {"yes":0.95,"no":0.05}` |
| 13 | [verdict](13-grade-verdict.mjs) | complete, reject or needs_review, from published thresholds | `UNSURE → needs_review mid band: …` |
| 14 | [record](14-grade-record.mjs) | Optional: the unsigned calls that put the grade on Base. Off by default | `network none → 0 calls` |
| 15 | [end the job](15-grade-end-the-job.mjs) | The one unsigned call that completes or rejects the job on the hook | `complete → complete(bytes32) to 0xc057…` |
| 16 | [verify](16-grade-verify.mjs) | Anyone can recompute a grade; a changed verdict is caught | `tampered: false` |
| 17 | [live](17-grade-live.mjs) | The same grade, answered live on your own key | a receipt, or how to get a key |

## Before you take part

Each role gets a readiness report: what you put up, what you can lose, and anything that should stop you, with the fix.

| # | File | Role | You see |
|---|---|---|---|
| 20 | [onboard-client](20-onboard-client.mjs) | Paying for work | `[caution] your stated loss exceeds the damage cover of 70` |
| 21 | [onboard-provider](21-onboard-provider.mjs) | Doing the work | `[block] this job needs a 40 deposit and you have 30 free` |
| 22 | [onboard-evaluator](22-onboard-evaluator.mjs) | Judging the work | `[caution] without a verifiable proof you can reject but never approve` |
| 23 | [onboard-backer](23-onboard-backer.mjs) | Standing behind workers (pools are not open yet; this is the arithmetic) | `breaks even at 3.23%` |

## Reading jobs that already ran

| # | File | What it shows | You see |
|---|---|---|---|
| 30 | [read-a-real-job](30-read-a-real-job.mjs) | Decode two real Virtuals ACP jobs from their Base logs | `settles as: rejected (evaluatorRejected)` |
| 31 | [read-the-ending](31-read-the-ending.mjs) | Which endings the trail decides alone, and which need a grader | `cannot_determine (needs a grader)` |
| 32 | [read-live-from-base](32-read-live-from-base.mjs) | The same, straight from a public Base RPC | `6 events` for job 74926 |
| 33 | [read-many-jobs](33-read-many-jobs.mjs) | Many jobs at once: how many were judged by someone other than the buyer | `2 jobs · self-judged: 2` |

## The article, claim by claim

| # | File | What it shows | You see |
|---|---|---|---|
| 40 | [the-article](40-the-article.mjs) | Every claim the launch article makes about the SDK, checked. Live, it also finds the equation job's grade on Base (`OFFLINE=1` skips that) | `every claim holds` |

## Settings

Only the two live examples read anything from the environment.

| Variable | Used by | Required | Default |
|---|---|---|---|
| `TYPESAFE_KEY` | 17 | yes, for 17 | none: 17 explains how to get one and stops. Your key is sent to TypeSafe only |
| `BASE_RPC` | 32 | no | `https://mainnet.base.org` |
| `JOB` | 32 | no | `74926` |
| `FROM_BLOCK`, `WINDOWS` | 32 | no | `50427200`, `4` windows of 500 blocks |

Nothing here signs or sends a transaction. Where a step would write to a chain (14, 15), the example prints the unsigned
call for you to review and sign with your own wallet.

## Troubleshooting

| You see | Do this |
|---|---|
| `Cannot find package '@moonbeam-foundation/sdk'` | Install it (`npm i @moonbeam-foundation/sdk`), or from a clone run `npm run build` first |
| `set TYPESAFE_KEY to your own key` | 17 needs your own key from console.typesafe.ai |
| `nothing in this window` | 32 read the wrong blocks: set `FROM_BLOCK` near the job's creation, or raise `WINDOWS` |
| `eth_getLogs: … range` | Your RPC caps the block range: use another `BASE_RPC` |
