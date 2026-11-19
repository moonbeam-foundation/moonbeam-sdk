// _VENUE_TRUTH_v1_: each cohort's own list / take / settle, from the listed register's facts and the venue's evidence-backed steps.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COHORT_ALIASES, COHORT_IDS, COHORT_STEPS, MOONBEAM_LISTS_ON, cohortIdOf, MARK_STATE, STEP_FEATURE, VENUES, VENUE_EVIDENCE_OF, capState, cohortOf, cohortsOf, markOf, type CohortFacts, type FeatureMark, type VenueStepRow } from '../src/market/index.js';
import { VENUE_REGISTER } from '../src/market/venues-data.js';

const r = (state: VenueStepRow['state'], says: string | null = `${state} read`, read_on: string | null = '2026-11-06'): VenueStepRow => ({ state, register: 'x', says, read_on, call: null });
const steps = (list: VenueStepRow['state'], take: VenueStepRow['state'], settle: VenueStepRow['state']) => ({ list: r(list), take: r(take), settle: r(settle) });
const f = (o: Partial<CohortFacts> = {}): CohortFacts => ({ listings: 0, directories: [], shared: null, closed: null, wanted: 0, since: null, ...o });

describe('cohortOf: one cohort on one market', () => {
  it('the cohort the evidence was read for takes the venue\'s own rows once it is listed', () => {
    const c = cohortOf('operator', f({ listings: 1, since: '2026-11-11' }), steps('live', 'live', 'self-test'), 'operator');
    expect(COHORT_STEPS.map((k) => c[k].state)).toEqual(['live', 'live', 'self-test']);
    expect(c.list).toEqual({ state: 'live', says: 'live read', read_on: '2026-11-06' });
  });
  it('another cohort: listed is at most partial while a listing is still wanted; take and settle have no read of their own', () => {
    const wanted = cohortOf('moonbeam', f({ listings: 1, directories: ['x402scan'], wanted: 2, since: '2026-11-11' }), steps('live', 'live', 'live'), 'operator');
    expect(COHORT_STEPS.map((k) => wanted[k].state)).toEqual(['partial', 'not yet', 'not yet']);
    expect(wanted.list).toEqual({ state: 'partial', says: null, read_on: '2026-11-11' });
    expect(wanted.directories).toEqual(['x402scan']);
    const done = cohortOf('moonbeam', f({ listings: 1, since: '2026-11-11' }), steps('live', 'live', 'live'), 'operator');
    expect(done.list.state).toBe('live');
    // the cap never lifts a lower state
    expect(cohortOf('moonbeam', f({ listings: 1, wanted: 1 }), steps('not yet', 'live', 'live'), 'operator').list.state).toBe('not yet');
  });
  it('a directory alone counts as listed', () => {
    expect(cohortOf('operator', f({ directories: ['LocalMark'] }), steps('live', 'live', 'live'), 'operator').list.state).toBe('live');
  });
  it('not on the market: not yet on every step, the evidence never borrowed', () => {
    for (const c of COHORT_IDS) {
      const x = cohortOf(c, f({ wanted: 1 }), steps('live', 'live', 'live'), 'operator');
      expect(COHORT_STEPS.map((k) => x[k])).toEqual(COHORT_STEPS.map(() => ({ state: 'not yet', says: null, read_on: null })));
    }
    expect(cohortOf('moonbeam', undefined, steps('live', 'live', 'live'), 'operator').list.state).toBe('not yet');
  });
  it('a shared listing is said as shared, with its reason, and n/a steps stay n/a', () => {
    const x = cohortOf('moonbeam', f({ shared: 'the other cohort\'s agent, until this one registers its own', since: '2026-11-11' }), steps('live', 'n/a', 'live'), 'operator');
    expect(x.list).toEqual({ state: 'shared', says: 'the other cohort\'s agent, until this one registers its own', read_on: '2026-11-11' });
    expect(x.take.state).toBe('n/a');
    expect(x.settle.state).toBe('shared');
  });
  it('a closed market is closed on every step, even for the evidence cohort', () => {
    const x = cohortOf('operator', f({ closed: 'closed to new providers', listings: 1 }), steps('live', 'n/a', 'live'), 'operator');
    expect(COHORT_STEPS.map((k) => x[k])).toEqual(COHORT_STEPS.map(() => ({ state: 'closed', says: 'closed to new providers', read_on: null })));
  });
  it('n/a where the venue has no such step, with its reason', () => {
    const x = cohortOf('operator', f({ listings: 1 }), { list: r('live'), take: r('n/a', 'no hire here'), settle: r('n/a', 'nothing settles') }, 'operator');
    expect([x.take.state, x.take.says, x.settle.says]).toEqual(['n/a', 'no hire here', 'nothing settles']);
  });
  it('capState keeps the lower state and n/a as it is', () => {
    expect(capState('live', 'partial')).toBe('partial');
    // _VENUE_TESTED_v1_: tested sits between partial and live
    expect(MARK_STATE.tested).toBe('tested'); expect(MARK_STATE.ok).toBe('live');
    expect(capState('live', 'tested')).toBe('tested'); expect(capState('tested', 'partial')).toBe('partial'); expect(capState('partial', 'tested')).toBe('partial');
    expect(capState('self-test', 'partial')).toBe('self-test');
    expect(capState('not yet', 'partial')).toBe('not yet');
    expect(capState('n/a', 'partial')).toBe('n/a');
  });
  it('cohortsOf answers every cohort, and copies the facts it was given', () => {
    const facts = { operator: f({ listings: 1, directories: ['a'] }) };
    const all = cohortsOf(facts, steps('live', 'live', 'live'), 'operator');
    expect(Object.keys(all)).toEqual([...COHORT_IDS]);
    all.operator.directories.push('b');
    expect(facts.operator.directories).toEqual(['a']);
    expect(all.moonbeam.list.state).toBe('not yet');
  });
});

