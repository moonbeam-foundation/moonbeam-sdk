// WHERE AN AGENT IS LISTED, AND THE PLAN TO LIST IT. Two reads, nothing signed, nothing paid:
//   journey(t, ref)                 GET /listed?agent=<ref>&view=journey   listed.journey.v1: one agent on every venue, its standing,
//                                                                          five LEDs (offer, hire, list, read back, paid), each with why,
//                                                                          its evidence and what would move it, and the one next step
//   list(t, { venue, agent, custom })   the market's own public read of the agent   genie.list.virtuals.v1: the listing's steps as
//                                                                          they stand, its offerings, and the one item a person must do
// `list` is read and plan only. It never asks for a signer, registers, shows an offering or approves anything: the Moonbeam
// Studio's list step runs those. A `human` item is returned for whoever holds the venue account, never acted on.
import type { OnboardTransport } from '../onboard/index.js';
import { jsonOf } from '../errors/index.js';
import { MarketError, call, query } from './http.js';
import { VENUE_IDS, type VenueId } from './venues.js';
import { keyedFetch } from '../core/keyed.js';

// ── journey ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export const JOURNEY_SCHEMA = 'listed.journey.v1';
/** The five LEDs of an agent on a venue: its offer is up, a buyer can hire it, it is listed, the listing reads back, it was paid. */
export const JOURNEY_LEDS = Object.freeze(['offer', 'hire', 'list', 'read_back', 'paid'] as const);
export type JourneyLed = (typeof JOURNEY_LEDS)[number];
/** An LED's state. `unread`: the read behind it did not answer, so it is neither on nor off. */
export type LedState = 'on' | 'partial' | 'off' | 'unread';
/** Where the agent stands on a venue. */
export type JourneyStanding = 'listed_by_owner' | 'listed_by_moonbeam' | 'listable' | 'not_yet' | 'closed' | 'unread';
/** The next step's kind. */
export type JourneyAct = 'list' | 'probe' | 'hire' | 'paid' | 'improve' | 'reread' | 'identity' | 'none';
/** One read behind an LED: its kind, what it read, and when. */
export type JourneyEvidence = { kind: string; ref: string; read_at: string | null };
/** One LED: its state, one plain line on why, the reads that lit it (an LED is on only with one), and what would move it. */
export type JourneyLight = { state: LedState; why: string; evidence: JourneyEvidence[]; moves_when: string };
/** The numbered steps a person takes on a venue, only where no machine path exists; the last step is the venue's own URL. */
export type JourneyHuman = { where: string; steps: string[]; url: string; why: string };
export type JourneyPrefill = { ref: string; class: string | null; resource: string | null; venue: string; step: string };
/** The one next step: in the Studio, by the machine, by a person (with numbered steps), or none. */
export type JourneyNext = {
  by: 'studio' | 'genie' | 'human' | 'none';
  act: JourneyAct;
  studio?: { step: string; chat?: string; label: string; prefill: JourneyPrefill };
  genie?: { op: string; prefill: JourneyPrefill };
  human?: JourneyHuman;
  why: string;
};
/** The agent on one venue. `agent_paid_7d` is the agent's own money there; `market` is everyone's money on that venue. */
export type JourneyVenue = {
  [k: string]: unknown;
  venue_id: VenueId;
  venue: string;
  mark: string;
  leds: Record<JourneyLed, JourneyLight>;
  standing: JourneyStanding;
  proof?: { kind: string; url: string | null; ref?: string; read_at: string | null };
  agent_paid_7d?: { usd: number | null; buyers: number | null; jobs?: number | null; window: '7d'; from: 'board_row' | 'seller_profile'; read_at: string | null };
  market?: { usd_7d: number | null; payments_7d: number | null; buyers_7d: number | null; sellers: number | null; class_usd_7d?: number; from: 'venue_sides'; read_at: string | null };
  next: JourneyNext;
  why: string;
  flags?: string[];
};
/** listed.journey.v1, with the venues keyed by id: every venue of `VENUE_IDS` is there, or the read is refused. */
export type Journey = {
  schema: typeof JOURNEY_SCHEMA;
  agent: { ref: string; name: string; kind: 'outside' | 'house'; class: string | null; host?: string; page?: { state: string; read_at: string | null } };
  read_at: string;
  headline: { text: string | null; from: '402' | 'class' | 'unread'; resource: string | null; class: string | null; class_mismatch: string[] | 'unread' };
  /** the class probe and the grade after it; no grade is on before the probe */
  checks: Record<'probe' | 'grade', JourneyLight>;
  venues: Record<VenueId, JourneyVenue>;
  /** the reads the answer was made from, each ok, unread or kept (the last good read stands) */
  reads: { kind: string; state: 'ok' | 'unread' | 'kept'; read_at: string | null; why?: string }[];
  /** what could not be read, in words */
  unread: string[];
  /** venue ids the answer holds that this SDK does not know yet (their rows stay in `body`) */
  extra: string[];
  body: Record<string, unknown>;
};

