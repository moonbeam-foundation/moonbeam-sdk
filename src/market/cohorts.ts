// _VENUE_TRUTH_v1_ EACH COHORT ITS OWN STATE: the register's states (VENUES) were read for one cohort, the layer's own listings.
// Moonbeam lists the same markets as a second cohort, and its listings are not the layer's. This module turns what the listed register
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
import type { VenueState, VenueStepRow } from './venues.js';

/** The cohorts the listed register holds: the layer's own listings, and Moonbeam's, resold under the layer's licence. */
export const COHORT_IDS = Object.freeze(['layer', 'moonbeam'] as const);
export type CohortId = (typeof COHORT_IDS)[number];
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
};
export type CohortStepRow = { state: CohortState; says: string | null; read_on: string | null };
export type VenueCohort = { list: CohortStepRow; take: CohortStepRow; settle: CohortStepRow; listings: number; directories: string[]; wanted: number };

const RANK: Record<string, number> = { 'n/a': -1, 'not yet': 0, 'self-test': 1, partial: 2, live: 3 };
/** The lower of two venue states (n/a is kept as it is). */
export const capState = (s: VenueState, cap: VenueState): VenueState => (s === 'n/a' || (RANK[s] ?? 0) <= (RANK[cap] ?? 0) ? s : cap);

const NO_FACTS: CohortFacts = { listings: 0, directories: [], shared: null, closed: null, wanted: 0, since: null };

/**
 * One cohort on one market: its list, take and settle, from the listed register's facts and the market's own steps (VENUES' rows,
 * read for `evidenceOf`). Missing facts read as a market the cohort is not on.
 */
export function cohortOf(cohort: CohortId, facts: CohortFacts | undefined, steps: Record<CohortStep, VenueStepRow>, evidenceOf: CohortId): VenueCohort {
  const f = facts ?? NO_FACTS;
  const own = cohort === evidenceOf;
  const onMarket = f.listings + f.directories.length > 0;
  const row = (state: CohortState, says: string | null, read_on: string | null): CohortStepRow => ({ state, says, read_on });
  const step = (k: CohortStep): CohortStepRow => {
    const v = steps[k];
    if (f.closed) return row('closed', f.closed, null);
    if (v.state === 'n/a') return row('n/a', v.says, v.read_on);
    if (!onMarket) return f.shared ? row('shared', f.shared, f.since) : row('not yet', null, null);
    if (own) return row(v.state, v.says, v.read_on);
    if (k === 'list') return row(f.wanted === 0 ? v.state : capState(v.state, 'partial'), null, f.since);
    return row('not yet', null, null);
  };
  return { list: step('list'), take: step('take'), settle: step('settle'), listings: f.listings, directories: [...f.directories], wanted: f.wanted };
}

/** Every cohort on one market. */
export function cohortsOf(facts: Partial<Record<CohortId, CohortFacts>> | undefined, steps: Record<CohortStep, VenueStepRow>, evidenceOf: CohortId): Record<CohortId, VenueCohort> {
  return Object.fromEntries(COHORT_IDS.map((c) => [c, cohortOf(c, facts?.[c], steps, evidenceOf)])) as Record<CohortId, VenueCohort>;
}
