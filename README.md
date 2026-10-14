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

Twenty-five runnable files in [`examples/`](examples), built on Base jobs; all run offline except four (17 and 32 read live; 50 and
51 read live, or run from recorded answers with `OFFLINE=1`). `npm test` runs them.

| Start with | If you are |
|---|---|
| [`03-end-to-end-offline`](examples/03-end-to-end-offline.mjs) | new here: one job read from Base, graded, settled |
| [`20`–`23` onboarding](examples/README.md#before-you-take-part) | about to pay, work, judge or back: what you put up, what you can lose, what should stop you |
| [`10`–`17` the grader](examples/README.md#the-grader-stage-by-stage) | judging jobs: evidence → facts → answers → verdict → record → end the job → verify, then live |
| [`30`–`33` reading jobs](examples/README.md#reading-jobs-that-already-ran) | studying jobs that already ran, one or many, offline or from a Base RPC |
| [`50`–`53`](examples/README.md) | paying an x402 wall on Base, reading a proof, arbitration, the records every step comes with |

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

These are checked against the chain's state rather than asserted in prose.

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

The SDK builds calls; it never signs or sends them, and never holds a key. The calls target the assurance hook Moonbeam runs
on Base (`@moonbeam-foundation/sdk/onboard`; the hook, the pool factory and the pools are read from the coordination layer's
address registry, never typed here):

```ts
import { fundCalls, sellerDepositCalls, coverPremium, submitCalls, settleCalls, BASE_GLMR, BASE_USDC, MOONBEAM_HOOK } from '@moonbeam-foundation/sdk/onboard';

// a covered job is a GLMR job: the hook covers in GLMR only (the USDC route closed on 2026-09-29)
const premium = coverPremium(terms.price, { k: 19, n: 20 });          // the seller's record → the premium (jev-wilson)
sellerDepositCalls(terms);                                              // the seller approves exactly its deposit
const [approve, fund] = fundCalls({ ...terms, token: BASE_GLMR }, { pool, premium, coverCap });   // approve price + premium, then fundJobWithCover
const [approveU, fundU] = fundCalls({ ...terms, token: BASE_USDC });                               // an uncovered USDC job: no pool, premium 0
submitCalls({ jobId, evidenceDigest, correlator });                     // the seller seals its delivery
settleCalls(jobId, 'completed');                                         // complete(jobId) · reject(jobId, digest) · expire(jobId)
```

`fundJob`'s last address word is the **cover pool**, not an evaluator: the hook keeps no per-job evaluator (evaluators are the
owner's allowlist). `premium` is an argument the hook checks against the pool. A USDC job with a pool is refused before any call
(the hook would revert `PoolAssetMismatch`). `MOONBEAM_HOOK.status` carries the registry's word on the hook row (`live`, or
`scheduled-change` while a route change is announced). `test/fork/run-fork.mjs` sends these calls on a local fork of Base:
deposit approval, approve, `fundJob` against a live pool, `submit`, `complete`, then the settle's attestation.

Pools open by the council's yes, not by a release: `poolsOpenOn(transport)` (`./pools`) reads `GET /v1/pools/networks` (its
`supported` lines and `closed_by_policy`) through the site's proxy and returns no chain while the GLMR pools are not open; the
typed `POOLS_OPEN_ON` is only the fallback. Pass its `chains` to the pool builders as `openOn`. The judge's quota is read the same way (`quotaOf(transport)`).

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
  key: process.env.TYPESAFE_KEY,                       // your own TypeSafe key
});
const onchain = await recordGrade(receipt);            // unsigned calls on Base; { network: 'none' } turns it off
const end = endJob(jobId, receipt);                    // complete(jobId) | reject(jobId, digest) | null (needs_review)
const check = await verifyGrade(receipt, { chain: false });
```

`endJob` is signed by the job's buyer or by an evaluator the hook registered. For needs_review it returns `null`: the
job stays held until one of those parties decides, or until anyone calls `expire` after the deadline. The tests
re-encode the hook's `complete` from the covered GLMR hire on Base,
[`0xc606d00f…3116`](https://basescan.org/tx/0xc606d00fed64e912585bbc93feb15a9289cfcde94289f49f7c74a7a468903116),
byte for byte.

## Reselling on Base

`@moonbeam-foundation/sdk/resale` is the Moonbeam profile of the coordination layer's one payment scheme, a byte-identical
vendored copy pinned by its sha256 (`src/resale/payment-scheme.pin.json`): what a reseller's visitor pays, where every unit of it
goes, and the reseller's own leg — the same numbers the layer itself charges.

```
price_to_buyer = seller_price + our_fee + venue_fee(in) + venue_fee(out) [+ reseller_markup]
```

```ts
import { quoteBase, legsByName, markupLeg, childKeyTerms, childKeyPlan, subscribePlan, readSale } from '@moonbeam-foundation/sdk/resale';