/** The refs a journey takes: an agent's ERC-8004 id (`8453:<id>` or `erc8004:<chain>:<id>`), or its row on a market's board. */
const JOURNEY_REF = /^(?:(?:x402|virtuals|bitagent|near|olas):[0-9a-f]{12}|x402:host:[a-z0-9.-]{3,253}|(?:erc8004:)?\d{1,10}:\d{1,12})$/;

/**
 * One agent on every venue (`GET /listed?agent=<ref>&view=journey`): where it stands, its five LEDs with why, evidence and
 * what would move each, and the one next step (a Studio step, a machine step, or a person's numbered steps where no machine
 * path exists). Public. A ref is `8453:<ERC-8004 id>`, `erc8004:<chain>:<id>`, or a board row (`x402:<12 hex>`, `x402:host:<host>`,
 * `virtuals:`, `bitagent:`, `near:`, `olas:` + 12 hex).
 */
export async function journey(t: OnboardTransport, ref: string): Promise<Journey> {
  const r = String(ref ?? '').trim();
  if (!JOURNEY_REF.test(r)) throw new RangeError(`not an agent ref: ${ref} (8453:<id>, erc8004:<chain>:<id>, x402:<12 hex>, x402:host:<host>, or virtuals: / bitagent: / near: / olas: + 12 hex)`);
  const what = 'GET /listed?view=journey';
  const j = await call<Record<string, unknown>>(t, 'GET', `/listed${query({ agent: r, view: 'journey' })}`);
  return journeyOf(j, what);
}

/** A listed.journey.v1 body as the typed answer, its venues keyed by id. Pure; throws a MarketError when the body breaks the schema. */
export function journeyOf(j: Record<string, unknown>, what = 'listed.journey.v1'): Journey {
  const rows = j['venues'];
  if (j['schema'] !== JOURNEY_SCHEMA || !Array.isArray(rows) || !j['agent'] || !j['checks']) throw new MarketError(502, what, { ok: false, code: 'bad_answer', error: `${what} did not answer ${JOURNEY_SCHEMA}` });
  const by = new Map((rows as JourneyVenue[]).map((v) => [v.venue_id, v]));
  const missing = VENUE_IDS.filter((id) => !by.has(id) || !by.get(id)?.leds);
  if (missing.length) throw new MarketError(502, what, { ok: false, code: 'bad_answer', error: `${what} has no row for ${missing.join(', ')}` });
  const venues = Object.fromEntries(VENUE_IDS.map((id) => [id, by.get(id)!])) as Record<VenueId, JourneyVenue>;
  return {
    schema: JOURNEY_SCHEMA,
    agent: j['agent'] as Journey['agent'],
    read_at: String(j['read_at'] ?? ''),
    headline: j['headline'] as Journey['headline'],
    checks: j['checks'] as Journey['checks'],
    venues,
    reads: Array.isArray(j['reads']) ? (j['reads'] as Journey['reads']) : [],
    unread: Array.isArray(j['unread']) ? (j['unread'] as string[]) : [],
    extra: [...by.keys()].filter((id) => !(VENUE_IDS as readonly string[]).includes(id)),
    body: j,
  };
}

