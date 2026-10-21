# Changelog

## 0.8.0

Aligned with the coordination layer as it answers on 2026-10-21. Every shape below was read from its OpenAPI document and
from live read-only calls; the recorded answers are the test fixtures.

- **Cover quotes name their venue (`./cover`).** `GET /v1/cover/quote` now refuses a request without `venue`
  (`400 bad_param: venue is required`). `coverQuotePlan` and `quoteCover` always send it: `erc8183` by default, `venue` to
  choose, or the venue a keyed job id names (`bitagent:8453:8566`). A job that cannot be covered now comes back as
  `{ insurable: false, why[] }`, not as a throw.
- **Refusals in both shapes (`./errors`).** `refusalOf` reads the layer's `{ ok: false, code, error: "<words>" }` and the
  OpenAI error object `{ error: { message, type, param, code } }` (the chat and System One doors). Every read throws one
  `CoordError` (status, code, type, param, nextStep, body). This covers proof, resale, onboard, cover, jobs, x402 and the
  judge's System One call. `OnboardError` is a `CoordError`. An object `error` never crashes a read or shows as
  `[object Object]`. `subscribe` returns its refusal as `refusal`.
- **Jev over System One, two doors (`./judge`).** `gradeJob({ …, key, systemOne })` asks TypeSafe
  (`api.typesafe.ai/v1/systemone`) by default. `systemOne: { via: 'coord', base, apiKey }` sends the same request through a
  coordination endpoint's `/systemone` door, with `X-API-Key` and your provider key in `x-systemone-key`. `askSystemOne`
  (also `askJev`) asks once. Model aliases: `jev-1-13-0` → `jev-1.13.0`, `jev-1-14-0` → `jev-1.14.0`,
  `typesafe-jev` → `jev-latest`.
- **x402 v2 (`./x402`).** The payment travels in `PAYMENT-SIGNATURE` and carries the accepted entry whole
  (`{ x402Version: 2, accepted, payload }`). 0.7.0 sent v2 with a top-level scheme and network, and the wall refused it:
  "accepted.scheme must be exact". `paymentHeaders` adds `X-PAYMENT` with `legacy` (the walls still read it) and sends only
  `X-PAYMENT` for v1. `pickAccept(body, { network })` chooses the offer by network: Base, Arbitrum, Arc, Robinhood Chain,
  Monad and Solana are all on the walls today. `transferAuthorization` signs on the entry's own chain and refuses a Solana
  entry rather than build the wrong thing. A 402 is also read from its `PAYMENT-REQUIRED` header.
- **The seller is paid on its own venue (SETTLE_ON_SELLER_VENUE_v1).** `sellerRailOf(offer)` resolves the network, token
  and payTo of a seller's leg: its own x402 entry first, then its venue's rail. A seller with no paid rail of its own is
  paid in USDC on Base. Otherwise the leg is held (`network_not_served`, `token_not_served`, `no_payee`), never moved. It
  passes every vector the layer publishes for the rule. `quoteSale` takes the seller's own venue (any venue the scheme
  prices); the buyer still pays on Base, and `quoteBase` keeps both sides on Base. The network is a field in `attestSale`
  (`chainId`), `subscribePlan` (`chainId`), `readProof` (`chain`) and the pool builders (`chainId` or `network`).
  Moonbeam's pool line stays GLMR on Base (`POOL_LINE`).
- **Job views (`./jobs`).** `parseJobRef` reads a bare number as a Virtuals ACP v3 job on Base. `<label>:<chainId>:<jobId>`
  is a contract-keyed job (`bitagent:8453:8566`), and a 32-byte id is a hook job. `readJobs` reads up to 50 of them in one
  call. `needs_review` is its own hold (`holdOf`, `JobRow.hold`, and `toOutcome(…, { verdict: 'needs_review' })` →
  `pending: 'needsReview'`), not "awaiting grade".
