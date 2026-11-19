// _VENUE_TRUTH_v1_ EACH COHORT ITS OWN STATE: the register's states (VENUES) were read for one cohort, the operator's own listings.
// Moonbeam lists the same markets as a second cohort, and its listings are not the operator's. This module turns what the listed register
// holds for a cohort on a market (its listings, the directories that show them, a listing shared from the other cohort, a market closed
// to new agents, the listings still wanted) and the market's evidence-backed steps into that cohort's own list / take / settle.
// Pure: no reads, no clock. The rules, in order, for each step:
//   1. a market closed to new agents                                  → closed
//   2. the market has no such step (the venue row says n/a)           → n/a
//   3. list: no listing and no directory shows one                    → shared (a listing the other cohort holds) or not yet
//      list: listed                                                   → the register's state; for a cohort the evidence was not read for,
//                                                                       at most partial while a listing on that market is still wanted
//   4. take / settle: not listed, or listed only through a share     → not yet, or shared
//      take / settle: the cohort the evidence was read for            → the register's state
//      take / settle: any other cohort                                → not yet: no read of its own shows the step
//
// _VENUE_TRUTH_v2_ (2026-11-15): two live reads now come first, each kept in the snapshot with the date it was read.
//   a. the feature matrix (GET /v1/listed?view=features): each cohort's own mark per market for list, jobs received, pay and settle;
//      ok → live · partial → partial · owner step, not built, broken → not yet (STEP_FEATURE, MARK_STATE)
//   b. a house agent's journey (GET /v1/listed?agent=<ref>&view=journey): a market whose own read shows the agent listed by Moonbeam
//      lists the Moonbeam cohort there (live), whatever an older register row says
// The order, for each step: closed → n/a → (list) the journey's own read → not listed and shared → shared → the feature mark →
// the rules above. The venue's own rows are never lifted by a mark: venues.ts caps them by the evidence cohort's marks.
import type { VenueState, VenueStep, VenueStepRow } from './venues.js';

/** The cohorts the listed register holds: the operator's own listings, and Moonbeam's, resold under the operator's licence. */
export const COHORT_IDS = Object.freeze(['operator', 'moonbeam'] as const);
export type CohortId = (typeof COHORT_IDS)[number];
/** @deprecated since 0.13.0, removed in 0.14.0: the operator cohort's old id. Read `operator`. */
export type DeprecatedCohortId = 'layer';
/** The old cohort ids and the id each now names (0.13.0 only). */
export const COHORT_ALIASES: Readonly<Record<DeprecatedCohortId, CohortId>> = Object.freeze({ layer: 'operator' });
/** A cohort id, the old `layer` read as `operator`. */
export const cohortIdOf = (c: CohortId | DeprecatedCohortId): CohortId => (c in COHORT_ALIASES ? COHORT_ALIASES[c as DeprecatedCohortId] : (c as CohortId));
/** Every cohort's row, keyed by id; `layer` is kept as a deprecated, non-enumerable alias of `operator` for 0.13.0. */
export type CohortRows = Record<CohortId, VenueCohort> & {
  /** @deprecated since 0.13.0, removed in 0.14.0: read `operator`. */
  readonly layer: VenueCohort;
};
/** A cohort's step: a venue state, or `closed` (the market takes no new agent) or `shared` (the other cohort's listing stands in). */
export type CohortState = VenueState | 'closed' | 'shared';
export type CohortStep = 'list' | 'take' | 'settle';
export const COHORT_STEPS: readonly CohortStep[] = Object.freeze(['list', 'take', 'settle']);

/** What the listed register holds for one cohort on one market (the snapshot's facts). */
export type CohortFacts = {
  /** listings read on the market itself */
  listings: number;
  /** outside directories that show a listing, by name */
  directories: string[];
  /** why the other cohort's listing stands in for this one, when it does */
  shared: string | null;
  /** why the market takes no new agent, when it does not */
  closed: string | null;
  /** listings the register still wants on this market */
  wanted: number;
  /** the date the newest listing was read */
  since: string | null;
  /** _VENUE_TRUTH_v2_: the feature matrix's marks for this cohort on this market, by feature id (STEP_FEATURE) */
  features?: Partial<Record<FeatureId, FeatureRead>>;
  /** _VENUE_TRUTH_v2_: a house agent's journey whose market read shows it listed by Moonbeam here (Moonbeam cohort only) */
  journey?: JourneyRead | null;
};

/** The feature matrix's marks, as it writes them. */
export type FeatureMark = 'ok' | 'tested' | 'partial' | 'not built' | 'owner step' | 'broken';
/** One mark as the snapshot keeps it: who takes the next step, the cohort's own words (Moonbeam's only), the time it was read. */
export type FeatureRead = { mark: FeatureMark; who: string | null; says: string | null; read_at: string | null;
  /** _VENUE_TESTED_v1_: on a tested mark, the SDK I/O fixture that keeps Moonbeam's own end-to-end run (a path under test/io) */
  fixture?: string;
  /** set when a newer read of the market itself showed the matrix's broken mark stale: what it read, and the mark it replaced */
  proof?: { kind: string; url: string; ref: string; read_at: string; was: FeatureMark } };