// ── list ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const LIST_SCHEMA = 'genie.list.virtuals.v1';
/** The venues `list` plans a listing on: Virtuals ACP. Every other venue's next step is in `journey(t, ref).venues[id].next`. */
export const LIST_VENUES = Object.freeze(['erc8183-base'] as const);
export type ListVenue = (typeof LIST_VENUES)[number];
/** The steps of a Virtuals ACP listing, in the order the Studio's list step runs them. */
export const LIST_STEPS = Object.freeze(['agent', 'signer', 'register', 'seller', 'offerings', 'readback'] as const);
export type ListStepId = (typeof LIST_STEPS)[number];
/** A step's state. `waiting_approval` appears only in the Studio's run, with the approval's link. */
export type ListStepState = 'done' | 'running' | 'waiting' | 'waiting_approval' | 'refused' | 'skipped';
/** Whose move a step is. */
export type ListWho = 'machine' | 'owner' | 'builder';
export type ListStep = { step: ListStepId; state: ListStepState; who: ListWho; read_at: string; evidence: { kind: string; ref?: string; url?: string; why?: string } };
export type ListOffering = { name: string; priceUsdc: number | null; shown: boolean; held?: string };
/** The one thing a person does, for whoever holds the venue account. `url` is null until the Studio's run asks the venue for the link. */
export type ListHuman = { kind: 'approval'; for: 'owner' | 'builder'; url: string | null; page: string; expires_at: string | null; chat: string };
/** genie.list.virtuals.v1: the listing as it stands, step by step. */
export type ListPlan = {
  schema: typeof LIST_SCHEMA;
  ref: string;
  venue: ListVenue;
  /** whose Virtuals account the agent is in: Moonbeam's own, or a builder's */
  account: 'house:moonbeam' | 'builder';
  agent: { id: string; name: string | null; page: string; chains: { chainId: number; erc8004AgentId: number | null }[] };
  erc8004AgentId: number | null;
  steps: ListStep[];
  offerings: ListOffering[];
  human: ListHuman | null;
  done: boolean;
};
/** What a run would set: the agent's name and description, and per offering (by name) its description and price. */
export type ListCustom = { name?: string; description?: string; offerings?: { name: string; description?: string; priceUsdc?: number }[] };

/** Moonbeam's own agent on Virtuals ACP. Any other agent id is read as a builder's, in its own account. */
export const HOUSE_AGENTS: Readonly<Record<'moonbeam', string>> = Object.freeze({ moonbeam: '01a1cc7f-97ae-74da-8f87-b25514174a22' });
const AGENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE = 8453;
const VIRTUALS_API = 'https://api.acp.virtuals.io';
const VIRTUALS_APP = 'https://app.virtuals.io/acp/agents';

type VirtualsAgent = { id?: string; name?: string; description?: string; chains?: { chainId?: number | string; erc8004AgentId?: number | null }[]; offerings?: { name?: string; description?: string; priceValue?: number | null; isHidden?: boolean }[] };
type Planner = (t: OnboardTransport, a: { agent: string; account: ListPlan['account']; custom: ListCustom | null; now: () => string; api: string }) => Promise<ListPlan>;

const checkCustom = (c: ListCustom | null | undefined): ListCustom | null => {
  if (!c) return null;
  const line = (s: unknown, max: number, what: string) => { if (s !== undefined && (typeof s !== 'string' || !s.trim() || s.length > max)) throw new RangeError(`${what} is 1 to ${max} characters`); };
  line(c.name, 80, 'custom.name'); line(c.description, 1000, 'custom.description');
  for (const o of c.offerings ?? []) {
    line(o.name, 80, 'an offering name'); line(o.description, 1000, `${o.name}: its description`);
    if (o.priceUsdc !== undefined && !(Number.isFinite(o.priceUsdc) && o.priceUsdc > 0)) throw new RangeError(`${o.name}: priceUsdc is a positive number of USDC`);
  }
  return c;
};

