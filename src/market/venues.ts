// EVERY VENUE, ONE TABLE: the ten markets the Moonbeam product sells on, what a seller does on each (list, take a job, settle,
// get paid), how it is listed there, the SDK call for each step, and each step's state as the product's market register reads it.
// The states are never set here: they come from the register's snapshot (venues-data.ts, scripts/gen-venues.mjs), mapped one way:
//   live → live · partial → partial · self_test → self-test · claimed, contradicted → not yet · none (the market has no such step) → n/a
import type { OnboardTransport } from '../onboard/index.js';
import { VENUE_REGISTER } from './venues-data.js';
import { listStatus, type ListMarket, type ListRow } from './journey.js';
import { markets } from './index.js';

/** A step's state, said plainly: it runs for outside money (live), in part, only with Moonbeam on both sides (self-test), not yet, or the market has no such step (n/a). */
export type VenueState = 'live' | 'partial' | 'self-test' | 'not yet' | 'n/a';
/** The register's own words for a step, kept as read. */
export type RegisterWord = 'live' | 'partial' | 'self_test' | 'claimed' | 'contradicted' | 'none' | 'proven' | (string & {});
/** What a seller does on a market. */
export type VenueStep = 'list' | 'take' | 'settle' | 'paid';
export const VENUE_STEPS: readonly VenueStep[] = Object.freeze(['list', 'take', 'settle', 'paid']);
/** An SDK call by its module and export, e.g. `market.listOn`, `jobs.readJobs`. */
export type SdkCall = `${'market' | 'jobs' | 'resale'}.${string}`;

export type RegisterStep = { register: RegisterWord; proof: RegisterWord; says: string | null; read_on: string | null };
export type RegisterMarket = { id: string; entry: { cost: string; done: boolean; what: string | null }; list: RegisterStep; take: RegisterStep; settle: RegisterStep; paid: { proof: RegisterWord; says: string; read_on: string } | null };
export type RegisterSnapshot = { source: string | null; read_on: string | null; markets: RegisterMarket[] };

export const VENUE_IDS = Object.freeze(['x402-base', 'erc8183-base', 'memoacp-base', 'bitagent-base', 'olas-base', 'near-agent-market', 'a2a', 'mcp', 'erc8004', 'workflow-nodes'] as const);
export type VenueId = (typeof VENUE_IDS)[number];
/** How a seller's agent gets onto the market: the one list step (`listOn`), an account on the venue, or a registry the market reads. */
export type ListedBy = 'list-step' | 'venue-account' | 'registry';

/** One step of one venue: its state, the register's words and proof, the date it was read, and the one SDK call that does or reads it. */
export type VenueStepRow = { state: VenueState; register: RegisterWord; says: string | null; read_on: string | null; call: SdkCall | null };
export type Venue = {
  id: VenueId;
  name: string;
  /** the id `markets()` / `market(t, id)` name it by (GET /venues), when the layer reads its money */
  marketId: string | null;
  /** what a seller does there, in one line */
  does: string;
  listedBy: ListedBy;
  /** how it is listed there, in words */
  howListed: string;
  /** what entering it costs, as the register reads it */
  entry: { cost: string; done: boolean };
  list: VenueStepRow; take: VenueStepRow; settle: VenueStepRow; paid: VenueStepRow;
};

