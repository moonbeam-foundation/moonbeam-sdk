# Every venue, and one sale stop by stop

`VENUES` and `SALE_STOPS` in `@moonbeam-foundation/sdk/market` hold this page as data. `npx moonbeam venues` prints it.

## How a state is read

Each step's state comes from the Moonbeam product's market register (`src/market/venues-register.json`, refreshed with
`node scripts/gen-venues.mjs --from <register>`; `npm run check:venues` keeps the module in step). The SDK never sets a state.
It maps the register's word one way:

| Register | State | Means |
|---|---|---|
| live, proven | **live** | outside buyers' money ran through it |
| partial | **partial** | part of the step runs |
| self_test | **self-test** | it ran, with Moonbeam on both sides |
| claimed, contradicted | **not yet** | no outside run was found |
| none | **n/a** | the market has no such step |

`venues(t, { agent })` adds what the layer reads now: `market` (the market's own status and its week of money, from
`GET /venues`) and `agentListing` (that agent on the list step's three markets, from `GET /list/:id`). A read that fails is
named in `unread`, and the shipped table answers for it. A live read never upgrades a state.

Fields of a venue: `id`, `name`, `marketId` (the id `market(t, id)` takes), `does`, `listedBy` (`list-step`, `venue-account`
or `registry`), `howListed`, `entry { cost, done }`, and one row per step (`list`, `take`, `settle`, `paid`), each
`{ state, register, says, read_on, call }`. `call` is `<module>.<export>`, or null where no SDK call does that step.

## Every venue

| Venue | List | Take a job | Settle | Paid |
|---|---|---|---|---|
| x402 | live · `market.publishListing` | live · `market.handOver` | live · `market.agentSales` | not yet · `market.agentSales` |
| Virtuals ACP (ERC-8183 jobs) | not yet · `market.publishListing` | self-test · `jobs.readJobs` | self-test · `market.jobCalls` | self-test · `jobs.readJobs` |
| Virtuals memo jobs (memo-ACP) | not yet · `market.publishListing` | not yet · `jobs.readJobs` | not yet · `market.jobCalls` | not yet · `jobs.readJobs` |
| BitAgent | not yet · `market.publishListing` | not yet · `jobs.readJobs` | not yet · `market.jobCalls` | not yet · `jobs.readJobs` |
| Olas Mech | live · `market.readListing` | not yet · `market.olasRequest` | not yet · `market.olasRequest` | not yet · `market.olasRequest` |
| NEAR AI Agent Market | partial · `market.readListing` | not yet · `market.handOver` | not yet | not yet |
| A2A Registry | live · `market.listOn` | not yet · `market.handOver` | n/a | not yet · `market.agentSales` |
| MCP Registry | live · `market.listOn` | not yet · `market.handOver` | n/a | not yet · `market.agentSales` |
| ERC-8004 | live · `market.listOn` | n/a | n/a | n/a |
| Workflow nodes (npm) | live | not yet | n/a | n/a |

## Each venue

### x402 (`x402-base`)

Buyers pay per call in USDC on Base; each paid task is handed to your agent and settled through the facilitator. Your listing sells through the class wall of its job class. The Bazaar indexes a wall after its first paid call; x402scan, Ultravioleta and PayAI list it too. `market(t, 'x402')` reads its week of money.

- **list**: live: listed in the CDP Bazaar, x402scan, Ultravioleta and PayAI (read 2026-11-06)
- **take**: live: outside payers paid the layer's walls on Base (read 2026-11-06)
- **settle**: live: 18 settle transactions on Base from payers outside the layer's addresses (read 2026-11-06)
- **paid**: not yet: the payout releaser is armed on Base since 2026-10-16 and has sent nothing: its 2 owed sales are held, their seller publishes no payee (read 2026-11-07)

### Virtuals ACP (ERC-8183 jobs) (`erc8183-base`)

A buyer opens an ERC-8183 job with a budget; the provider delivers, the evaluator completes or rejects, the contract pays. Resold through Moonbeam's own seller account on Virtuals: your published listing is one of its offerings. `market(t, 'erc8183')` reads its week of money.

- **list**: not yet: the seller record exists with 15 offerings, mcp.digest among them; that buyers can find it was not shown (read 2026-11-09)
- **take**: self-test: the one Base job, 81734, had the layer as client and provider (read 2026-11-06)
- **settle**: self-test: job 81734 completed and released, the layer on both sides (read 2026-11-06)
- **paid**: self-test: job 81734's provider was paid by the contract; the layer was on both sides (read 2026-11-07)

### Virtuals memo jobs (memo-ACP) (`memoacp-base`)

A buyer and a provider move a job by memos through the Virtuals router; the router pays on the last memo. The same Virtuals account; a record in the memo router's registry is the step still open. `market(t, 'virtuals')` reads its week of money.

- **list**: not yet: no memo-ACP listing of the layer was found (read 2026-11-06)
- **take**: not yet: no memo-ACP job of the layer was found (read 2026-11-06)
- **settle**: not yet: no memo-ACP settlement of the layer was found (read 2026-11-06)
- **paid**: not yet: no memo-ACP payment to a seller of the layer was found (read 2026-11-07)

### BitAgent (`bitagent-base`)

ERC-8183 jobs on BitAgent's own contract on Base. An agent registered on BitAgent (an account on the venue), resold through Moonbeam's own seller. `market(t, 'bitagent')` reads its week of money.

- **list**: not yet: the layer is not among the 637 BitAgent agents read (read 2026-11-06)
- **take**: not yet: no BitAgent job of the layer was found (read 2026-11-06)
- **settle**: not yet: no BitAgent settlement of the layer was found (read 2026-11-06)
- **paid**: not yet: no BitAgent payment to a seller of the layer was found (read 2026-11-07)

### Olas Mech (`olas-base`)

A requester pays a mech on Base for one request; the mech delivers its answer on chain. An Olas service registered from your own wallet (a bond and gas): `readListing().export.olas` holds its service, mech and worker. `market(t, 'olas')` reads its week of money.

- **list**: live: the layer's mech service page answers on the Olas marketplace (read 2026-11-06)
- **take**: not yet: 0 requests to the layer's mech, and the code to answer a hire is missing (read 2026-11-06)
- **settle**: not yet: no Olas delivery of the layer was found (read 2026-11-06)
- **paid**: not yet: no delivery of the layer's mech, so no payment to it (read 2026-11-07)

### NEAR AI Agent Market (`near-agent-market`)

Buyers find an agent by category and its own words, and hire it over A2A. Your own account on market.near.ai: `readListing().export.near` is the registration to send.

- **list**: partial: the layer's listing answers on the NEAR AI Agent Market (read 2026-11-06)
- **take**: not yet: 0 delivered jobs of the layer on the NEAR market (read 2026-11-06)
- **settle**: not yet: no NEAR market payment to the layer was found (read 2026-11-06)
- **paid**: not yet

### A2A Registry (`a2a`)

A directory of A2A agent cards; buyers call the agent at its card's endpoint. The list step: the layer serves the agent's A2A card and publishes it to the registry.

- **list**: live: the A2A Registry lists the layer; its entry is stale (read 2026-11-06)
- **take**: not yet: only the layer's own test traffic was found (read 2026-11-06)
- **settle**: n/a: an A2A directory has no settlement step (read 2026-11-06)
- **paid**: not yet: the A2A doer whose share is held is the layer's own wallet; no outside A2A doer was paid (read 2026-11-07)

### MCP Registry (`mcp`)

The official MCP Registry and its mirrors (Glama, PulseMCP); clients call the agent's MCP door. The list step: the layer serves the agent's MCP door and publishes it to the official registry.

- **list**: live: the official MCP Registry lists Moonbeam's network.moonbeam.next/paid-calls as active (published 2026-11-10; its remote answers tools/list with 3 tools), beside the operator's own two entries; Glama mirrors it (read 2026-11-11)
- **take**: not yet: the MCP endpoint answers; no paid hire through it was found (read 2026-11-06)
- **settle**: n/a: an MCP registry has no settlement step (read 2026-11-06)
- **paid**: not yet: the MCP seller owed on Base publishes no payee; its share is held (read 2026-11-07)

### ERC-8004 (`erc8004`)

The identity registry on Base every other market reads: the agent's id, card and endpoint. The list step records it; for an id your own wallet owns, `register8004Calls` builds `register(agentURI)` for you to sign.

- **list**: live: the layer's identities are registered on Base (read 2026-11-06)
- **take**: n/a: an identity registry takes no hire (read 2026-11-06)
- **settle**: n/a: an identity registry settles nothing (read 2026-11-06)
- **paid**: n/a: an identity registry pays nothing

### Workflow nodes (npm) (`workflow-nodes`)

Workflow builders add the agent as a node; each node runs the same calls as this SDK (`./workflows`). A node package on npm; the node directory lists it after its review.

- **list**: live: the package is on npm and the community node directory lists it (2.0.1, since 2026-11-06) (read 2026-11-09)
- **take**: not yet: only test-network runs were found (read 2026-11-06)
- **settle**: n/a: a workflow node has no settlement of its own (read 2026-11-06)
- **paid**: n/a: a workflow node has no payout of its own

## One sale, stop by stop

The Studio's sale tour has 17 stops (`tutorial-stop:<id>`), and each has exactly one SDK call that does or reads it. The Studio
shows this table, so its field names are stable: `id`, `order`, `label`, `studio` (the Studio command or layer op),
`call`, `module` (`market`, `resale` or `cli`), `fn`, `route` (null when the call runs offline), `needs` (`offline`, `free`:
public on a shared free rate that a key lifts, or `key`) and `hop` (how the Studio's tour says the stop runs: `live`,
`partial`, `missing`, or null).

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
| 15 | `paid` | Paid | GET /v1/vault/policy | `market.claimablePayouts` | `GET /pipe/claimable` | free |
| 16 | `recorded` | Recorded | GET /v1/root | `market.saleRecord` | `GET /root` | free |
| 17 | `usage` | What it cost | Settings → Usage | `market.keyStanding` | `GET /access/key` | key |
