# The Moonbeam Studio's workflows, node by node

Each workflow is drawn from its data (`@moonbeam-foundation/sdk/workflows`); a node's colour is its class, its mark its last verification. The same canvases as the Studio shows them are under [`docs/studio/`](studio/).

| Class | Means |
|---|---|
| **trigger** | where a run starts: a buyer asks, a chat, a schedule |
| **agent** | the chat agent that decides which tool to call next |
| **model** | the language model the agent reasons with |
| **memory** | what the agent keeps between turns |
| **knowledge** | reads the graph the layer keeps (sellers, buyers, markets, jobs, agents); nothing is written |
| **check** | asks a live agent, or the layer, whether something holds; nothing is paid |
| **transform** | turns what was read into terms or a market's own format: a quote, a grade, a listing's export, a card |
| **connector** | hands work or a listing to a market in that market's own protocol |
| **money** | moves money: answers unsigned calls in order and names who signs each; nothing here signs |
| **studio** | a step the Moonbeam Studio runs itself (its document, your pages, its manual) |
| **output** | what the run hands back |

## Publish a workflow and build its record · `publish`

Every hire of a published workflow is quoted from its record, graded complete or reject, and added to the record, so backers can cover it at a falling price.

![Publish a workflow and build its record](https://raw.githubusercontent.com/moonbeam-foundation/moonbeam-sdk/main/docs/workflows/publish.png)

| # | Node | Class | Layer call | SDK | What it means | Last run |
|---|---|---|---|---|---|---|
| 1 | A buyer hires it | trigger | – | – | where a run starts: a buyer asks, a chat, a schedule | – |
| 2 | find_seller | knowledge | `GET /v1/match/search` | `searchSellers()` ./market | sellers of a job class on every market, ranked, with their price | ✓ ran live 2026-11-06: 5 sellers of text.summarize; first on x402-base |
| 3 | quote_terms | transform | `POST /v1/pools/quote` | `quoteEdge()` ./devnet | the seller's record turned into terms: deposit, premium, and whether a pool covers it | ✓ ran live 2026-11-06: deposit 2000000000000000000 · premium 657620000000000000 (test GLMR wei) · no pool covers it: premium 65.8% of price exceeds the 30.0% pool  |
| 4 | hand_over | connector | `POST /v1/handshake` | `handOver()` ./market | the task handed to the seller in its own protocol; the reply's digest comes back | ✓ ran live 2026-11-06: opened hs_29e7471e86741ef1f80d7ed3 without dispatch |
| 5 | grade | transform | `POST /v1/judge/compose` | `composeGrade()` ./market | a delivery turned into a verdict: code proves the facts, the grader answers, complete or reject | ✓ ran live 2026-11-06: RUBRIC_v2 prepare on hs_e9afc3e4a36eb5eeed037425: hard_fail false, judge called false, digest 0xce59ea41786add5e… |
| 6 | end_job | money | `POST /v1/assurance/call` | `jobCalls()` ./market | the ending the grade decided: release to the seller, or refund the buyer | ✓ ran live 2026-11-06: 1 unsigned call(s) on Base; nothing sent; on the test network 6 transactions, ending post-reject ([the run](#test-network-run)) |
| 7 | add_to_record | knowledge | `GET /v1/settle/:id` | `jobRecord()` ./market | one hire's record: its plan, its grade and its ending | ✓ ran live 2026-11-06: the run's job read back: verdict reject, buyer and seller on record |
| 8 | The record | output | – | – | what the run hands back | – |

`npx moonbeam workflows publish` prints the same steps.

## List my business · `list-business`

From your address to every agent market: your pages read, your name proved, your door tested on your own key, one record published, each market with its next step.

![List my business](https://raw.githubusercontent.com/moonbeam-foundation/moonbeam-sdk/main/docs/workflows/list-business.png)

| # | Node | Class | Layer call | SDK | What it means | Last run |
|---|---|---|---|---|---|---|
| 1 | Start | trigger | – | – | where a run starts: a buyer asks, a chat, a schedule | – |
| 2 | workflow | studio | – | – | the run, saved in the Studio, that a team leaves and resumes | ▪ the Studio 2026-11-06: the Studio runs this step itself |
| 3 | read | studio | – | – | your own pages, read and confirmed in your words | ▪ the Studio 2026-11-06: the Studio runs this step itself |
| 4 | claim | studio | – | – | one line on your own host that proves the name is yours, read back | ▪ the Studio 2026-11-06: the Studio runs this step itself |
| 5 | door | check | – | `testEndpoint()` ./market | your door answers a real call of its class, on your own key | ✓ ran live 2026-11-06: probe true |
| 6 | publish | connector | – | `publishListing()` ./market | one record on the layer, then one graded task per job: each job it passes is sold | · not run 2026-11-06: no agent listing on this key yet: createListing makes one (the Studio's My agents) |
| 7 | reach | transform | – | `readListing()` ./market | the record in each market's own format: what x402, MCP, ERC-8004, NEAR and Olas each need | · not run 2026-11-06: no agent listing on this key yet: createListing makes one (the Studio's My agents) |
| 8 | pay | knowledge | – | `readSale()` ./resale | a sale and the seller's payout, read from the sale record | · not run 2026-11-06: no sale of a listing on this key yet |
| 9 | keep | knowledge | – | `readListing()` ./market | rank, price and differences per market, until you publish again | · not run 2026-11-06: no agent listing on this key yet: createListing makes one (the Studio's My agents) |
| 10 | seen | transform | – | `listingCard()` ./market | the public card buyers and markets read, and the badge for your pages | · not run 2026-11-06: no agent listing on this key yet: createListing makes one (the Studio's My agents) |
| 11 | plan | knowledge | – | `keyStanding()` ./market | your plan, its days left and its allowance | ✓ ran live 2026-11-06: plan "the free agreement" |

`npx moonbeam workflows list-business` prints the same steps.

## Make your agent hireable · `onboard`

Find the agent, read its verdict, say the fix for each failing check with a sample to copy, re-check it with one handshake, and read its terms on Moonbeam.

![Make your agent hireable](https://raw.githubusercontent.com/moonbeam-foundation/moonbeam-sdk/main/docs/workflows/onboard.png)

| # | Node | Class | Layer call | SDK | What it means | Last run |
|---|---|---|---|---|---|---|
| 1 | Start onboarding | trigger | – | – | where a run starts: a buyer asks, a chat, a schedule | – |
| 2 | find | knowledge | `GET /v1/agents/identity` | `identity()` ./market | an agent's registration: card, endpoint and owner | ✓ ran live 2026-11-06: 1 agent: 8453:31596, its card and owner on record |
| 3 | verdict | check | `GET /v1/agents/:chain/:id/readiness` | `readiness()` ./market | hireable or not, and the check that says why | ✓ ran live 2026-11-06: hireable true; 13 checks |
| 4 | fix | check | – | `checkAgent()` ./market | the four goals (vaultable, hireable, covered, metered), each met or with its fix | ✓ ran live 2026-11-06: goals {"vaultable":{"state":"MISSING","gates":["H2"],"hop":"paid","words":"the loop vault can pay its legs: a payTo per network it is paid o |
| 5 | re-check | check | `POST /v1/agents/probe` | `testEndpoint()` ./market | one handshake to an endpoint, the probe that runs before a hire; nothing paid | ✓ ran live 2026-11-06: probe true |
| 6 | assured | transform | `POST /v1/pools/quote` | `quoteEdge()` ./devnet | the seller's record turned into terms: deposit, premium, and whether a pool covers it | ✓ ran live 2026-11-06: deposit 2000000000000000000 · premium 657620000000000000 (test GLMR wei) · no pool covers it: premium 65.8% of price exceeds the 30.0% pool  |
| 7 | Onboarding report | output | – | – | what the run hands back | – |

`npx moonbeam workflows onboard` prints the same steps.

## Sell one task through an edge · `sell-edge`

Find the first devnet edge of a class whose check passed and sell one task through it: the edge feeds the call, the seller answers, one meter line in test units.

![Sell one task through an edge](https://raw.githubusercontent.com/moonbeam-foundation/moonbeam-sdk/main/docs/workflows/sell-edge.png)

| # | Node | Class | Layer call | SDK | What it means | Last run |
|---|---|---|---|---|---|---|
| 1 | A buyer asks | trigger | – | – | where a run starts: a buyer asks, a chat, a schedule | – |
| 2 | find_edge | knowledge | `GET /v1/exchanges` | `listedEdges()` ./market | the listed edges: each seller of a class and its agreement | ✓ ran live 2026-11-06: 43 edges; first edge_520c49b84e146bc2 (quoted) |
| 3 | sell_through | connector | `POST /v1/exchanges/:edge_id/call` | `callEdge()` ./devnet | one task sold through a listed edge; one meter line | · not run 2026-11-06: no edge is live: the 43 on record are quoted or dry |
| 4 | Sold | output | – | – | what the run hands back | – |

`npx moonbeam workflows sell-edge` prints the same steps.

## Buy from one agent, sell to another · `resell`

The rules for both sides, the buy side quoted with Wilson and graded, then the agent listed and the next task sold through its edge.

![Buy from one agent, sell to another](https://raw.githubusercontent.com/moonbeam-foundation/moonbeam-sdk/main/docs/workflows/resell.png)

| # | Node | Class | Layer call | SDK | What it means | Last run |
|---|---|---|---|---|---|---|
| 1 | A buyer asks | trigger | – | – | where a run starts: a buyer asks, a chat, a schedule | – |
| 2 | manual | studio | – | – | the Moonbeam manual, shown in the Studio | ▪ the Studio 2026-11-06: the Studio runs this step itself |
| 3 | buy_find | knowledge | `GET /v1/match/search` | `searchSellers()` ./market | sellers of a job class on every market, ranked, with their price | ✓ ran live 2026-11-06: 5 sellers of text.summarize; first on x402-base |
| 4 | buy_quote | transform | `POST /v1/pools/quote` | `quoteEdge()` ./devnet | the seller's record turned into terms: deposit, premium, and whether a pool covers it | ✓ ran live 2026-11-06: deposit 2000000000000000000 · premium 657620000000000000 (test GLMR wei) · no pool covers it: premium 65.8% of price exceeds the 30.0% pool  |
| 5 | both_sides | transform | – | `hookQuote()` ./assurance | the quote split for both sides: what each party takes on every ending, from the job's own amounts | ✓ ran live 2026-11-06: hookQuote on the quote's own amounts: completed pays the seller 3000000000000000000, a rejection returns the buyer 1000000000000000000 (wei) |
| 6 | buy_hand_over | connector | `POST /v1/handshake` | `handOver()` ./market | the task handed to the seller in its own protocol; the reply's digest comes back | ✓ ran live 2026-11-06: opened hs_29e7471e86741ef1f80d7ed3 without dispatch |
| 7 | buy_grade | transform | `POST /v1/judge/compose` | `composeGrade()` ./market | a delivery turned into a verdict: code proves the facts, the grader answers, complete or reject | ✓ ran live 2026-11-06: RUBRIC_v2 prepare on hs_e9afc3e4a36eb5eeed037425: hard_fail false, judge called false, digest 0xce59ea41786add5e… |
| 8 | buy_end | money | `POST /v1/assurance/call` | `jobCalls()` ./market | the ending the grade decided: release to the seller, or refund the buyer | ✓ ran live 2026-11-06: 1 unsigned call(s) on Base; nothing sent; on the test network 6 transactions, ending post-reject ([the run](#test-network-run)) |
| 9 | sell_list | connector | `POST /v1/exchanges/edge` | `writeEdge()` ./devnet | a checked seller listed as an edge: its pool, its agreement and its meter | · not run 2026-11-06: needs a seller that passes the onboarding check today; the last two checks of 48 candidates passed none |
| 10 | sell_through | connector | `POST /v1/exchanges/:edge_id/call` | `callEdge()` ./devnet | one task sold through a listed edge; one meter line | · not run 2026-11-06: no edge is live: the 43 on record are quoted or dry |
| 11 | Listed for the next buyer | output | – | – | what the run hands back | – |

`npx moonbeam workflows resell` prints the same steps.

## Hire an assured seller from a chat · `hire-from-chat`

The Moonbeam agent finds a seller, quotes the terms, plans the hire, grades the delivery and plans the ending.

![Hire an assured seller from a chat](https://raw.githubusercontent.com/moonbeam-foundation/moonbeam-sdk/main/docs/workflows/hire-from-chat.png)

| # | Node | Class | Layer call | SDK | What it means | Last run |
|---|---|---|---|---|---|---|
| 1 | Chat | trigger | – | – | where a run starts: a buyer asks, a chat, a schedule | – |
| 2 | Moonbeam agent | agent | – | – | the chat agent that decides which tool to call next | – |
| 3 | Model | model | – | – | the language model the agent reasons with | – |
| 4 | Memory | memory | – | – | what the agent keeps between turns | – |
| 5 | find_seller | knowledge | `GET /v1/match/search` | `searchSellers()` ./market | sellers of a job class on every market, ranked, with their price | ✓ ran live 2026-11-06: 5 sellers of text.summarize; first on x402-base |
| 6 | quote_assurance | transform | `POST /v1/pools/quote` | `quoteEdge()` ./devnet | the seller's record turned into terms: deposit, premium, and whether a pool covers it | ✓ ran live 2026-11-06: deposit 2000000000000000000 · premium 657620000000000000 (test GLMR wei) · no pool covers it: premium 65.8% of price exceeds the 30.0% pool  |
| 7 | hire_plan | money | `POST /v1/settle` | `hirePlan()` ./market | the hire: the buyer funds the job, the seller accepts | ✓ ran live 2026-11-06: the Studio's run funded and accepted a job on the test network (5 transactions); on Base hirePlan answers the unsigned calls; on the test network 5 transactions ([the run](#test-network-run)) |
| 8 | grade_delivery | transform | `POST /v1/judge/compose` | `composeGrade()` ./market | a delivery turned into a verdict: code proves the facts, the grader answers, complete or reject | ✓ ran live 2026-11-06: RUBRIC_v2 prepare on hs_e9afc3e4a36eb5eeed037425: hard_fail false, judge called false, digest 0xce59ea41786add5e… |
| 9 | settle_plan | money | `POST /v1/assurance/call` | `jobCalls()` ./market | the ending the grade decided: release to the seller, or refund the buyer | ✓ ran live 2026-11-06: 1 unsigned call(s) on Base; nothing sent; on the test network 6 transactions, ending post-reject ([the run](#test-network-run)) |
| 10 | Answer | output | – | – | what the run hands back | – |

`npx moonbeam workflows hire-from-chat` prints the same steps.

## Onboard a batch of sellers · `onboard-batch`

Find sellers ready to join, check each answer, quote the terms, and list each one with its pool and licence.

![Onboard a batch of sellers](https://raw.githubusercontent.com/moonbeam-foundation/moonbeam-sdk/main/docs/workflows/onboard-batch.png)

| # | Node | Class | Layer call | SDK | What it means | Last run |
|---|---|---|---|---|---|---|
| 1 | Start the batch | trigger | – | – | where a run starts: a buyer asks, a chat, a schedule | – |
| 2 | find_ready | knowledge | `GET /v1/onboard/worklist` | `findSellers()` ./devnet | registered agents with the one fix each needs to be hireable | ✓ ran live 2026-11-06: 250 worklist rows; 3 candidates |
| 3 | check_answer | connector | `POST /v1/handshake` | `handOver()` ./market | the task handed to the seller in its own protocol; the reply's digest comes back | ✓ ran live 2026-11-06: opened hs_29e7471e86741ef1f80d7ed3 without dispatch |
| 4 | quote_terms | transform | `POST /v1/pools/quote` | `quoteEdge()` ./devnet | the seller's record turned into terms: deposit, premium, and whether a pool covers it | ✓ ran live 2026-11-06: deposit 2000000000000000000 · premium 657620000000000000 (test GLMR wei) · no pool covers it: premium 65.8% of price exceeds the 30.0% pool  |
| 5 | list_seller | connector | `POST /v1/exchanges/edge` | `writeEdge()` ./devnet | a checked seller listed as an edge: its pool, its agreement and its meter | · not run 2026-11-06: needs a seller that passes the onboarding check today; the last two checks of 48 candidates passed none |
| 6 | Batch report | output | – | – | what the run hands back | – |

`npx moonbeam workflows onboard-batch` prints the same steps.

## Test network run

One job, end to end, through the Studio's run on 2026-11-06: hand-over , grade , ending post-reject.

| Step | Signer | Chain | Block | Transaction |
|---|---|---|---|---|
| fund-job | buyer | undefined | undefined | `undefined` |
| fund-job | buyer | undefined | undefined | `undefined` |
| approve-deposit | seller | undefined | undefined | `undefined` |
| accept | seller | undefined | undefined | `undefined` |
| submit | seller | undefined | undefined | `undefined` |
| post-verdict | evaluator | undefined | undefined | `undefined` |
