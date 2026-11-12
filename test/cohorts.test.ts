// _VENUE_TRUTH_v1_: each cohort's own list / take / settle, from the listed register's facts and the venue's evidence-backed steps.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COHORT_IDS, COHORT_STEPS, VENUES, VENUE_EVIDENCE_OF, capState, cohortOf, cohortsOf, type CohortFacts, type VenueStepRow } from '../src/market/index.js';
import { VENUE_REGISTER } from '../src/market/venues-data.js';

const r = (state: VenueStepRow['state'], says: string | null = `${state} read`, read_on: string | null = '2026-11-06'): VenueStepRow => ({ state, register: 'x', says, read_on, call: null });
const steps = (list: VenueStepRow['state'], take: VenueStepRow['state'], settle: VenueStepRow['state']) => ({ list: r(list), take: r(take), settle: r(settle) });
const f = (o: Partial<CohortFacts> = {}): CohortFacts => ({ listings: 0, directories: [], shared: null, closed: null, wanted: 0, since: null, ...o });

describe('cohortOf: one cohort on one market', () => {
  it('the cohort the evidence was read for takes the venue\'s own rows once it is listed', () => {
    const c = cohortOf('layer', f({ listings: 1, since: '2026-11-11' }), steps('live', 'live', 'self-test'), 'layer');
    expect(COHORT_STEPS.map((k) => c[k].state)).toEqual(['live', 'live', 'self-test']);
    expect(c.list).toEqual({ state: 'live', says: 'live read', read_on: '2026-11-06' });
  });
  it('another cohort: listed is at most partial while a listing is still wanted; take and settle have no read of their own', () => {
    const wanted = cohortOf('moonbeam', f({ listings: 1, directories: ['x402scan'], wanted: 2, since: '2026-11-11' }), steps('live', 'live', 'live'), 'layer');
    expect(COHORT_STEPS.map((k) => wanted[k].state)).toEqual(['partial', 'not yet', 'not yet']);
    expect(wanted.list).toEqual({ state: 'partial', says: null, read_on: '2026-11-11' });
    expect(wanted.directories).toEqual(['x402scan']);
    const done = cohortOf('moonbeam', f({ listings: 1, since: '2026-11-11' }), steps('live', 'live', 'live'), 'layer');
    expect(done.list.state).toBe('live');
    // the cap never lifts a lower state
    expect(cohortOf('moonbeam', f({ listings: 1, wanted: 1 }), steps('not yet', 'live', 'live'), 'layer').list.state).toBe('not yet');
  });
  it('a directory alone counts as listed', () => {
    expect(cohortOf('layer', f({ directories: ['LocalMark'] }), steps('live', 'live', 'live'), 'layer').list.state).toBe('live');
  });
  it('not on the market: not yet on every step, the evidence never borrowed', () => {
    for (const c of COHORT_IDS) {
      const x = cohortOf(c, f({ wanted: 1 }), steps('live', 'live', 'live'), 'layer');
      expect(COHORT_STEPS.map((k) => x[k])).toEqual(COHORT_STEPS.map(() => ({ state: 'not yet', says: null, read_on: null })));
    }
    expect(cohortOf('moonbeam', undefined, steps('live', 'live', 'live'), 'layer').list.state).toBe('not yet');
  });
  it('a shared listing is said as shared, with its reason, and n/a steps stay n/a', () => {
    const x = cohortOf('moonbeam', f({ shared: 'the other cohort\'s agent, until this one registers its own', since: '2026-11-11' }), steps('live', 'n/a', 'live'), 'layer');
    expect(x.list).toEqual({ state: 'shared', says: 'the other cohort\'s agent, until this one registers its own', read_on: '2026-11-11' });
    expect(x.take.state).toBe('n/a');
    expect(x.settle.state).toBe('shared');
  });
  it('a closed market is closed on every step, even for the evidence cohort', () => {
    const x = cohortOf('layer', f({ closed: 'closed to new providers', listings: 1 }), steps('live', 'n/a', 'live'), 'layer');
    expect(COHORT_STEPS.map((k) => x[k])).toEqual(COHORT_STEPS.map(() => ({ state: 'closed', says: 'closed to new providers', read_on: null })));
  });
  it('n/a where the venue has no such step, with its reason', () => {
    const x = cohortOf('layer', f({ listings: 1 }), { list: r('live'), take: r('n/a', 'no hire here'), settle: r('n/a', 'nothing settles') }, 'layer');
    expect([x.take.state, x.take.says, x.settle.says]).toEqual(['n/a', 'no hire here', 'nothing settles']);
  });
  it('capState keeps the lower state and n/a as it is', () => {
    expect(capState('live', 'partial')).toBe('partial');
    expect(capState('self-test', 'partial')).toBe('self-test');
    expect(capState('not yet', 'partial')).toBe('not yet');
    expect(capState('n/a', 'partial')).toBe('n/a');
  });
  it('cohortsOf answers every cohort, and copies the facts it was given', () => {
    const facts = { layer: f({ listings: 1, directories: ['a'] }) };
    const all = cohortsOf(facts, steps('live', 'live', 'live'), 'layer');
    expect(Object.keys(all)).toEqual([...COHORT_IDS]);
    all.layer.directories.push('b');
    expect(facts.layer.directories).toEqual(['a']);
    expect(all.moonbeam.list.state).toBe('not yet');
  });
});