type Static = Omit<Venue, 'entry' | VenueStep> & { calls: Record<VenueStep, SdkCall | null>; na?: Partial<Record<VenueStep, string>> };
const S: Record<VenueId, Static> = {
  'x402-base': { id: 'x402-base', name: 'x402', marketId: 'x402', listedBy: 'registry',
    does: 'Buyers pay per call in USDC on Base; each paid task is handed to your agent and settled through the facilitator.',
    howListed: 'Your listing sells through the class wall of its job class. The Bazaar indexes a wall after its first paid call; x402scan, Ultravioleta and PayAI list it too.',
    calls: { list: 'market.publishListing', take: 'market.handOver', settle: 'market.agentSales', paid: 'market.agentSales' } },
  'erc8183-base': { id: 'erc8183-base', name: 'Virtuals ACP (ERC-8183 jobs)', marketId: 'erc8183', listedBy: 'venue-account',
    does: 'A buyer opens an ERC-8183 job with a budget; the provider delivers, the evaluator completes or rejects, the contract pays.',
    howListed: 'Resold through Moonbeam\'s own seller account on Virtuals: your published listing is one of its offerings.',
    calls: { list: 'market.publishListing', take: 'jobs.readJobs', settle: 'market.jobCalls', paid: 'jobs.readJobs' } },
  'memoacp-base': { id: 'memoacp-base', name: 'Virtuals memo jobs (memo-ACP)', marketId: 'virtuals', listedBy: 'venue-account',
    does: 'A buyer and a provider move a job by memos through the Virtuals router; the router pays on the last memo.',
    howListed: 'The same Virtuals account; a record in the memo router\'s registry is the step still open.',
    calls: { list: 'market.publishListing', take: 'jobs.readJobs', settle: 'market.jobCalls', paid: 'jobs.readJobs' } },
  'bitagent-base': { id: 'bitagent-base', name: 'BitAgent', marketId: 'bitagent', listedBy: 'venue-account',
    does: 'ERC-8183 jobs on BitAgent\'s own contract on Base.',
    howListed: 'An agent registered on BitAgent (an account on the venue), resold through Moonbeam\'s own seller.',
    calls: { list: 'market.publishListing', take: 'jobs.readJobs', settle: 'market.jobCalls', paid: 'jobs.readJobs' } },
  'olas-base': { id: 'olas-base', name: 'Olas Mech', marketId: 'olas', listedBy: 'venue-account',
    does: 'A requester pays a mech on Base for one request; the mech delivers its answer on chain.',
    howListed: 'An Olas service registered from your own wallet (a bond and gas): `readListing().export.olas` holds its service, mech and worker.',
    calls: { list: 'market.readListing', take: 'market.olasRequest', settle: 'market.olasRequest', paid: 'market.olasRequest' } },
  'near-agent-market': { id: 'near-agent-market', name: 'NEAR AI Agent Market', marketId: null, listedBy: 'venue-account',
    does: 'Buyers find an agent by category and its own words, and hire it over A2A.',
    howListed: 'Your own account on market.near.ai: `readListing().export.near` is the registration to send.',
    calls: { list: 'market.readListing', take: 'market.handOver', settle: null, paid: null } },
  a2a: { id: 'a2a', name: 'A2A Registry', marketId: null, listedBy: 'list-step',
    does: 'A directory of A2A agent cards; buyers call the agent at its card\'s endpoint.',
    howListed: 'The list step: the layer serves the agent\'s A2A card and publishes it to the registry.',
    calls: { list: 'market.listOn', take: 'market.handOver', settle: null, paid: 'market.agentSales' }, na: { settle: 'a directory has no settlement step' } },
  mcp: { id: 'mcp', name: 'MCP Registry', marketId: null, listedBy: 'list-step',
    does: 'The official MCP Registry and its mirrors (Glama, PulseMCP); clients call the agent\'s MCP door.',
    howListed: 'The list step: the layer serves the agent\'s MCP door and publishes it to the official registry.',
    calls: { list: 'market.listOn', take: 'market.handOver', settle: null, paid: 'market.agentSales' }, na: { settle: 'a registry has no settlement step' } },
  erc8004: { id: 'erc8004', name: 'ERC-8004', marketId: null, listedBy: 'list-step',
    does: 'The identity registry on Base every other market reads: the agent\'s id, card and endpoint.',
    howListed: 'The list step records it; for an id your own wallet owns, `register8004Calls` builds `register(agentURI)` for you to sign.',
    calls: { list: 'market.listOn', take: null, settle: null, paid: null }, na: { take: 'an identity registry takes no hire', settle: 'an identity registry settles nothing', paid: 'an identity registry pays nothing' } },
  'workflow-nodes': { id: 'workflow-nodes', name: 'Workflow nodes (npm)', marketId: null, listedBy: 'registry',
    does: 'Workflow builders add the agent as a node; each node runs the same calls as this SDK (`./workflows`).',
    howListed: 'A node package on npm; the node directory lists it after its review.',
    calls: { list: null, take: null, settle: null, paid: null }, na: { settle: 'a workflow node has no settlement of its own', paid: 'a workflow node has no payout of its own' } },
};

