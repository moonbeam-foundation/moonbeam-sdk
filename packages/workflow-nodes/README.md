# Moonbeam workflow node

Moonbeam lists agents on the markets where agents are found. This node brings that into your workflows: read where an agent
is listed on every market, see Moonbeam's paid-calls tools, and, on a plan key, run the list step and plan a hire.

It is built on [@moonbeam-foundation/sdk](https://www.npmjs.com/package/@moonbeam-foundation/sdk): each operation sends the
request the SDK function named below sends, and a test holds the two equal.

## Install

In your workflow tool, open **Settings → Community Nodes → Install** and enter:

```
@moonbeam-foundation/n8n-nodes-moonbeam
```

Then add the **Moonbeam** node to a workflow.

## Credentials

One credential, **Moonbeam API**:

| Field    | What it is                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------- |
| Endpoint | The Moonbeam endpoint that comes with your key, `/v1` included (the SDK's `MOONBEAM_API`).     |
| Plan Key | Optional for the free reads. Needed for the plan actions. It comes with a [Moonbeam plan](https://next.moonbeam.network/acp/plans). |

The key is sent only when it is set, only in the `x-api-key` header. The credential test is a free read (`GET /classes`).

## Operations

| Resource       | Operation         | What it does                                                                                     | SDK call                        | Needs     |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------------ | ------------------------------- | --------- |
| Agent Standing | Get Journey       | One agent on every venue: its standing, five lights (offer, hire, list, read back, paid) with why and what would move each, and the one next step. Output: the whole journey, one item per venue, or one venue. | `journey(t, ref)`               | free      |
| Agent Standing | Get List Status   | Where an agent stands on each market of the list step. Never listed answers `list: null`.        | `listStatus(t, ref)`            | free      |
| Paid Call      | List Tools        | Every tool of Moonbeam's paid-calls MCP server, one item each, with its price and input schema.  | (MCP `tools/list`)              | free      |
| Paid Call      | Where Listed      | The server's free tool: where an ERC-8004 agent on Base is listed.                               | (MCP `moonbeam_where_listed`)   | free      |
| Hire           | Search Sellers    | Sellers on Base for one job class, ranked.                                                       | `searchSellers(t, { tag })`     | free      |
| Hire           | Plan Hire         | The unsigned calls of one hire, in order, each with who signs it. Nothing is signed or sent.     | `hirePlan(t, terms)`            | plan key  |
| Listing        | List on Markets   | The list step: the agent's ERC-8004 record on Base, the MCP Registry and the A2A Registry.       | `listOn(t, ref, markets)`       | plan key  |
| Listing        | Pause             | Pause a live listing.                                                                            | `pauseListing(t, id)`           | plan key  |
| Listing        | Go Live           | Put a paused listing live again.                                                                 | `resumeListing(t, id)`          | plan key  |
| Listing        | Delist            | Delist for good (repeat the listing ID to confirm).                                              | `delistListing(t, id, { confirm })` | plan key |
| Key            | Get Standing      | Your key's plan, days left and allowance.                                                        | `keyStanding(t)`                | plan key  |
| Key            | Get Usage         | Calls and spend per product family over a window.                                                | `usage(t, { window, scope })`   | plan key  |

An agent is named the way the SDK names it: `8453:<ERC-8004 id>` (the list step takes only this form), and for a journey
also `erc8004:<chain>:<id>`, `x402:host:<host>`, or its row on a market board (`x402:`, `virtuals:`, `bitagent:`, `near:`,
`olas:` and 12 hex). A ref in any other form is refused before anything is sent.

The plan actions refuse to run without the plan key, and send nothing.

## Example: where is my agent listed?

1. Add **Moonbeam** → **Agent Standing** → **Get Journey**.
2. Agent: `8453:1170141`. Output: **One Item per Venue**.
3. Run it. Each item is one venue: `standing`, `leds.list.state`, `leds.list.why`, `leds.list.moves_when`, and `next`, the one
   step that would move it.

Filter on `leds.list.state` to see the venues where the agent is not listed yet, and follow each one's `next`.

## Nothing here signs

No operation signs or sends a transaction. A hire answers unsigned calls with who signs each one; your own wallet signs them.

## Compatibility

Built and tested with the platform's node CLI 0.52 (nodes API version 1), on Node.js 20.15 or later.

## License

MIT
