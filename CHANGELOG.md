# Changelog

## 0.6.0

The Moonbeam profile, in its one home (this repository; `packages/moonbeam-sdk` in moonbeam-protocol is a pointer now). The
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
- **P9, the machine.** `./assurance` lands here from moonbeam-protocol with its pin refreshed to today's `@taifoon/assurance`
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
