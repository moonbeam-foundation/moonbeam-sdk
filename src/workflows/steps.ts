/**
 * What each node of a Moonbeam workflow is: its class, what it means, who may run it, the markets it applies to, and the SDK
 * calls that run it on Base and on the test network. One table, keyed by the layer call the node makes; a test holds it complete
 * against the Studio's workflows.
 */

/** The classes of a node, by what it does to the world. */
export const NODE_CLASSES = Object.freeze({
  trigger: 'where a run starts: a buyer asks, a chat, a schedule',
  agent: 'the chat agent that decides which tool to call next',
  model: 'the language model the agent reasons with',
  memory: 'what the agent keeps between turns',
  knowledge: 'reads the graph the layer keeps (sellers, buyers, markets, jobs, agents); nothing is written',
  check: 'asks a live agent, or the layer, whether something holds; nothing is paid',
  transform: 'turns what was read into terms or a market\'s own format: a quote, a grade, a listing\'s export, a card',
  connector: 'hands work or a listing to a market in that market\'s own protocol',
  money: 'moves money: answers unsigned calls in order and names who signs each; nothing here signs',
  studio: 'a step the Moonbeam Studio runs itself (its document, your pages, its manual)',
  output: 'what the run hands back',
} as const);
export type NodeClass = keyof typeof NODE_CLASSES;

/** The markets a node can touch. `all` = every market the layer reads. */
export type Market = 'all' | 'x402' | 'mcp' | 'a2a' | 'virtuals' | 'bitagent' | 'olas' | 'erc8004' | 'near' | 'moonbeam';
/** Who may run a node: anyone, a Moonbeam key, a key on a plan, or only on the test network. */
export type Access = 'public' | 'key' | 'plan' | 'testnet';

type Fn = { module: 'market' | 'devnet' | 'judge' | 'resale' | 'assurance'; fn: string };
export type StepInfo = {
  class: NodeClass;
  means: string;
  access: Access;
  markets: readonly Market[];
  /** the SDK call that runs this step on Base (null: the step is the Studio's own) */
  base: Fn | null;
  /** the SDK call that runs it end to end on the test network, when it differs */
  testnet?: Fn;
  signer?: 'buyer' | 'seller' | 'evaluator';
};

const m = (fn: string): Fn => ({ module: 'market', fn });
const d = (fn: string): Fn => ({ module: 'devnet', fn });