/** A house agent's journey that shows it listed by Moonbeam on a market's own read. */
export type JourneyRead = { standing: 'listed_by_moonbeam'; ref: string; proof: string; says: string | null; read_at: string | null };
/** Each SDK step and the feature of the matrix that reads it: listed, the jobs buyers sent, the buyer's payment, the seller's payout. */
export const STEP_FEATURE = Object.freeze({ list: 'list', take: 'jobs_received', settle: 'pay', paid: 'settle' } as const satisfies Record<VenueStep, string>);
export type FeatureId = (typeof STEP_FEATURE)[VenueStep];
/** A mark said as a venue state. */
export const MARK_STATE: Readonly<Record<FeatureMark, VenueState>> = Object.freeze({ ok: 'live', tested: 'tested', partial: 'partial', 'not built': 'not yet', 'owner step': 'not yet', broken: 'not yet' });
/** The venue state a cohort's mark says for one step, or null when the matrix holds no mark for it. */
export const markOf = (f: CohortFacts | undefined, k: VenueStep): (FeatureRead & { state: VenueState }) | null => {
  const x = f?.features?.[STEP_FEATURE[k]];
  return x ? { ...x, state: MARK_STATE[x.mark] ?? 'not yet' } : null;
};

/** Where a cohort's step was read: the feature matrix, a house agent's journey, or the listed register and the venue's rows. */
export type CohortSource = 'features' | 'journey' | 'register';
export type CohortStepRow = { state: CohortState; says: string | null; read_on: string | null; from?: CohortSource; who?: string | null };
export type VenueCohort = { list: CohortStepRow; take: CohortStepRow; settle: CohortStepRow; listings: number; directories: string[]; wanted: number };

const RANK: Record<string, number> = { 'n/a': -1, 'not yet': 0, 'self-test': 1, partial: 2, tested: 3, live: 4 };
/** The lower of two venue states (n/a is kept as it is). */
export const capState = (s: VenueState, cap: VenueState): VenueState => (s === 'n/a' || (RANK[s] ?? 0) <= (RANK[cap] ?? 0) ? s : cap);

const NO_FACTS: CohortFacts = { listings: 0, directories: [], shared: null, closed: null, wanted: 0, since: null };

/**
 * One cohort on one market: its list, take and settle, from the listed register's facts and the market's own steps (VENUES' rows,
 * read for `evidenceOf`). Missing facts read as a market the cohort is not on.
 */
export function cohortOf(cohortIn: CohortId | DeprecatedCohortId, facts: CohortFacts | undefined, steps: Record<CohortStep, VenueStepRow>, evidenceOfIn: CohortId | DeprecatedCohortId): VenueCohort {
  const cohort = cohortIdOf(cohortIn); const evidenceOf = cohortIdOf(evidenceOfIn);
  const f = facts ?? NO_FACTS;
  const own = cohort === evidenceOf;
  const journey = cohort === 'moonbeam' ? f.journey ?? null : null;
  const onMarket = f.listings + f.directories.length > 0 || !!journey;
  const row = (state: CohortState, says: string | null, read_on: string | null): CohortStepRow => ({ state, says, read_on });
  const step = (k: CohortStep): CohortStepRow => {
    const v = steps[k];
    if (f.closed) return row('closed', f.closed, null);
    if (v.state === 'n/a') return row('n/a', v.says, v.read_on);
    if (k === 'list' && journey) return { state: 'live', says: journey.says, read_on: journey.read_at, from: 'journey', who: null };
    if (!onMarket && f.shared) return row('shared', f.shared, f.since);
    const m = markOf(f, k);
    if (m) return { state: m.state, says: m.says, read_on: m.read_at, from: 'features', who: m.who };
    if (!onMarket) return row('not yet', null, null);
    if (own) return row(v.state, v.says, v.read_on);
    if (k === 'list') return row(f.wanted === 0 ? v.state : capState(v.state, 'partial'), null, f.since);
    return row('not yet', null, null);
  };
  return { list: step('list'), take: step('take'), settle: step('settle'), listings: f.listings, directories: [...f.directories], wanted: f.wanted };
}

/** Every cohort on one market. */
export function cohortsOf(facts: Partial<Record<CohortId | DeprecatedCohortId, CohortFacts>> | undefined, steps: Record<CohortStep, VenueStepRow>, evidenceOf: CohortId | DeprecatedCohortId): CohortRows {
  // facts keyed by an old id (a 0.12 snapshot) still answer for the cohort it now names
  const old = (c: CohortId) => (Object.keys(COHORT_ALIASES) as DeprecatedCohortId[]).find((k) => COHORT_ALIASES[k] === c);
  const factsOf = (c: CohortId) => facts?.[c] ?? (old(c) ? facts?.[old(c)!] : undefined);
  const rows = Object.fromEntries(COHORT_IDS.map((c) => [c, cohortOf(c, factsOf(c), steps, evidenceOf)])) as Record<CohortId, VenueCohort>;
  return withAliases(rows);
}
/** The rows with the deprecated ids as non-enumerable getters (not in keys or JSON), so code that read `cohorts.layer` keeps working. */
export function withAliases(rows: Record<CohortId, VenueCohort>): CohortRows {
  for (const [old, to] of Object.entries(COHORT_ALIASES)) Object.defineProperty(rows, old, { get: () => rows[to], enumerable: false, configurable: false });
  return rows as CohortRows;
}
