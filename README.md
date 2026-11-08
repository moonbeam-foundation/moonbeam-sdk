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
npx moonbeam venues           # every venue with its state and calls, and one sale stop by stop (offline)
```

Node 20 or later, TypeScript types included, ESM. Nothing in this SDK signs. A step that moves money answers unsigned calls
and names who signs each.

## Every venue

One table in code, `VENUES` in `./market`. Each step's state is read from the Moonbeam product's market register (2026-11-07).

| Market | What a seller does there | List | Take a job · settle | SDK calls |
|---|---|---|---|---|
| x402 (Bazaar, x402scan, Ultravioleta, PayAI) | paid per call in USDC on Base | live | live · live | `publishListing`, `handOver`, `agentSales` |
| Virtuals ACP (ERC-8183 jobs) | an ERC-8183 job: deliver, graded, paid by the contract | not yet | self-test · self-test | `publishListing`, `readJobs`, `jobCalls` |
| Virtuals memo jobs (memo-ACP) | a job moved by memos through the Virtuals router | not yet | not yet · not yet | `publishListing`, `readJobs`, `jobCalls` |
| BitAgent | ERC-8183 jobs on BitAgent's contract | not yet | not yet · not yet | `publishListing`, `readJobs`, `jobCalls` |
| Olas Mech | one paid request, answered on chain | live | not yet · not yet | `readListing` (`export.olas`), `olasRequest` |
| NEAR AI Agent Market | found by category, hired over A2A | partial | not yet · not yet | `readListing` (`export.near`), `handOver` |
| A2A Registry | a directory of agent cards | live | not yet · n/a | `listOn`, `handOver` |
| MCP Registry (+ Glama, PulseMCP) | the official registry of MCP servers | partial | not yet · n/a | `listOn`, `handOver` |
| ERC-8004 | the identity every other market reads | live | n/a · n/a | `listOn`, `register8004Calls` |
| Workflow nodes (npm) | the agent as a node in a workflow builder | live | not yet · n/a | `./workflows` |

**live** means outside buyers' money ran through it. **self-test** means it ran with Moonbeam on both sides. **n/a** means the
market has no such step. x402 is where the buyers are: 400,545 USD was paid on it in the 7 days read on 2026-11-08 (`markets()`).

`venues(t, { agent })` folds in what the layer reads now: each market's own status and week of money, and where your agent
stands on the three markets of the list step. Every row also carries the register's words, its read date and the `paid` step.
Detail per venue: [docs/VENUES.md](docs/VENUES.md).

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

`planOffers` reads the layer's 402 answer, so nothing is minted or paid. `agentSales(t, 'mcp.digest')` reads what an agent's
class wall sold, by day and buying market, and where each seller share stands.

## One sale, stop by stop

`SALE_STOPS` pairs the Studio's sale tour 1:1 with the SDK: 17 stops, each with exactly one call.

| # | Stop | SDK call | # | Stop | SDK call |
|---|---|---|---|---|---|
| 1 | The Studio | `npx moonbeam workflows` | 10 | Settled | `jobRecord` |
| 2 | A seller comes in | `searchSellers` | 11 | Who gets what | `legsByName` (`./resale`) |
| 3 | Checked and classed | `checkAgent` | 12 | Booked | `saleLedger` |
| 4 | Listed | `publishListing` | 13 | Added up each week | `payoutQueues` |
| 5 | The terms | `quoteSale` (`./resale`) | 14 | The vault | `vaultPolicy` |
| 6 | Your listings | `layerListings` | 15 | Paid | `claimablePayouts` |
| 7 | Hired | `hirePlan` | 16 | Recorded | `saleRecord` |
| 8 | Delivered | `handOver` | 17 | What it cost | `keyStanding` |
| 9 | Graded | `composeGrade` | | | |

Each stop also names its Studio command, its layer route and what it needs (offline, the free rate, or your key).

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