/** Virtuals ACP: the plan from the agent's own public record (its chains, its ERC-8004 id, its offerings shown or hidden). */
const planVirtuals: Planner = async (t, { agent, account, custom, now, api }) => {
  const page = `${VIRTUALS_APP}/${agent}`;
  const url = `${api}/agents/${agent}`;
  const r = await keyedFetch(t, url, { method: 'GET', headers: { accept: 'application/json' } });
  const body = await jsonOf(r);
  if (!r.ok && r.status !== 404) throw new MarketError(r.status, 'GET virtuals /agents/:id', body);
  const rec: VirtualsAgent | null = r.ok && body && typeof body === 'object' ? (((body as { data?: unknown }).data ?? body) as VirtualsAgent) : null;
  const at = now();
  const steps: ListStep[] = [];
  const step = (s: ListStepId, state: ListStepState, who: ListWho, evidence: ListStep['evidence']) => steps.push({ step: s, state, who, read_at: at, evidence });
  const person: 'owner' | 'builder' = account === 'house:moonbeam' ? 'owner' : 'builder';
  const chains = (rec?.chains ?? []).map((c) => ({ chainId: Number(c.chainId), erc8004AgentId: c.erc8004AgentId ?? null }));
  const erc8004AgentId = chains.find((c) => c.chainId === BASE)?.erc8004AgentId ?? null;
  const record = (rec?.offerings ?? []).filter((o) => typeof o.name === 'string');
  const shownNames = new Set(record.filter((o) => !o.isHidden).map((o) => o.name!));
  // the offerings a run would show: the custom ones by name where given, else the record's own
  const want = custom?.offerings?.length ? custom.offerings.map((o) => o.name) : record.map((o) => o.name!);
  const priceOf = (name: string) => custom?.offerings?.find((o) => o.name === name)?.priceUsdc ?? record.find((o) => o.name === name)?.priceValue ?? null;
  const offerings: ListOffering[] = want.map((name) => ({ name, priceUsdc: priceOf(name), shown: shownNames.has(name) }));
  const plan = (human: ListHuman | null): ListPlan => ({
    schema: LIST_SCHEMA, ref: agent, venue: 'erc8183-base', account,
    agent: { id: agent, name: rec?.name ?? null, page, chains }, erc8004AgentId, steps, offerings, human,
    done: steps.length > 0 && steps.every((s) => s.state === 'done' || s.state === 'skipped'),
  });

  // 1. the agent
  if (!rec || (!rec.id && !rec.name)) { step('agent', 'refused', 'machine', { kind: 'virtuals.agent', ref: agent, url, why: 'no such agent on Virtuals' }); return plan(null); }
  step('agent', 'done', 'machine', { kind: 'virtuals.agent', ref: agent, url });
  // 2. the signer, and 3. the ERC-8004 identity on Base: the register call runs through the agent's signer
  let human: ListHuman | null = null;
  if (erc8004AgentId) {
    step('signer', 'done', 'machine', { kind: 'virtuals.chains', ref: `${BASE}`, why: 'registered on Base, which runs through the agent\'s signer' });
    step('register', 'done', 'machine', { kind: 'erc8004.identity', ref: String(erc8004AgentId) });
  } else {
    step('signer', 'waiting', person, { kind: 'virtuals.signer', why: 'the agent has no identity on Base yet: the list step first asks for Moonbeam\'s signer, and its holder approves it once' });
    step('register', 'waiting', 'machine', { kind: 'erc8004.register_call', why: 'registered on Base once the signer is approved (one transaction, no value)' });
    human = { kind: 'approval', for: person, url: null, page, expires_at: null,
      chat: `Approve Moonbeam's signer for this agent. Run the list step in the Moonbeam Studio: it shows the approval link, which lasts five minutes. The agent: ${page}` };
  }
  // 4. the seller: an offering is shown only once the agent's seller answers
  if (shownNames.size) step('seller', 'done', 'machine', { kind: 'virtuals.offerings', ref: `${shownNames.size} shown`, why: 'an offering is shown only once the agent\'s seller answers' });
  else step('seller', 'waiting', 'machine', { kind: 'seller.unit', why: 'no offering is shown, so the agent\'s seller is not shown to answer yet' });
  // 5. the offerings a run would show, with the custom words and prices
  const changes = custom ? [
    ...(custom.name && custom.name !== rec.name ? ['the name'] : []),
    ...(custom.description && custom.description !== rec.description ? ['the description'] : []),
    ...(custom.offerings ?? []).filter((o) => {
      const x = record.find((y) => y.name === o.name);
      return !x || (o.description !== undefined && o.description !== x.description) || (o.priceUsdc !== undefined && o.priceUsdc !== x.priceValue);
    }).map((o) => o.name),
  ] : [];
  const hidden = offerings.filter((o) => !o.shown).map((o) => o.name);
  if (!want.length) step('offerings', 'waiting', 'machine', { kind: 'virtuals.offerings', why: 'the agent has no offering yet' });
  else if (changes.length || hidden.length) step('offerings', 'waiting', 'machine', { kind: 'virtuals.offerings', ref: `${want.length - hidden.length} of ${want.length} shown`, why: [...(changes.length ? [`the run sets ${changes.join(', ')}`] : []), ...(hidden.length ? [`not shown yet: ${hidden.join(', ')}`] : [])].join('; ') });
  else step('offerings', 'done', 'machine', { kind: 'virtuals.offerings', ref: `${want.length} shown` });
  // 6. the read back: this plan is itself a read of the agent's record
  step('readback', hidden.length || !want.length ? 'running' : 'done', 'machine', { kind: 'virtuals.agent', ref: `${shownNames.size} shown`, url, ...(hidden.length ? { why: `not shown yet: ${hidden.join(', ')}` } : {}) });
  return plan(human);
};