const WORD: Record<string, VenueState> = { live: 'live', proven: 'live', partial: 'partial', self_test: 'self-test', claimed: 'not yet', contradicted: 'not yet', none: 'n/a' };
const stateOf = (w: RegisterWord): VenueState => WORD[w] ?? 'not yet';

function venueOf(s: Static, r: RegisterMarket): Venue {
  const row = (k: VenueStep): VenueStepRow => {
    const reg: RegisterStep = k === 'paid' ? (r.paid ? { register: r.paid.proof, proof: r.paid.proof, says: r.paid.says, read_on: r.paid.read_on } : { register: 'none', proof: 'none', says: null, read_on: null }) : r[k];
    const na = s.na?.[k];
    // n/a only where the market has no such step: the register says none, or the table names why
    const state: VenueState = na ? 'n/a' : k === 'paid' && !r.paid ? 'not yet' : stateOf(reg.register);
    return { state, register: reg.register, says: reg.says ?? na ?? null, read_on: reg.read_on, call: state === 'n/a' ? null : s.calls[k] };
  };
  const { calls: _c, na: _n, ...v } = s;
  return { ...v, entry: { cost: r.entry.cost, done: r.entry.done }, list: row('list'), take: row('take'), settle: row('settle'), paid: row('paid') };
}

/** Every venue, as shipped: the register's states and the date it was read (`VENUES_READ_ON`). */
export const VENUES: readonly Venue[] = Object.freeze(VENUE_IDS.map((id) => {
  const r = VENUE_REGISTER.markets.find((m) => m.id === id);
  if (!r) throw new Error(`the register snapshot has no market ${id}`);
  return Object.freeze(venueOf(S[id], r));
}));
/** The date the register's snapshot was read. */
export const VENUES_READ_ON: string | null = VENUE_REGISTER.read_on;
/** One venue by its id. */
export const venueById = (id: string): Venue | null => VENUES.find((v) => v.id === id) ?? null;

const LIST_MARKET_OF: Partial<Record<VenueId, ListMarket>> = { erc8004: 'erc8004', mcp: 'mcp_registry', a2a: 'a2a_registry' };
/** A venue with what the layer answers now: the market's own read (its status and its week of money), and one agent's list step. */
export type VenueLive = Venue & { market?: { name: string | null; status: string | null; usd_7d: number | null }; agentListing?: ListRow | null };

/**
 * Every venue. Without a transport, the shipped table and the date its register was read. With one, the layer's reads are folded
 * in where a route exists: each market's own status and its week of money (`GET /venues`), and with `agent` (`8453:<id>`) where
 * that agent stands on the three markets of the list step (`GET /list/:id`). A read that fails is named in `unread`, and the
 * shipped table answers for it. The states themselves are the register's: a live read never upgrades one.
 */
export async function venues(t?: OnboardTransport, o: { agent?: string } = {}): Promise<{ venues: VenueLive[]; readOn: string | null; readAt: string | null; unread: string[] }> {
  const rows: VenueLive[] = VENUES.map((v) => ({ ...v }));
  const unread: string[] = [];
  let readAt: string | null = null;
  if (!t) return { venues: rows, readOn: VENUES_READ_ON, readAt, unread };
  const [m, l] = await Promise.allSettled([markets(t), o.agent ? listStatus(t, o.agent) : Promise.resolve(undefined)]);
  if (m.status === 'fulfilled') {
    readAt = m.value.readAt;
    for (const r of rows) {
      const x = r.marketId ? m.value.markets.find((y) => y['id'] === r.marketId) : undefined;
      if (x) r.market = { name: typeof x['name'] === 'string' ? x['name'] : null, status: typeof x['status'] === 'string' ? x['status'] : null, usd_7d: typeof x['usd_7d'] === 'number' ? x['usd_7d'] : null };
    }
  } else unread.push(`GET /venues: ${(m.reason as Error)?.message ?? 'no answer'}`);
  if (o.agent) {
    if (l.status === 'fulfilled') for (const r of rows) { const k = LIST_MARKET_OF[r.id]; if (k) r.agentListing = l.value ? l.value.markets[k] ?? null : null; }
    else unread.push(`GET /list/:id: ${(l.reason as Error)?.message ?? 'no answer'}`);
  }
  return { venues: rows, readOn: VENUES_READ_ON, readAt, unread };
}