- **Both answer logs, and the evaluator adapter on Base.** The registry adds JevAnswerLogV2
  `0xC08dfc61d702AEA45d1EF2515d8BDA36d548C75c` and JudgeAdapterV5 `0x5242dE388a846d16641744dEB095eD63990E7be8`.
  `answerRecordedAt` looks a digest up in both logs, `answerLogTotals` reads each log's `total()`, and `readJudgeAdapter`
  reads the adapter's hook, decision log and release delay from Base.
- **Dependencies.** One fewer: the grader's workflow-node package is no longer listed, because no file of this package
  imports it. `@taifoon/jev` and `@taifoon/jev-wilson` remain.
- Examples 50 and 51 read live only when `MOONBEAM_API` names your coordination endpoint; otherwise they use their
  recorded answers. Example 50 picks the entry of `NETWORK`.

## 0.7.0

Every write path now runs on a local fork of Base (`test/fork/run-fork.mjs`), and every read on Base itself
(`LIVE=1 npm test`). Three of 0.6.0's notes did not hold when tested, and are fixed here (P8, P11, and P4's client).

- **Attested by default.** A grade (`recordGrade`), an assurance settle (`settleAttested`) and a resale step (`attestSale`)
  each return their mark (a recomputable digest) and the unsigned calls that put it on Base: `JevDecisionLog.record`,
  `JevAnswerLog.record` for a grade, and a stamp where the step has a verdict. Base has no grade stamp registry, so the
  stamp is listed in `missing`, with no call. `networks: [...]` aims elsewhere; `networks: 'none'` (`network: 'none'`
  for a grade) turns recording off. Before 0.7.0, `recordGrade` defaulted to a test network. The helper is the shared
  one, vendored inside `assurance-shared.ts` and pinned (`./attest`).
- **x402 on Base (`./x402`).** `baseAccept` takes a 402's `exact` entry on Base and refuses one without it.
  `transferAuthorization` builds USDC's EIP-3009 typed data, `paymentHeader` builds the X-PAYMENT value, `quoteWall`
  reads a wall's quote, and `subscribe` posts the top-up door.
- **Proofs (`./proof`).** `readProof` reads `/v1/proof/tx/8453/<tx>` (proven only when every check holds) and
  `proofRef`/`parseProofRef` handle `v5:<chain>:<tx>@<superroot>`. `verifyCall` and `verifyOnBase` ask the V5 verifier on
  Base (`verify(blob)` by eth_call). The verifier has no superroot anchor set, so the result says `anchored: false`.
- **Arbitration (`./arbitration`).** Covers the ArbitratorRouter's three tiers: `resolveByCode`,
  `secondGraderTypedData` + `verdictDigest` + `resolveBySecondGrader`, then `councilApprove`, `pullOracle` and
  `resolveByCouncil`. It also decodes `Escalated`, `CouncilApproved` and `Resolved`, and `recordEffectOf` says what a
  ruling writes into the seller's record. The router is not deployed on Base (`ARBITRATION_ON_BASE`).
- **Depends on `@taifoon/jev` ^0.3.0**, the grader release that records and stamps by default (its calls stay unsigned).
- **The Base reader (`./rpc`).** `baseReader()` walks a measured rotation of Base endpoints. Example 32 reads through it
  (**P8**: in 0.6.0 it still called `mainnet.base.org` directly).
- **Resale.** `quoteSale` (Base venues only) prices a wall the way the layer does: a seller's 9,207 becomes the
  buyer's 11,509, the live `mcp.digest` price. `attestSale` attests each step.
- **Covered jobs.** `coverPremium(price, { k, n })` is the layer's premium (jev-wilson). `sellerDepositCalls` is the
  seller's exact deposit approval (missing until now: `fundJob` pulls the deposit). `hookQuote` gives the legs of a V3 hook
  job from its own GLMR amounts.
- **P11.** `poolsOpenOn` now reads the layer's `supported` lines and `closed_by_policy`. 0.6.0 read a `networks` field
  the layer does not send, so it always fell back to the typed list. Moonbeam's pools stay closed while the policy says
  so. The pool builders take `openOn`.