const PLANNERS: Record<ListVenue, Planner> = { 'erc8183-base': planVirtuals };

/**
 * The listing of an agent on a venue, step by step as it stands now (genie.list.virtuals.v1). Read and plan only: the SDK never
 * asks for a signer, registers, shows an offering or approves anything, and never moves money. The Moonbeam Studio's list step
 * runs the steps; `human` names the one approval a person gives there (the venue account's holder: the owner for Moonbeam's own
 * agent, the builder for theirs), and is returned, never acted on.
 *
 * `agent` is `moonbeam` (Moonbeam's own Virtuals agent) or a Virtuals agent id. `custom` is what the run would set: the agent's
 * name and description, and per offering its description and price; the plan shows those offerings and says what would change.
 * The venue's own public record is read through the transport's fetch (`o.api`, default https://api.acp.virtuals.io).
 */
export async function list(t: OnboardTransport, o: { venue: ListVenue; agent: string; custom?: ListCustom; now?: () => string; api?: string }): Promise<ListPlan> {
  const planner = PLANNERS[o?.venue as ListVenue];
  if (!planner) throw new RangeError(`list plans a listing on ${LIST_VENUES.join(', ')}; the next step on ${o?.venue} is in journey(t, ref).venues['${o?.venue}'].next`);
  const a = String(o.agent ?? '').trim();
  const house = (Object.keys(HOUSE_AGENTS) as (keyof typeof HOUSE_AGENTS)[]).find((k) => k === a || HOUSE_AGENTS[k] === a);
  const agent = house ? HOUSE_AGENTS[house] : a;
  if (!AGENT_ID.test(agent)) throw new RangeError(`an agent on Virtuals ACP is 'moonbeam' or its agent id (a UUID): ${o.agent}`);
  const api = (o.api ?? VIRTUALS_API).replace(/\/+$/, '');
  if (!/^https:\/\//.test(api)) throw new RangeError('the venue API is https');
  return planner(t, { agent, account: house ? 'house:moonbeam' : 'builder', custom: checkCustom(o.custom), now: o.now ?? (() => new Date().toISOString()), api });
}