describe('the operator cohort: renamed from layer in 0.13.0', () => {
  it('the old id still reads, as a deprecated alias in types and at run time, and stays out of keys and JSON', () => {
    expect(COHORT_ALIASES).toEqual({ layer: 'operator' });
    expect(cohortIdOf('layer')).toBe('operator'); expect(cohortIdOf('operator')).toBe('operator');
    const v = VENUES.find((x) => x.id === 'near-agent-market')!;
    expect(v.cohorts.layer).toBe(v.cohorts.operator);
    expect(Object.keys(v.cohorts)).toEqual(['operator', 'moonbeam']);
    expect(JSON.stringify(v.cohorts)).not.toMatch(/"layer"/);
    expect(cohortOf('layer', undefined, { list: { state: 'live', says: 'x', read_on: null }, take: { state: 'live', says: 'x', read_on: null }, settle: { state: 'live', says: 'x', read_on: null } } as never, 'layer').list.state).toBeDefined();
  });
});

describe('VENUES[].cohorts: the shipped table, per cohort', () => {
  const at = (id: string) => VENUES.find((v) => v.id === id)!;
  const states = (id: string, c: 'operator' | 'moonbeam') => COHORT_STEPS.map((k) => at(id).cohorts[c][k].state);
  it('the snapshot holds both cohorts on every market, and the evidence was read for the operator', () => {
    expect(VENUE_EVIDENCE_OF).toBe('operator');
    expect(VENUE_REGISTER.cohorts).toMatchObject({ source: 'LISTED_REGISTER_v1', evidence_of: 'operator', ids: ['operator', 'moonbeam'] });
    expect(COHORT_IDS).toEqual(['operator', 'moonbeam']);
    for (const m of VENUE_REGISTER.markets) expect(Object.keys(m.cohorts ?? {}), m.id).toEqual([...COHORT_IDS]);
  });
  it('the venue row never reads higher than the evidence cohort\'s own mark, wherever the market is open', () => {
    const RANK: Record<string, number> = { 'not yet': 0, 'self-test': 1, partial: 2, live: 3 };
    for (const v of VENUES) {
      const facts = VENUE_REGISTER.markets.find((m) => m.id === v.id)!.cohorts!.operator!;
      if (facts.closed) continue;
      for (const k of COHORT_STEPS) {
        const c = v.cohorts.operator[k];
        if (c.from === 'features' && v[k].state !== 'n/a') expect(RANK[v[k].state]!, `${v.id}.${k}`).toBeLessThanOrEqual(RANK[c.state as string]!);
      }
    }
  });
  it('the states as read on the listed register, the feature matrix and the house agents\' journeys (2026-11-14)', () => {
    expect(states('x402-base', 'operator')).toEqual(['live', 'live', 'live']);
    expect(states('x402-base', 'moonbeam')).toEqual(['live', 'partial', 'partial']);
    // settle: the feature matrix still read broken (2026-11-14T20:18Z), before the sync that withdrew two nameless offerings;
    // Virtuals' own read of the operator's agent at 00:21Z shows all 13 offerings named, so the cell reads partial, with that proof
    expect(states('erc8183-base', 'operator')).toEqual(['live', 'partial', 'partial']);
    expect(at('erc8183-base').cohorts.operator.settle).toMatchObject({ from: 'features', state: 'partial' });
    // Moonbeam's Virtuals agent shows its house offerings: listed, read on the market itself through a house agent's journey
    expect(states('erc8183-base', 'moonbeam')).toEqual(['live', 'partial', 'partial']);
    expect(at('erc8183-base').cohorts.moonbeam.list).toMatchObject({ from: 'journey', state: 'live' });
    expect(states('memoacp-base', 'operator')).toEqual(['closed', 'closed', 'closed']);
    // _MARKETS_CUT_v2_: the three markets coord's listed register cuts from Moonbeam read cut, with the register's reason
    expect(states('memoacp-base', 'moonbeam')).toEqual(['cut', 'cut', 'cut']);
    expect(states('workflow-nodes', 'moonbeam')).toEqual(['cut', 'cut', 'cut']);
    expect(states('mcp', 'moonbeam')).toEqual(['live', 'partial', 'n/a']);
    expect(states('a2a', 'moonbeam')).toEqual(['live', 'partial', 'n/a']);
    expect(states('erc8004', 'moonbeam')).toEqual(['live', 'n/a', 'n/a']);
    expect(states('near-agent-market', 'operator')).toEqual(['live', 'live', 'partial']);
    expect(states('near-agent-market', 'moonbeam')).toEqual(['live', 'not yet', 'not yet']);
    expect(states('bitagent-base', 'moonbeam')).toEqual(['cut', 'cut', 'cut']);
    expect(at('bitagent-base').cohorts.moonbeam.list.says).toBe('Moonbeam does not list on BitAgent');
    expect([...MOONBEAM_LISTS_ON].sort()).toEqual(['a2a', 'erc8004', 'erc8183-base', 'mcp', 'near-agent-market', 'olas-base', 'x402-base']);
    expect(states('olas-base', 'moonbeam')).toEqual(['not yet', 'not yet', 'not yet']);
    expect(at('near-agent-market').cohorts.operator.listings).toBe(9);
  });
  it('a cohort with no listing, no own mark and no journey on a market never shows the other cohort\'s live state', () => {
    for (const v of VENUES) for (const c of COHORT_IDS) {
      const facts = VENUE_REGISTER.markets.find((m) => m.id === v.id)!.cohorts![c]!;
      if (facts.listings + facts.directories.length > 0 || facts.journey) continue;
      for (const k of COHORT_STEPS) {
        const row = v.cohorts[c][k];
        if (row.from === 'features') expect(row.state, `${v.id}.${c}.${k}`).toBe(markOf(facts, k)!.state);
        else expect(['not yet', 'shared', 'closed', 'cut', 'n/a'], `${v.id}.${c}.${k}`).toContain(row.state);
      }
    }
  });
  it('_VENUE_TRUTH_v2_: the snapshot holds every feature an SDK step reads, on every open market, for both cohorts', () => {
    expect(VENUE_REGISTER.cohorts?.features).toMatchObject({ source: 'LISTED_FEATURES_v1' });
    for (const m of VENUE_REGISTER.markets) for (const c of COHORT_IDS) {
      const f = m.cohorts![c]!;
      if (f.closed || f.cut) continue;
      for (const id of Object.values(STEP_FEATURE)) expect(f.features?.[id], `${m.id}.${c}.${id}`).toBeTruthy();
    }
    expect(Object.keys(STEP_FEATURE)).toEqual(['list', 'take', 'settle', 'paid']);
    expect(Object.keys(MARK_STATE).sort()).toEqual(['broken', 'not built', 'ok', 'owner step', 'partial', 'tested']);
  });
  it('_VENUE_TRUTH_v2_: a journey moves only the Moonbeam cohort\'s list, and only from a market\'s own read', () => {
    for (const m of VENUE_REGISTER.markets) {
      expect(m.cohorts?.operator?.journey, m.id).toBeUndefined();
      const j = m.cohorts?.moonbeam?.journey;
      if (j) { expect(j.standing).toBe('listed_by_moonbeam'); expect(j.proof).not.toBe('register_row'); }
    }
    const steps = { list: r('not yet'), take: r('live'), settle: r('live') };
    const j = { standing: 'listed_by_moonbeam' as const, ref: '8453:1', proof: 'virtuals.agent', says: 'shown', read_at: '2026-11-15T00:00:00Z' };
    expect(cohortOf('moonbeam', f({ wanted: 1, journey: j }), steps, 'operator').list).toEqual({ state: 'live', says: 'shown', read_on: '2026-11-15T00:00:00Z', from: 'journey', who: null });
    expect(cohortOf('operator', f({ journey: j }), steps, 'operator').list.state).toBe('not yet');
    // a closed market stays closed, whatever a journey says
    expect(cohortOf('moonbeam', f({ closed: 'closed to new providers', journey: j }), steps, 'operator').list.state).toBe('closed');
  });
  it('_VENUE_TRUTH_v2_: a mark says the state, its words and who moves it; owner steps and builds are not yet', () => {
    const feat = (mark: FeatureMark) => f({ listings: 1, features: { list: { mark, who: 'owner', says: 'w', read_at: '2026-11-14T23:00:00Z' } } });
    const steps = { list: r('live'), take: r('live'), settle: r('live') };
    expect(cohortOf('moonbeam', feat('ok'), steps, 'operator').list).toEqual({ state: 'live', says: 'w', read_on: '2026-11-14T23:00:00Z', from: 'features', who: 'owner' });
    for (const [mark, state] of [['partial', 'partial'], ['owner step', 'not yet'], ['not built', 'not yet'], ['broken', 'not yet']] as const)
      expect(cohortOf('moonbeam', feat(mark), steps, 'operator').list.state, mark).toBe(state);
    // a step with no mark falls back to the rules
    expect(cohortOf('moonbeam', feat('ok'), steps, 'operator').take.state).toBe('not yet');
  });
  it('docs/VENUES.md says the same per-cohort states as the table', () => {
    const doc = readFileSync(new URL('../docs/VENUES.md', import.meta.url), 'utf8');
    const cell = (id: string, c: 'operator' | 'moonbeam') => states(id, c).join(' · ');
    for (const v of VENUES) expect(doc, v.id).toContain(`| ${v.name} | ${cell(v.id, 'operator')} | ${cell(v.id, 'moonbeam')} |`);
  });
  it('public text: no internal host, no workflow-tool name, no address', () => {
    expect(JSON.stringify(VENUES.map((v) => v.cohorts))).not.toMatch(/taifoon|\bn8n\b|0x[0-9a-f]{40}/i);
    expect(readFileSync(new URL('../src/market/venues-data.ts', import.meta.url), 'utf8')).not.toMatch(/taifoon|\bn8n\b|0x[0-9a-f]{40}/i);
  });
});
