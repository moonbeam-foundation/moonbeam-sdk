# The devnet profile (internal)

Internal note. This file is not in the package's `files`, so npm never ships it. The council rule holds: no test-network
address, RPC URL, explorer link or faucet URL is written in this package, its README or its docs. This note names none
either. The values live with the operators, beside the onboarding batch.

## What `./devnet` is

`@moonbeam-foundation/sdk/devnet` takes one seller from the worklist to a working edge on a test network. Each step is one
call. A step returns plain data or unsigned calls, and nothing in the module signs.

| Step | Call | API operation |
|---|---|---|
| profile | `devnetProfile(options, transport)` | `GET /pools/networks` (the GLMR line of a `network: "devnet"` row), `GET /rpc/:chainId` |
| find | `findSellers` | `GET /onboard/worklist` (paged) |
| check | `mcpTools`, `checkSeller` | `POST /handshake` (dispatch), rule `onboard.task-answer@1` |
| edge | `openPoolPlan`, `poolOpened`, `edgeAgreement`, `edgeBody`, `writeEdge`, `readEdge` | `POST /pools/open`, `GET /pools/open/:chain/:tx`, `POST /exchanges/edge`, `GET /exchanges?id=` |
| fund | `faucetMintCalls`, `claimGas`, `fundPoolPlan` | the test token's open `mint`, the gas faucet's `POST /claim`, `POST /pools/vault` (else `./pools` `depositCalls`) |
| quote | `quoteEdge` | `POST /pools/quote` (the only source of the terms) |
| hire, deliver | `hire`, `deliver` | `POST /settle { via: "us" }` with no verdict |
| grade | `grade`, `binaryVerdict` | the Studio's grade workflow; the grader's own `THRESHOLDS_v1` |
| settle | `decisionDigest`, `settle` | `GET /judge/decisions/:id`, `POST /settle` with the decision (the evaluator's calls only) |
| read back | `callEdge`, `meterLines`, `agreementState` | `POST /exchanges/:edge_id/call`, `GET /exchanges/:edge_id/meter`, `GET /exchanges/:edge_id/agreement` |

The last three operations are new. Until the API routes them, the calls answer `pending`, not an empty list.

Grades are binary. The grader's own complete or reject stands. Any other grade completes when `spec_met > 0.4` and
`cheat_shaped < 0.5`, and rejects otherwise. Both thresholds are read from `RUBRIC_v1` of the grader package. There is no
review queue.

Every money call refuses a chain other than the profile's own. It also refuses a profile that names a chain with value
(`MAINNET_CHAIN_IDS`).

## Where the profile's values come from

The sources are tried in order: options, then the environment, then the API. The profile records which source gave each
field (`profile.sources`).

| Field | Environment | From the API |
|---|---|---|
| chain id | `MOONBEAM_DEVNET_CHAIN_ID` | the devnet GLMR row of `GET /pools/networks` |
| RPC | `MOONBEAM_DEVNET_RPC` | `GET /rpc/:chainId` → `best` |
| hook, factory, token | `MOONBEAM_DEVNET_HOOK`, `_FACTORY`, `_TOKEN` | the same row |
| line | `MOONBEAM_DEVNET_LINE` | the same row |
| evaluator adapter | `MOONBEAM_DEVNET_ADAPTER` | a quote's `line.evaluator_adapter` (`withQuote`) |
| gas faucet | `MOONBEAM_DEVNET_FAUCET` | never |
| transaction link | `MOONBEAM_DEVNET_TX_LINK` (`{chain}`, `{hash}`) | never |
| coordination endpoint | `MOONBEAM_API` (with `/v1`) | n/a |
| tenant key | `MOONBEAM_API_KEY` | n/a |

## The end-to-end run

`npm run e2e:devnet` builds the package, then runs `scripts/devnet-onboard.mjs`. The script onboards one seller and prints
each step with its transaction links. It prints the pool balance, the meter lines and the agreement state at the end.

The script also needs:

- `MOONBEAM_GRADE_URL` and `MOONBEAM_GRADE_TOKEN`, the Studio's grade workflow;
- a test mnemonic, from `MOONBEAM_DEVNET_MNEMONIC` or the macOS Keychain item `moonbeam-devnet-mnemonic`. The mnemonic is
  never printed.

The operators' wrapper sets these values from their secret store. Options:

- `--seller <chain>:<agent>` picks one seller;
- `--tries N` sets how many candidates are checked;
- `--backing N` sets the pool's backing in test GLMR (default 10);
- `--no-finalize` skips the wait for a rejection's dispute window;
- `--json <file>` writes the run record.

The script uses these key indexes: sellers of record 37200–37999 (one per edge, the batch's own range), buyer 36934,
evaluator 36958, pool backer 37040, gas 0. The backer funds the pool with test GLMR minted from the token's faucet. The
seller of record never backs its own pool.
