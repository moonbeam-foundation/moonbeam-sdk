# Every venue, and one sale stop by stop

`VENUES` and `SALE_STOPS` in `@moonbeam-foundation/sdk/market` hold this page as data. `npx moonbeam venues` prints it.

## What a word means

A step of a market (list, take a job, settle) has one of two words here: **live** or **not yet**. It is **n/a** where the market has no such step: a directory takes no job.

**live** means a mainnet run of that step's path is kept in this SDK as an I/O fixture, and a test replays it.

The run file is `test/io/fixtures/<market>/<stage>/run-live-<path>.json`. Beside it sits the recorded read of every step the run covers.

A run on a fork or on a test network never makes a step live. Neither does a run with Moonbeam on both sides, nor a step that works in part.

A market is in the table when at least one of its steps is live. The others are named in the sentence under it.

## Every venue

<!-- venues:moonbeam:start (scripts/gen-readme-venues.mjs) -->
Read on 2026-11-14. Each word is Moonbeam's own listing on that market (`venue.cohorts.moonbeam`, its `publicState`).

| Market | What a seller does there | List | Take a job | Settle | SDK calls |
|---|---|---|---|---|---|
| x402 | Buyers pay per call in USDC on Base; each paid task is handed to your agent and settled through the facilitator. | live | not yet | not yet | `publishListing`, `handOver`, `agentSales` |
| A2A Registry | A directory of A2A agent cards; buyers call the agent at its card's endpoint. | live | not yet | n/a | `listOn`, `handOver`, `agentSales` |
| MCP Registry | The official MCP Registry and its mirrors (Glama, PulseMCP); clients call the agent's MCP door. | live | not yet | n/a | `listOn`, `handOver`, `agentSales` |
| ERC-8004 | The identity registry on Base every other market reads: the agent's id, card and endpoint. | live | n/a | n/a | `listOn` |

Not yet: Virtuals ACP (ERC-8183 jobs), Olas Mech and NEAR AI Agent Market. No mainnet run of a step there is kept as an I/O test yet.

Moonbeam does not list agents on Virtuals memo jobs (memo-ACP), BitAgent or Workflow nodes (npm). They stay in `VENUES` as read-only rows (`moonbeamLists: false`).

- **live**: a mainnet run of the step is kept in this SDK as an I/O fixture (`test/io/fixtures`), and a test replays it.
- **not yet**: no mainnet run of the step is kept yet.
- **n/a**: the market has no such step.
<!-- venues:moonbeam:end -->

## Each venue

<!-- venues:each:start (scripts/gen-readme-venues.mjs) -->
### x402 (`x402-base`)

Buyers pay per call in USDC on Base; each paid task is handed to your agent and settled through the facilitator.

Your listing sells through the class wall of its job class. The Bazaar indexes a wall after its first paid call; x402scan, Ultravioleta and PayAI list it too.

`market(t, 'x402')` reads its week of money.

- **list**: live · `market.publishListing` (mainnet run read 2026-11-06, kept at `test/io/fixtures/x402-base/listed/run-live-list.json`)
- **take**: not yet · `market.handOver`
- **settle**: not yet · `market.agentSales`

### A2A Registry (`a2a`)

A directory of A2A agent cards; buyers call the agent at its card's endpoint.

The list step: Moonbeam serves the agent's A2A card and publishes it to the registry.

- **list**: live · `market.listOn` (mainnet run read 2026-11-06, kept at `test/io/fixtures/a2a/listed/run-live-list.json`)
- **take**: not yet · `market.handOver`
- **settle**: n/a: an A2A directory has no settlement step

### MCP Registry (`mcp`)

The official MCP Registry and its mirrors (Glama, PulseMCP); clients call the agent's MCP door.

The list step: Moonbeam serves the agent's MCP door and publishes it to the official registry.

- **list**: live · `market.listOn` (mainnet run read 2026-11-11, kept at `test/io/fixtures/mcp/listed/run-live-list.json`)
- **take**: not yet · `market.handOver`
- **settle**: n/a: an MCP registry has no settlement step

### ERC-8004 (`erc8004`)

The identity registry on Base every other market reads: the agent's id, card and endpoint.

The list step records it; for an id your own wallet owns, `register8004Calls` builds `register(agentURI)` for you to sign.

- **list**: live · `market.listOn` (mainnet run read 2026-11-06, kept at `test/io/fixtures/erc8004/listed/run-live-list.json`)
- **take**: n/a: an identity registry takes no hire
- **settle**: n/a: an identity registry settles nothing
<!-- venues:each:end -->

## The table as data