const q = quoteBase({ venue_in: 'reseller', venue_out: 'erc8183-base', seller_price: 8_000n, reseller: { tenant, markup_bps: 1000 } });
if (q.ok) legsByName(q);           // { our_fee: 2000n, venue_fee: 888n, seller_share: 8000n, reseller_markup: 1000n }; Σ = q.price_to_buyer
childKeyTerms({ '*': 1000 });      // what a child key is, in the layer's words
childKeyPlan({ '*': 1000 });       // POST /tenant/keys { action: 'child', markup_bps } — the reseller sends it with its own key
subscribePlan({ usdc: 1 });        // POST /access/subscribe — the child's top-up door (the x402 quote comes back as a 402)
await readSale(transport, 'rs_…'); // GET /resale/sales/{id} through the site's proxy
```

A reseller is a tenant of the layer; its visitors buy on child keys from the reseller's balance; the markup is the reseller's
own leg, never part of the layer's fee. The venues are the five Base venues (`x402-base`, `erc8183-base`, `memoacp-base`,
`bitagent-base`, `olas-base`): Moonbeam resells on Base only, and the assurance economy stays in GLMR. Solana rails and the other
chains are in the coordination layer's own SDK, not here. Example: [`examples/24-resell-on-base.mjs`](examples/24-resell-on-base.mjs).

## Attested by default

Every step this SDK handles comes with its record: a grade (`recordGrade`), an assurance settle (`settleAttested`) and a
resale step (`attestSale`). Each returns its mark (a digest anyone can recompute from the step's canonical body) and the
unsigned calls that put the mark on Base, where Moonbeam runs:

| contract on Base | call | built for |
|---|---|---|
| JevDecisionLog `0x209490d6A0FFC5368A42b0c2208BDCda853f6a92` | `record(subject, kind, digest, confidenceBps, model, uri)` | every step |
| JevAnswerLog `0x8e9B9cE86a2d55c10318607b0c815B7B8C66254d` | `record(useCase, subject, inputDigest, answersDigest, decisionDigest, model, uri)` | a grade |
| a grade stamp registry | `stamp(subject, digest, verdict, mode, model, uri)` | a step with a verdict |

Base has no grade stamp registry, so the stamp comes back in `missing`, with no call. Pass `networks: [chainId]` to
aim elsewhere, or `networks: 'none'` (`network: 'none'` for a grade) to turn recording off. The mark is returned
either way. Your wallet signs the calls; nothing here sends.

```ts
import { settleAttested, hookQuote } from '@moonbeam-foundation/sdk/assurance';
const s = settleAttested(job, hookQuote({ price, premium, deposit, covered: true }));
s.legs;              // who receives what, from the job's own GLMR amounts
s.attest.calls;      // [JevDecisionLog.record on 8453]
s.attest.missing;    // [{ contract: 'GradeStampRegistry', chainId: 8453, why: … }]
```

## Paying an x402 wall on Base

```ts
import { quoteWall, transferAuthorization, paymentHeader } from '@moonbeam-foundation/sdk/x402';
const { accept } = await quoteWall(transport, '/x402/class/mcp.digest');      // the 402's Base entry (USDC)
const typed = transferAuthorization(accept, { from: myAddress });             // EIP-3009 TransferWithAuthorization
const signature = await wallet.signTypedData(typed);                         // your wallet signs
const header = paymentHeader(accept, typed.message, signature);              // the X-PAYMENT header
```

Only the `exact` entry on Base (`eip155:8453`) is taken; a wall that offers no Base entry is refused. `subscribe()` posts
the top-up door and returns its 402 quote. `quoteSale` from `./resale` prices the same wall from the seller's price.

## Proofs

```ts
import { readProof, verifyOnBase } from '@moonbeam-foundation/sdk/proof';
import { baseReader } from '@moonbeam-foundation/sdk/rpc';
const p = await readProof(transport, txHash);       // block, superroot, checks, proven, ref v5:8453:<tx>@<superroot>
const c = await verifyOnBase(baseReader(), p.blob!); // verify(blob) by eth_call on the V5 verifier 0x2D475a53eAA8F9AC78B69bD2429275a622C644f8
```

`c.verified` is what the verifier returns. `c.anchored` is false while the verifier has no superroot anchor set. The
block is bound to the snapshot the verifier folds by the inclusion path the layer serves (`c.inclusion`).

## Arbitration

`./arbitration` builds the calls of the three-tier ArbitratorRouter: `resolveByCode` (tier 0, anyone),
`secondGraderTypedData` + `resolveBySecondGrader` (tier 1), and `councilApprove`, `pullOracle` and
`resolveByCouncil` (tier 2). It also decodes `Escalated`, `CouncilApproved` and `Resolved`, and `recordEffectOf`
says what a ruling writes into the seller's record. The router is not deployed on Base and the hook names no
arbitrator (`ARBITRATION_ON_BASE`), so every builder takes the router's address.

## The Base reader

`baseReader()` from `./rpc` walks a measured rotation of Base endpoints: a rate limit or a refused range moves the call
to the next endpoint, and a revert is thrown at once. `BASE_RPC` (a comma list) goes first. The live examples read
through it.

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
implementation. One adapter is a hypothetical seam, two is a working one — so it is
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
There is no passive tier, because rewards come from fees paid rather than
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
npm test           # every suite, offline
npm run check      # typecheck + build + tests + the two pins (the assurance machine, the payment scheme)
npm run typecheck  # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
npm run build      # ESM + .d.ts to dist/
npm run test:coverage
```

## License

Apache-2.0