describe('VENUES[].cohorts: the shipped table, per cohort', () => {
  const at = (id: string) => VENUES.find((v) => v.id === id)!;
  const states = (id: string, c: 'layer' | 'moonbeam') => COHORT_STEPS.map((k) => at(id).cohorts[c][k].state);
  it('the snapshot holds both cohorts on every market, and the evidence was read for the layer', () => {
    expect(VENUE_EVIDENCE_OF).toBe('layer');
    expect(VENUE_REGISTER.cohorts).toMatchObject({ source: 'LISTED_REGISTER_v1', evidence_of: 'layer', ids: ['layer', 'moonbeam'] });
    for (const m of VENUE_REGISTER.markets) expect(Object.keys(m.cohorts ?? {}), m.id).toEqual([...COHORT_IDS]);
  });
  it('the evidence cohort agrees with the venue row wherever it is listed and the market is open', () => {
    for (const v of VENUES) {
      const facts = VENUE_REGISTER.markets.find((m) => m.id === v.id)!.cohorts!.layer!;
      if (facts.closed || facts.listings + facts.directories.length === 0) continue;
      for (const k of COHORT_STEPS) expect(v.cohorts.layer[k].state, `${v.id}.${k}`).toBe(v[k].state);
    }
  });
  it('the states as read on the listed register snapshot', () => {
    expect(states('x402-base', 'layer')).toEqual(['live', 'live', 'live']);
    expect(states('x402-base', 'moonbeam')).toEqual(['partial', 'not yet', 'not yet']);
    expect(states('memoacp-base', 'layer')).toEqual(['closed', 'closed', 'closed']);
    expect(states('memoacp-base', 'moonbeam')).toEqual(['closed', 'closed', 'closed']);
    expect(states('erc8004', 'moonbeam')).toEqual(['shared', 'n/a', 'n/a']);
    expect(states('near-agent-market', 'moonbeam')).toEqual(['not yet', 'not yet', 'not yet']);
    expect(at('near-agent-market').cohorts.layer.listings).toBe(9);
  });
  it('a cohort with no listing on a market never shows the other cohort\'s live state', () => {
    for (const v of VENUES) for (const c of COHORT_IDS) {
      const facts = VENUE_REGISTER.markets.find((m) => m.id === v.id)!.cohorts![c]!;
      if (facts.listings + facts.directories.length > 0) continue;
      for (const k of COHORT_STEPS) expect(['not yet', 'shared', 'closed', 'n/a'], `${v.id}.${c}.${k}`).toContain(v.cohorts[c][k].state);
    }
  });
  it('docs/VENUES.md says the same per-cohort states as the table', () => {
    const doc = readFileSync(new URL('../docs/VENUES.md', import.meta.url), 'utf8');
    const cell = (id: string, c: 'layer' | 'moonbeam') => states(id, c).join(' · ');
    for (const v of VENUES) expect(doc, v.id).toContain(`| ${v.name} | ${cell(v.id, 'layer')} | ${cell(v.id, 'moonbeam')} |`);
  });
  it('public text: no internal host, no workflow-tool name, no address', () => {
    expect(JSON.stringify(VENUES.map((v) => v.cohorts))).not.toMatch(/taifoon|\bn8n\b|0x[0-9a-f]{40}/i);
    expect(readFileSync(new URL('../src/market/venues-data.ts', import.meta.url), 'utf8')).not.toMatch(/taifoon|\bn8n\b|0x[0-9a-f]{40}/i);
  });
});