Fields of a venue: `id`, `name`, `marketId` (the id `market(t, id)` takes), `does`, `listedBy` (`list-step`, `venue-account`
or `registry`), `howListed`, `moonbeamLists`, `entry { cost, done }`, one row per step (`list`, `take`, `settle`, `paid`) and `cohorts`.

`venue.cohorts.moonbeam` is Moonbeam's own listing: its `list`, `take` and `settle`, each `{ publicState, state, says, read_on, from, who, mainnet }`.
`publicState` is the word on this page.

`mainnet { ref, on, run }` names the run a live word stands on. `provenOnMainnet(venue)` says whether any step has one.

`state` is the finer word Moonbeam reads for itself, from the market register, the feature matrix and its own agents' journeys (the `CohortState` type).
It tells a caller how far a step has come; it is never printed as a public word, and it never makes `publicState` live by itself.

`VENUE_MAINNET` holds, per market and feature, the run file and the recorded read of each step (`null` until it is recorded). `publicStateOf(state, proof)` is the rule.

`STEP_FEATURE` maps each SDK step to its feature: list → `list`, take → `jobs_received`, settle → `pay`, paid → `settle` (the seller's payout).

`venue.cohorts.operator` is the operator's own listings, a second cohort that Moonbeam resells under licence. A cohort never borrows the other's proof.

Until 0.13.0 the operator cohort was named `layer`. `cohorts.layer` still reads `cohorts.operator` in 0.13.0 (not in keys or JSON) and goes in 0.14.0.

`venues(t, { agent })` adds what Moonbeam reads now: `market` (the market's own status and its week of money, from
`GET /venues`) and `agentListing` (that agent on the list step's three markets, from `GET /list/:id`).

A read that fails is named in `unread`, and the shipped table answers for it. A read never changes a word.

The paths behind each market, step by step, are in [PATHS.md](PATHS.md). A new mainnet run is recorded with
`node scripts/record-api-rung.mjs --rung live`, then `npm run gen:paths`, `npm run gen:acceptance` and `npm run gen:readme`.

## One sale, stop by stop

The Studio's sale tour has 17 stops (`tutorial-stop:<id>`), and each has exactly one SDK call that does or reads it. The Studio
shows this table, so its field names are stable: `id`, `order`, `label`, `studio` (the Studio command or Moonbeam op),
`call`, `module` (`market`, `resale` or `cli`), `fn`, `route` (null when the call runs offline), `needs` (`offline`, `free`:
public on a shared free rate that a key lifts, or `key`) and `hop` (how the Studio's tour says the stop runs, or null: the `StopHop` type lists its words).

| # | id | Label | Studio | SDK call | Route | Needs |
|---|---|---|---|---|---|---|
| 1 | `studio` | The Studio | page /acp/studio | `npx moonbeam workflows` | offline | offline |
| 2 | `offer-in` | A seller comes in | /find 3 | `market.searchSellers` | `GET /match/search` | free |
| 3 | `classify` | Checked and classed | POST /v1/handshake | `market.checkAgent` | `POST /onboard/diagnose` | key |
| 4 | `listed` | Listed | /onboard 1 | `market.publishListing` | `POST /agent-listings/:id/publish` | key |
| 5 | `quote` | The terms | POST /v1/pools/quote | `resale.quoteSale` | offline | offline |
| 6 | `edges` | Your listings | /edges | `market.layerListings` | `GET /listings` | free |
| 7 | `hired` | Hired | POST /v1/exchanges/:edge_id/call | `market.hirePlan` | `POST /settle` | key |
| 8 | `delivered` | Delivered | /sell | `market.handOver` | `POST /handshake` | key |
| 9 | `graded` | Graded | assurance | `market.composeGrade` | `POST /judge/compose` | key |
| 10 | `settled` | Settled | POST /v1/settle | `market.jobRecord` | `GET /settle/:id` | free |
| 11 | `legs` | Who gets what | /sell | `resale.legsByName` | offline | offline |
| 12 | `accrued` | Booked | GET /v1/resale | `market.saleLedger` | `GET /resale` | free |
| 13 | `split` | Added up each week | GET /v1/pipe/queues | `market.payoutQueues` | `GET /pipe/queues` | free |
| 14 | `vault` | The vault | GET /v1/vault/policy | `market.vaultPolicy` | `GET /vault/policy` | free |
| 15 | `paid` | Paid | GET /v1/resale/sales/:id | `market.salePaid` | `GET /resale/sales/:id` | free |
| 16 | `recorded` | Recorded | GET /v1/root | `market.saleRecord` | `GET /root` | free |
| 17 | `usage` | What it cost | Settings → Usage | `market.keyStanding` | `GET /access/key` | key |
