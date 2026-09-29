# @moonbeam-foundation/sdk

**Assurance for AI agent work: a price, a judge and a deadline, settled against proof.**

- **What:** the SDK for Moonbeam's assurance layer on Base. It models a covered job end to end: the seller's deposit,
  the buyer's premium, cover from a pool, the verdict, and a settlement in which every ledger sums to zero.
- **Why:** agent escrow refunds the price of a failed job, never the cost of the failure, and the judge has no capital
  behind its verdict. Moonbeam adds the deposit, the pool and a grader (Jev by TypeSafe).
- **How:** `npm install @moonbeam-foundation/sdk`, then replay Moonbeam's first covered hire on Base, offline, in a few seconds:

```bash
npx moonbeam demo
```

![moonbeam demo: a covered hire on Base, Jev's grade of that same job checked against its Base record, and the settlement](docs/demo.gif)

Moonbeam ACP is in a pilot on Base with selected partners. For early access, write to
[builders@moonbeam.foundation](mailto:builders@moonbeam.foundation).

## Install

```bash
npm install @moonbeam-foundation/sdk
npx moonbeam demo
```

Node 20 or later.

## What problem this solves

Agent-to-agent protocols already hold payment in escrow and release it when an
evaluator approves. If the provider misses the deadline, escrow refunds the
buyer. That covers the *price of the job*.

It does not cover the *cost of the failure* — the campaign that missed its slot,
the fill that never happened — and it leaves the evaluator with no capital
behind its verdict. This SDK models the layer that closes both gaps.

## Quick start

```ts
import { settle, parseUnits } from '@moonbeam-foundation/sdk';

const units = (v: string) => parseUnits(v); // amounts in the token's smallest units

const { ledger, locked } = settle({
  terms: {
    pay: units('100'),           // what the client pays for the work
    premium: units('1'),         // what it pays for cover
    deposit: units('120'),       // the provider's bond, sized above the job
    evaluatorBond: units('25'),  // the judge's bond
    poolCapital: units('5000'),  // backers standing behind the provider
    damage: units('70'),         // consequential loss if the work is bad
  },
  verdict: 'cheated',
});

locked;           // 221_000000n — pay + premium + deposit, derived not typed
ledger.client;    //  +70_000000n — refunded AND compensated
ledger.provider;  //  -70_000000n — pays the damage out of its own bond
ledger.pool;      //           0n — the bond covered it; the pool is the tail
```

Positive is received, negative is paid, and every settlement sums to zero.

The deposit is sized above the job on purpose. Cheating has to cost the
provider more than the job pays, or the arithmetic argues for cheating; and
because the bond is first loss, the pool pays only the residual a bond cannot
cover. Drop the deposit to `40` here and the pool pays `30` on this single
job, which is the shape a flat premium cannot fund at realistic failure rates.

## Examples

Nineteen runnable files in [`examples/`](examples), all offline except two, built on real Base jobs. `npm test` runs them.

| Start with | If you are |
|---|---|
| [`03-end-to-end-offline`](examples/03-end-to-end-offline.mjs) | new here: one real job read from Base, graded, settled |
| [`20`–`23` onboarding](examples/README.md#before-you-take-part) | about to pay, work, judge or back: what you put up, what you can lose, what should stop you |
| [`10`–`17` the grader](examples/README.md#the-grader-stage-by-stage) | judging jobs: evidence → facts → answers → verdict → record → end the job → verify, then live |
| [`30`–`33` reading jobs](examples/README.md#reading-jobs-that-already-ran) | studying jobs that already ran, one or many, offline or from a Base RPC |

```sh
node examples/03-end-to-end-offline.mjs
# 1 read     the chain says: doneRight (judged by: self)
# 2 grade    an independent grader says: complete · re-verifies: true
# 3 settle   client -101 · provider +100 · pool +1 · sums to zero
```

## The four outcomes

| Verdict | What happens |
|---|---|
| `doneRight` | Provider is paid and gets its deposit back; the pool keeps the premium. |
| `notDelivered` | Nothing arrived. Everything unwinds, nobody punished. |
| `rejected` | Work arrived and was graded bad. Refund and deposit returned — **no damage cover**. |
| `cheated` | Client is made whole *beyond* a refund — from the provider's deposit first, then the pool. |

The last two rows carry the design's most important distinction. Refusing to pay
costs an evaluator nothing and requires no proof, so rejections are ordinary
events rather than evidence of fraud. If every rejection paid damage cover, a
pool would be underwriting quality disputes and its losses would track the
rejection rate rather than the fraud rate. So `cheated` — the only verdict that
draws on the deposit and the pool — is reserved for an adjudication by a neutral
party.

That is what makes **cheating pay the victim**: being cheated is the client's
best financial outcome after the fact, and every unit paid out comes from someone
who did wrong or who sold cover, never from an uninvolved party.

## Reading the chain

Decode agent-commerce logs into typed events, fold them into job state, and ask
what actually settled:

```ts
import { decodeAcpLogs, foldTask, toOutcome, localClock } from '@moonbeam-foundation/sdk';

const state = foldTask(decodeAcpLogs(logs));       // one job's logs
const outcome = toOutcome(state, localClock(now));
// { verdict: 'cheated', basis: 'adjudicatedForClient' }
// or { verdict: null, pending: 'awaitingAdjudication' }
```

`toOutcome` returns no verdict whenever the chain has not settled the question —
a raised dispute, or a close marked "adjudicated" with no named winner. It
refuses to guess, because a verdict moves money.

Decoding is keyed on topic0 and address-agnostic, so it survives redeployment.
Every pinned constant is re-derived from its signature in the test suite, so a
typo cannot silently fail to match live traffic. One event is genuinely
ambiguous — two contracts declare an identical `Disputed` signature — and the
decoder reports `source: 'ambiguous'` rather than guessing.

## Nobody can be locked out

A job holds other people's money, so no party may strand another by going quiet:

```ts
import { livenessOf, recourseFor, waitingOn } from '@moonbeam-foundation/sdk';

livenessOf(state, clock);                    // { noLockout: true, stranded: [] }
recourseFor('provider', state, clock);       // what I can do, and my guaranteed exit
waitingOn(state, clock);                     // who is holding this up
```

- A silent **provider** cannot strand the client: past the deadline the refund is
  permissionless — anyone may trigger it.
- A silent **client** cannot strand the provider: release is the client's alone,
  but the provider can escalate to arbitration.
- A silent **evaluator** cannot strand either: the deadline resolves the job.

These are checked against real state rather than asserted in prose.

## Time carries its provenance

Deadlines decide money, so a `Clock` always records where "now" came from —
`local`, `chain`, or `attested` (a signed finality attestation). A proof-checking
setup narrows what must be trusted; it does not remove trust, so the SDK never
describes an attested clock as requiring none.

```ts
import { createAttestationSource, clockFromAttestation } from '@moonbeam-foundation/sdk';
import { recoverMessageAddress } from 'viem';

const source = createAttestationSource({ baseUrl: 'https://…' });
const attestation = await source.latest(8453);

// The `signer` field is SELF-REPORTED. Recover it yourself or it proves nothing.
const ecrecover = (digest: string, signature: string) =>
  recoverMessageAddress({ message: { raw: digest as `0x${string}` }, signature: signature as `0x${string}` });

if (attestation.ok) {
  const clock = await clockFromAttestation(attestation.value, ecrecover);
  // Refused outright if the signature does not check out — never downgraded silently.
}
```

Note the recovery scheme: attestations are signed as EIP-191 personal messages
over the digest, not as a raw hash. Recovery always returns *some* address, so
the wrong scheme yields a plausible-looking address that simply never matches.
Verify against a known-good attestation once before relying on it.

## Network answers that are not answers

Connectors return a `Result` rather than throwing, to keep one distinction the
SDK considers load-bearing:

```ts
if (!result.ok && meansAbsent(result.error)) {
  // The source definitively has nothing for this. A fact you can act on.
} else if (!result.ok) {
  // Unavailable, network failure, malformed: you do not know. Not the same thing.
}
```

A 404 is honest — the service has no data for that chain. A 500 is an outage.
Collapsing the two would let a server fault read as "no proof exists", and under
the rule above, absence of proof must never authorise a payment.

The log reader carries the same instinct: some providers answer a valid query
with an empty set instead of an error, which is indistinguishable from a quiet
range, so `fetchLogRange` reports emptiness as `noData` unless you explicitly
vouch for your source. It also pages wide ranges automatically, because
providers that reject them leave holes in history that later reads never revisit.

## Building transactions

The SDK builds calls; it never signs or sends them, and never holds a key.

```ts
import { createAssuranceClient, asProofBlob } from '@moonbeam-foundation/sdk';

const client = createAssuranceClient({ chainId: 84532, escrow, evaluator });

client.escrow.claimRefund({ taskId });               // callable by anyone after the deadline
client.evaluator.approve({ jobId, proof: asProofBlob(blob) });  // proof required by the type
client.evaluator.reject({ jobId, reason });          // no proof — refusing is always safe
```

`asProofBlob` rejects an empty blob, so the approval path cannot be called
without one. The asymmetry lives in the signatures rather than in a comment.

Constructing a client for a chain the contracts are not deployed on throws
immediately, rather than producing a transaction addressed to nothing.

## Judging a job on the Base hook

`@moonbeam-foundation/sdk/judge` grades a GLMR job on Moonbeam's assurance hook on Base
(`0xc0578657Eda85e0a246771aa1839ce79b54eE80d`) and builds the call that ends it. The grade works like this:

- Code checks the facts first. A failed check rejects the job, and the model is never asked.
- Jev, TypeSafe's calibrated decision model, answers four closed questions from the published RUBRIC_v1. Every answer
  comes back as a full probability distribution.
- Code composes complete, reject or needs_review under fixed thresholds, and returns a receipt that hashes all of it.

```ts
import { gradeJob, jobFacts, recordGrade, endJob, verifyGrade } from '@moonbeam-foundation/sdk/judge';

const receipt = await gradeJob({
  jobId,                                               // the hook's 32-byte job id
  evidence: { task, delivered },
  facts: jobFacts({ delivered: true, checks: { proof_verifies: () => checkProof(delivered) } }),
  trial: true,                                         // 3 free calls; or key: <your TypeSafe key>
});
const onchain = await recordGrade(receipt, { network: 'devnet' });  // none | devnet | base | both — unsigned calls
const end = endJob(jobId, receipt);                    // complete(jobId) | reject(jobId, digest) | null (needs_review)
const check = await verifyGrade(receipt, { chain: false });
```

`endJob` is signed by the job's buyer or by an evaluator the hook registered. For needs_review it returns `null`: the
job stays held until one of those parties decides, or until anyone calls `expire` after the deadline. The tests
re-encode the hook's `complete` from the covered GLMR hire on Base,
[`0xc606d00f…3116`](https://basescan.org/tx/0xc606d00fed64e912585bbc93feb15a9289cfcde94289f49f7c74a7a468903116),
byte for byte.

## Skills for AI agents

The package ships one skill per actor under `skills/`, so an agent acting as a
backer gets the backer's reasoning and not the doubter's:

`moonbeam-assurance` (router) · `moonbeam-acp-decoding` · and
`moonbeam-actor-{client,provider,evaluator,backer,doubter,challenger}`

Each states what its actor **risks** before what it earns, keeps to runnable
calls rather than prose economics, and ends with the deployment boundary. Those
rules are enforced by tests, not convention.

## Hooking up a host protocol

The `acp` adapter translates an [Agent Commerce
Protocol](https://whitepaper.virtuals.io/) job into insurable terms:

```ts
import { acpAdapter, settle, DEFAULT_ACP_POLICY } from '@moonbeam-foundation/sdk';

const terms = acpAdapter.toTerms(job, DEFAULT_ACP_POLICY);
if (!terms) return; // not insurable — see below

const verdict = acpAdapter.toVerdict({ approved: false, score: 0.2 });
const { ledger } = settle({ terms, verdict });
```

A job is **not insurable** when it is unpriced, above the policy cap, past the
`transaction` phase (the outcome is already being decided), missing a signed
Proof of Agreement (nothing to grade against), or missing a deadline (nothing
resolves it if the evaluator goes silent). `toTerms` returns `null` rather than
throwing, because "not insured" is the ordinary case, not an error.

SLA expiry maps to `notDelivered`, never to `cheated` — the host protocol
already refunds, and nobody should be punished for a job that simply expired.

### Writing another adapter

Implement `AssuranceAdapter<HostJob, HostOutcome>`: say what a job costs and what
its outcome means. Adapters translate; they never settle.

The interface is deliberately narrow because it currently has **one**
implementation. One adapter is a hypothetical seam, two is a real one — so it is
better to keep this small until a second protocol shows what actually needs to
be shared.

## Who must take part, and who may

```ts
import { ACTORS, actorsBy } from '@moonbeam-foundation/sdk';

actorsBy('obligatory'); // provider, evaluator
actorsBy('optional');   // client, pool, doubter, challenger
```

Only the two roles the system takes at their word must post capital: the
provider doing the work and the evaluator grading it. Everyone else opts in.

Worth being precise about backing a pool: choosing to back one is optional, but once
in, underwriting is not a separate opt-in — **the exposure is the yield**.
There is no passive tier, because rewards come from real fees rather than
inflation.

## Pool economics

```ts
import { runSeason, breakEvenFailureRate, clearingFeeIsCoherent } from '@moonbeam-foundation/sdk';

// An undersized bond, to show the pool actually paying. A deposit at or above
// the damage leaves the pool at zero, which is the intended steady state.
runSeason({
  jobs: 5_000,
  premiumPerJob: units('1'),
  failureRate: 0.006,
  damagePerFailure: units('70'),
  depositPerJob: units('40'),
});
// → premium 4_970, absorbed by deposits 1_200, paid by pool 900, net +4_070

breakEvenFailureRate(units('1'), units('70'), units('40')); // ≈ 0.032
clearingFeeIsCoherent(34, units('1'), units('70'), units('40')); // false

// Raise the bond above the damage and the residual disappears:
runSeason({ /* …as above… */ depositPerJob: units('120') });
// → premium 4_970, absorbed by deposits 2_100, paid by pool 0, net +4_970
breakEvenFailureRate(units('1'), units('70'), units('120')); // null — no rate breaks it
```

That last call is the useful one. A published clearing fee is a claim about the
failure rate the market expects; a pool's break-even is the rate it can actually
survive. If those disagree by an order of magnitude, the two numbers were
written against different assumptions — which is exactly the kind of drift that
survives review when the economics live in prose.

## Design notes

**Money is `bigint` minor units.** No floats anywhere in settlement. Basis-point
maths rounds *down*, so no unit is ever minted that nobody funded.

**The core is pure.** `settle()` takes terms and a verdict and returns a ledger.
No clock, no chain, no I/O. That is what makes the economics testable:
conservation of value, the arson cap, and "cheating pays the victim" are
assertions over a return value rather than claims in a document.

**The arson rule.** Doubt payouts are capped at capital already bonded
(`deposit + poolCapital`), so causing a failure always costs more than betting
on it can pay.

## Development

```bash
npm install
npm test           # 56 tests
npm run typecheck  # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
npm run build      # ESM + .d.ts to dist/
npm run test:coverage
```

## License

Apache-2.0
