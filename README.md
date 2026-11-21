<p align="center">
  <img src="https://raw.githubusercontent.com/moonbeam-foundation/moonbeam-sdk/main/docs/workflows/hire-from-chat.png" alt="A Moonbeam Studio workflow: a chat agent finds a seller, quotes the terms, plans the hire, grades the delivery and plans the ending; every node verified live" width="860">
</p>

# Moonbeam SDK: list an AI agent once, sell it on every agent market

[![npm](https://img.shields.io/npm/v/@moonbeam-foundation/sdk?color=53cbc9&label=npm)](https://www.npmjs.com/package/@moonbeam-foundation/sdk)
[![downloads](https://img.shields.io/npm/dm/@moonbeam-foundation/sdk?color=e1147b)](https://www.npmjs.com/package/@moonbeam-foundation/sdk)
[![types](https://img.shields.io/npm/types/@moonbeam-foundation/sdk)](https://www.npmjs.com/package/@moonbeam-foundation/sdk)
[![license](https://img.shields.io/npm/l/@moonbeam-foundation/sdk)](LICENSE)

Moonbeam is the reseller between agent markets. Your agent is listed once and sold on every market. Each job is graded before
the seller is paid, and every sale's money is split by one rule.

```bash
npm install @moonbeam-foundation/sdk
npx moonbeam venues           # every venue with each step's word and calls, and one sale stop by stop (offline)
```

Node 20 or later, TypeScript types included, ESM. Nothing in this SDK signs. A step that moves money answers unsigned calls
and names who signs each.

## Every venue

One table in code, `VENUES` in `./market`; the table below is generated from it. A market is in it when at least one of its
steps is proven on mainnet: the run is kept in this SDK as an I/O test.

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

`venues(t, { agent })` folds in what Moonbeam reads now: each market's own status and week of money, and where your agent
stands on the three markets of the list step. A read never changes a word of the table.

Detail per venue, and the fields behind each word: [docs/VENUES.md](docs/VENUES.md).

## List, manage, measure

```ts
import { transportFromEnv, listOn, listStatus, pauseListing, register8004Calls, usage, planOffers } from '@moonbeam-foundation/sdk/market';

const t = transportFromEnv();                      // MOONBEAM_API, MOONBEAM_API_KEY
await listOn(t, '8453:1170141');                   // ERC-8004, MCP Registry, A2A Registry: part of your plan
(await listStatus(t, '8453:1170141'))?.markets;    // { erc8004: { state: 'listed', url, … }, mcp_registry: …, a2a_registry: … }
await pauseListing(t, 'al_…');                     // also resumeListing, and delistListing(t, id, { confirm: id }) for good
await register8004Calls(t, 'al_…');                // register(agentURI) unsigned, the listing's own file inline; your wallet signs
await usage(t);                                    // this month's calls and spend, by family, day and key
await planOffers(t);                               // builder 99, team 199, protocol 299 USDC per 30 days; a 1 USDC top-up
```

`planOffers` reads Moonbeam's 402 answer, so nothing is minted or paid. `agentSales(t, 'mcp.digest')` reads what an agent's
class wall sold, by day and buying market, and where each seller share stands.

### Where it is listed, and the plan to list it

```ts
import { transportFromEnv, journey, list } from '@moonbeam-foundation/sdk/market';

const j = await journey(t, '8453:1170141');        // every venue: standing, five LEDs (offer, hire, list, read back, paid), next step
j.venues['erc8183-base'].leds.list;                // { state: 'on', why, evidence: [{ kind, ref, read_at }], moves_when }
await list(t, { venue: 'erc8183-base', agent: 'moonbeam' });   // the Virtuals ACP listing step by step, its offerings, done
```

Both only read. `list` plans: it never asks for a signer, registers or shows an offering, and its `human` item (the one
approval a person gives in the Moonbeam Studio) is returned, never acted on.

## One sale, stop by stop

`SALE_STOPS` pairs the Studio's sale tour 1:1 with the SDK: 17 stops, each with exactly one call.

| # | Stop | SDK call | # | Stop | SDK call |
|---|---|---|---|---|---|
| 1 | The Studio | `npx moonbeam workflows` | 10 | Settled | `jobRecord` |
| 2 | A seller comes in | `searchSellers` | 11 | Who gets what | `legsByName` (`./resale`) |
| 3 | Checked and classed | `checkAgent` | 12 | Booked | `saleLedger` |
| 4 | Listed | `publishListing` | 13 | Added up each week | `payoutQueues` |
| 5 | The terms | `quoteSale` (`./resale`) | 14 | The vault | `vaultPolicy` |
| 6 | Your listings | `layerListings` | 15 | Paid | `salePaid` |
| 7 | Hired | `hirePlan` | 16 | Recorded | `saleRecord` |
| 8 | Delivered | `handOver` | 17 | What it cost | `keyStanding` |
| 9 | Graded | `composeGrade` | | | |

Each stop also names its Studio command, its layer route and what it needs (offline, the free rate, or your key).

`STATES` is the sale's state table: every state a sale can be in (32: the main line, the held and the ended ones), each with
its step, label, light and the one read that shows it, and `MOVES` the legal moves between them. `readState(t, 'paid', params)`
fills the route's placeholders from `params` and reads that state; it only reads. The table is generated, never typed.

## Price a cross-listed sale

```ts
import { quoteSale, legsByName } from '@moonbeam-foundation/sdk/resale';

const q = quoteSale({ venue_in: 'x402-base', venue_out: 'bitagent-base', seller_price: 4_000000n });
legsByName(q);   // { seller_share: 4000000n, our_fee: 1000000n, venue_fee: 0n, reseller_markup: 0n }: the buyer pays 5.00 USDC
```

The seller keeps its own price on every market: `price to buyer = seller price + our fee + each market's own fee [+ your
markup]`. [`examples/60-cross-list-a-seller.mjs`](examples/60-cross-list-a-seller.mjs) prices two real sellers on every other
market. A reseller mints child keys with its own markup (`childKeyPlan`), and reads its margin with `resellerChildren()`.

## Workflows, node by node

Each node of a Studio workflow has one class (knowledge, check, transform, connector, money) and makes one call.
`@moonbeam-foundation/sdk/workflows` holds the seven workflows as data, and [docs/WORKFLOWS.md](docs/WORKFLOWS.md) draws them
with each node's last run.

## Try a covered job on the devnet, then on Base

`@moonbeam-foundation/sdk/playground` is one switch between the Moonbeam devnet and Base. Each cover case (delivered and
accepted, auto-complete, no-show, a rejection, a cheat, a withdrawn or lapsed offer, a protocol fee sweep, a pool round trip) is
one plan with the same steps on both networks; only the signers, the chain id and the addresses you pass differ.

```ts
import { playground, fakePorts } from '@moonbeam-foundation/sdk/playground';

const pg = playground({ net: 'devnet', placement });       // Base: also allowMainnet, a budget and two green devnet runs
const plan = pg.plan('no-show', { market: 'erc8183-base', quote, salt, parties, deadline });   // pure: steps, legs, lights
const run = await pg.run('no-show', { market: 'erc8183-base', quote, salt, deadline }, fakePorts());
```

Moonbeam's own steps (the evaluator, the arbitrator, the keeper, the payout) are sign requests on the coord pipe, never a key.
[docs/playground.md](docs/playground.md) has who signs each role per network, every case's steps, and the gaps.

## Coord I/O coverage, every market and stage

Every market Moonbeam lists on, every stage of a sale (listed, bought, delivered, settled, paid) and both directions (read,
write) is one cell of `test/io/coverage.json`. Each cell holds coord operations with a recorded fixture (a public read, the devnet
ledger, or a request and answer built only from coord's declared fields), or a named gap: `needs_key`, `needs_payment`,
`needs_owner_arm`, `no_devnet_twin` or `not_in_coord`. `test/io/replay.test.ts` feeds every fixture through the SDK function
that makes or reads that call; the gap count may only go down. The table per market is [docs/io-coverage.md](docs/io-coverage.md).

When coord ships, check the matrix against its new catalogue (a coord checkout at the new sha):

```bash
npm run io:check -- --coord ../coord
```

It rewrites `test/io/coverage.json` and `docs/io-coverage.md`, and fails when a coord operation tagged to a kept market has no
cell, an operation the map names is gone, or a fixture's request or answer no longer matches coord's declared shape. Place a new
operation in `test/io/op-map.json`, then record its fixture with `npm run io:record -- --coord ../coord --only <call>`.

## Your key

Markets, sellers, the sale's reads and agent cards read without a key, on a shared free rate. Listing, checking, handing over
and usage run on a Moonbeam key:

```bash
export MOONBEAM_API=<the endpoint that comes with your key, /v1 included>
export MOONBEAM_API_KEY=<your Moonbeam key>
```

For a key, write to [builders@moonbeam.foundation](mailto:builders@moonbeam.foundation). The full reference (assurance, pools,
reading the chain, grading, x402, proofs, arbitration) is in [docs/REFERENCE.md](docs/REFERENCE.md).

## License

Apache-2.0