- **P13.** `./onboard` is the one onboarding module: the readiness checks of every role are exported there too.
- **P4.** The old escrow client says plainly that it is not deployed (`CLIENT_STATUS`) and points to `./onboard`.
- **Dependencies.** `@taifoon/jev-wilson` ^0.3.1, `@taifoon/n8n-nodes-typesafe` ^2.0.5, TypeScript 7, vitest 5, viem
  2.57. The pins are re-synced with `scripts/sync.mjs` (`--check`) from the layer's sources.
- Copy: no "real" in the examples, the skills or the README. The judge sample takes your own TypeSafe key.

## 0.6.0

The Moonbeam profile, in its one home (this repository; the copy in the Moonbeam monorepo is replaced by this package). The
fixes answer the Moonbeam SDK gap analysis of 2026-10-14, by its numbers:

- **P1, the calldata.** `fundCalls` wrote an *evaluator* into the last word of `fundJob`; the hook's last word is the **cover pool**
  (`AssuranceHook.sol` `fundJob(bytes32,address,address,uint256,uint256,uint256,uint64,uint64,address pool)`), and the hook keeps
  no per-job evaluator (the owner's allowlist, `setEvaluator`). Now `fundCalls(terms, { pool, premium, coverCap })`; passing
  `evaluator` throws. `fundJobWithCover` is encoded when a cover cap is named.
- **P2, the premium.** It is an argument the hook checks against the pool, not something it reads; the approve covers price + premium.
- **P3, GLMR only.** A covered job is a GLMR job (`BASE_GLMR`); a USDC job with a pool is refused before any call. Uncovered USDC
  jobs are unchanged.
- **P4, the README.** "Building transactions" documents the hook's calls; the undeployed `createAssuranceClient` sample is gone from it.
- **P5, the ledger manifest.** Moonbeam ACP is deployed on Base: the hook, the factory and the pools come from the coordination
  layer's address registry through `scripts/gen-moonbeam-acp.mjs` (`src/acp/moonbeam-acp.generated.ts`, `--check` in `npm run
  check:registry`); no address is typed by hand any more, and the registry's status rides along (`MOONBEAM_HOOK.status`).
- **P6, the judge's anchor.** `DEFAULT_GUARD.anchor` is the Base decision log, from the registry.
- **P7, dependencies.** `@taifoon/jev` ^0.2.18 (warmbed-first reads), `@taifoon/jev-wilson` `>=0.2.0 <0.4.0`.
- **P8.** The live example already takes `BASE_RPC`; its header names the layer's rotation as the endpoint to use.
- **P9, the machine.** `./assurance` lands here from the Moonbeam monorepo with its pin refreshed to today's `@taifoon/assurance`
  (`456db7d1…`, commit f43acf0); `npm run check:pins` fails on an edited copy.
- **P11, pools open.** `poolsOpenOn(transport)` reads `GET /v1/pools/networks`; `POOLS_OPEN_ON` is the fallback, not the policy.
- **P12, the quota.** `quotaOf(transport)` reads `GET /v1/judge/credits`; the typed values are the fallback.
- **P13.** The two "onboard" modules are named for what they are in `src/index.ts`; no export is renamed.
- **New: `./resale`.** The vendored one payment scheme (pinned), `quoteBase` on the Base venues, `legsByName`, `markupLeg`,
  `childKeyTerms`, `childKeyPlan`, `subscribePlan`, `readSale`, `readResellerView`. Example 24.
- The GLMR pools are not open. Moonbeam ACP is in a pilot with selected partners: builders@moonbeam.foundation.

Next (not in this release): the x402 rail (EIP-3009 typed data), arbitration (`ArbitratorRouter` is not deployed), the V5
proof reader, the warmbed transport by default.

## 0.5.3

- The README reads plainly: a one-line pilot note with builders@moonbeam.foundation.