/** Every layer call a Studio workflow makes. Keys are the node's `op`. */
export const STEPS: Readonly<Record<string, StepInfo>> = Object.freeze({
  'GET /v1/match/search': { class: 'knowledge', means: 'sellers of a job class on every market, ranked, with their price', access: 'public', markets: ['all'], base: m('searchSellers') },
  'GET /v1/match/demands': { class: 'knowledge', means: 'the markets whose buyers paid for a job class this week', access: 'key', markets: ['x402', 'virtuals', 'bitagent', 'olas'], base: m('findBuyers') },
  'GET /v1/venues/:id': { class: 'knowledge', means: 'one market: its week of money, buyers, top jobs and admitted sellers', access: 'public', markets: ['all'], base: m('market') },
  'GET /v1/settle/:id': { class: 'knowledge', means: 'one hire\'s record: its plan, its grade and its ending', access: 'public', markets: ['moonbeam'], base: m('jobRecord') },
  'GET /v1/exchanges': { class: 'knowledge', means: 'the listed edges: each seller of a class and its agreement', access: 'public', markets: ['moonbeam'], base: m('listedEdges') },
  'GET /v1/agents/identity': { class: 'knowledge', means: 'an agent\'s registration: card, endpoint and owner', access: 'public', markets: ['erc8004'], base: m('identity') },
  'GET /v1/onboard/worklist': { class: 'knowledge', means: 'registered agents with the one fix each needs to be hireable', access: 'public', markets: ['erc8004'], base: d('findSellers') },
  'GET /v1/agents/:chain/:id/readiness': { class: 'check', means: 'hireable or not, and the check that says why', access: 'public', markets: ['erc8004', 'moonbeam'], base: m('readiness') },
  'POST /v1/agents/probe': { class: 'check', means: 'one handshake to an endpoint, the probe that runs before a hire; nothing paid', access: 'key', markets: ['mcp', 'a2a'], base: m('testEndpoint') },
  'pure:onboard.fix': { class: 'check', means: 'the four goals (vaultable, hireable, covered, metered), each met or with its fix', access: 'key', markets: ['erc8004', 'moonbeam'], base: m('checkAgent') },
  'POST /v1/pools/quote': { class: 'transform', means: 'the seller\'s record turned into terms: deposit, premium, and whether a pool covers it', access: 'public', markets: ['moonbeam'], base: d('quoteEdge') },
  'POST /v1/judge/compose': { class: 'transform', means: 'a delivery turned into a verdict: code proves the facts, the grader answers, complete or reject', access: 'key', markets: ['all'], base: m('composeGrade') },
  'pure:wilson.sides': { class: 'transform', means: 'the quote split for both sides: what each party takes on every ending, from the job\'s own amounts', access: 'public', markets: ['moonbeam'], base: { module: 'assurance', fn: 'hookQuote' } },
  'POST /v1/handshake': { class: 'connector', means: 'the task handed to the seller in its own protocol; the reply\'s digest comes back', access: 'key', markets: ['mcp', 'a2a'], base: m('handOver') },
  'POST /v1/exchanges/edge': { class: 'connector', means: 'a checked seller listed as an edge: its pool, its agreement and its meter', access: 'testnet', markets: ['moonbeam'], base: d('writeEdge') },
  'POST /v1/exchanges/:edge_id/call': { class: 'connector', means: 'one task sold through a listed edge; one meter line', access: 'testnet', markets: ['moonbeam'], base: d('callEdge') },
  'POST /v1/settle': { class: 'money', means: 'the hire: the buyer funds the job, the seller accepts', access: 'key', markets: ['moonbeam'], base: m('hirePlan'), testnet: d('hire'), signer: 'buyer' },
  'POST /v1/assurance/call': { class: 'money', means: 'the ending the grade decided: release to the seller, or refund the buyer', access: 'key', markets: ['moonbeam'], base: m('jobCalls'), testnet: d('settle'), signer: 'evaluator' },
  // List my business: the ten modules, each with the call under it
  'pure:business.workflow': { class: 'studio', means: 'the run, saved in the Studio, that a team leaves and resumes', access: 'public', markets: [], base: null },
  'pure:business.read': { class: 'studio', means: 'your own pages, read and confirmed in your words', access: 'public', markets: [], base: null },
  'pure:business.claim': { class: 'studio', means: 'one line on your own host that proves the name is yours, read back', access: 'public', markets: [], base: null },
  'pure:business.door': { class: 'check', means: 'your door answers a real call of its class, on your own key', access: 'key', markets: ['mcp', 'a2a'], base: m('testEndpoint') },
  'pure:business.publish': { class: 'connector', means: 'one record on the layer, then one graded task per job: each job it passes is sold', access: 'key', markets: ['all'], base: m('publishListing') },
  'pure:business.reach': { class: 'transform', means: 'the record in each market\'s own format: what x402, MCP, ERC-8004, NEAR and Olas each need', access: 'key', markets: ['x402', 'mcp', 'a2a', 'erc8004', 'near', 'olas'], base: m('readListing') },
  'pure:business.pay': { class: 'knowledge', means: 'a sale and the seller\'s payout, read from the sale record', access: 'key', markets: ['all'], base: { module: 'resale', fn: 'readSale' } },
  'pure:business.keep': { class: 'knowledge', means: 'rank, price and differences per market, until you publish again', access: 'key', markets: ['all'], base: m('readListing') },
  'pure:business.seen': { class: 'transform', means: 'the public card buyers and markets read, and the badge for your pages', access: 'public', markets: ['all'], base: m('listingCard') },
  'pure:business.plan': { class: 'knowledge', means: 'your plan, its days left and its allowance', access: 'key', markets: [], base: m('keyStanding') },
  'pure:manual': { class: 'studio', means: 'the Moonbeam manual, shown in the Studio', access: 'public', markets: [], base: null },
});

/** The class of a node from its role and its call. */
export function classOf(n: { role: string | null; op: string | null }): NodeClass {
  if (n.op && STEPS[n.op]) return STEPS[n.op]!.class;
  const r = n.role ?? '';
  return (['trigger', 'agent', 'model', 'memory', 'output'] as const).find((x) => x === r) ?? 'studio';
}
