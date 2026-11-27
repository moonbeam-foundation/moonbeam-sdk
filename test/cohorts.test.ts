// _VENUE_TRUTH_v1_: each cohort's own list / take / settle, from the listed register's facts and the venue's evidence-backed steps.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COHORT_ALIASES, COHORT_IDS, COHORT_STEPS, MAINNET_IO_OF, MOONBEAM_LISTS_ON, PUBLIC_STATES, VENUE_MAINNET, provenOnMainnet, publicStateOf, cohortIdOf, MARK_STATE, STEP_FEATURE, VENUES, VENUE_EVIDENCE_OF, capState, cohortOf, cohortsOf, markOf, type CohortFacts, type FeatureMark, type MainnetProof, type VenueStepRow } from '../src/market/index.js';
import { STATE_RANK } from '../src/market/cohorts.js';
import { VENUE_REGISTER } from '../src/market/venues-data.js';

const r = (state: VenueStepRow['state'], says: string | null = `${state} read`, read_on: string | null = '2026-11-06'): VenueStepRow => ({ state, register: 'x', says, read_on, call: null });
const steps = (list: VenueStepRow['state'], take: VenueStepRow['state'], settle: VenueStepRow['state']) => ({ list: r(list), take: r(take), settle: r(settle) });
const f = (o: Partial<CohortFacts> = {}): CohortFacts => ({ listings: 0, directories: [], shared: null, closed: null, wanted: 0, since: null, ...o });

describe('cohortOf: one cohort on one market', () => {
  it('the cohort the evidence was read for takes the venue\'s own rows once it is listed', () => {
    const c = cohortOf('operator', f({ listings: 1, since: '2026-11-11' }), steps('live', 'live', 'self-test'), 'operator');
    expect(COHORT_STEPS.map((k) => c[k].state)).toEqual(['live', 'live', 'self-test']);
    // no mainnet run is kept for this cohort here, so the public word is not yet
    expect(c.list).toEqual({ state: 'live', says: 'live read', read_on: '2026-11-06', publicState: 'not yet' });
  });
  it('another cohort: listed is at most partial while a listing is still wanted; take and settle have no read of their own', () => {
    const wanted = cohortOf('moonbeam', f({ listings: 1, directories: ['x402scan'], wanted: 2, since: '2026-11-11' }), steps('live', 'live', 'live'), 'operator');
    expect(COHORT_STEPS.map((k) => wanted[k].state)).toEqual(['partial', 'not yet', 'not yet']);
    expect(wanted.list).toEqual({ state: 'partial', says: null, read_on: '2026-11-11', publicState: 'not yet' });
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
      expect(COHORT_STEPS.map((k) => x[k])).toEqual(COHORT_STEPS.map(() => ({ state: 'not yet', says: null, read_on: null, publicState: 'not yet' })));
    }
    expect(cohortOf('moonbeam', undefined, steps('live', 'live', 'live'), 'operator').list.state).toBe('not yet');
  });
  it('a shared listing is said as shared, with its reason, and n/a steps stay n/a', () => {
    const x = cohortOf('moonbeam', f({ shared: 'the other cohort\'s agent, until this one registers its own', since: '2026-11-11' }), steps('live', 'n/a', 'live'), 'operator');
    expect(x.list).toEqual({ state: 'shared', says: 'the other cohort\'s agent, until this one registers its own', read_on: '2026-11-11', publicState: 'not yet' });
    expect(x.take.publicState).toBe('n/a');
    expect(x.take.state).toBe('n/a');
    expect(x.settle.state).toBe('shared');
  });
  it('a closed market is closed on every step, even for the evidence cohort', () => {
    const x = cohortOf('operator', f({ closed: 'closed to new providers', listings: 1 }), steps('live', 'n/a', 'live'), 'operator');
    expect(COHORT_STEPS.map((k) => x[k])).toEqual(COHORT_STEPS.map(() => ({ state: 'closed', says: 'closed to new providers', read_on: null, publicState: 'not yet' })));
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
    for (const v of VENUES) {
      const facts = VENUE_REGISTER.markets.find((m) => m.id === v.id)!.cohorts!.operator!;
      if (facts.closed) continue;
      for (const k of COHORT_STEPS) {
        const c = v.cohorts.operator[k];
        // a mark older than the register's own read of the step does not hold it down
        if (c.from === 'features' && v[k].state !== 'n/a' && !v[k].capped && c.read_on && v[k].read_on && c.read_on.slice(0, 10) < v[k].read_on.slice(0, 10)) continue;
        if (c.from === 'features' && v[k].state !== 'n/a') expect(STATE_RANK[v[k].state]!, `${v.id}.${k}`).toBeLessThanOrEqual(STATE_RANK[c.state as string]!);
      }
    }
  });
  it('the states as read on the listed register, the feature matrix and the house agents\' journeys (2026-11-19, coord venue paths)', () => {
    expect(states('x402-base', 'operator')).toEqual(['live', 'live', 'live']);
    expect(states('x402-base', 'moonbeam')).toEqual(['live', 'tested', 'partial']);
    // settle: the feature matrix still read broken (2026-11-14T20:18Z), before the sync that withdrew two nameless offerings;
    // Virtuals' own read of the operator's agent at 00:21Z shows all 13 offerings named, so the cell reads partial, with that proof
    expect(states('erc8183-base', 'operator')).toEqual(['live', 'tested', 'tested']);
    expect(at('erc8183-base').cohorts.operator.settle).toMatchObject({ from: 'features', state: 'tested' }); // coord's fork run of the sell path, kept as a run file
    // Moonbeam's Virtuals agent shows its house offerings: listed, read on the market itself through a house agent's journey
    expect(states('erc8183-base', 'moonbeam')).toEqual(['live', 'tested', 'tested']);
    expect(at('erc8183-base').cohorts.moonbeam.list).toMatchObject({ from: 'journey', state: 'live' });
    expect(states('memoacp-base', 'operator')).toEqual(['closed', 'closed', 'closed']);
    // a market the listed register closes to new providers reads closed for both cohorts
    expect(states('memoacp-base', 'moonbeam')).toEqual(['closed', 'closed', 'closed']);
    expect(states('workflow-nodes', 'moonbeam')).toEqual(['not yet', 'not yet', 'n/a']);
    expect(states('mcp', 'moonbeam')).toEqual(['live', 'tested', 'n/a']);
    expect(states('a2a', 'moonbeam')).toEqual(['live', 'tested', 'n/a']);
    expect(states('erc8004', 'moonbeam')).toEqual(['live', 'n/a', 'n/a']);
    expect(states('near-agent-market', 'operator')).toEqual(['live', 'live', 'partial']);
    expect(states('near-agent-market', 'moonbeam')).toEqual(['live', 'partial', 'partial']);
    expect(states('bitagent-base', 'moonbeam')).toEqual(['not yet', 'not yet', 'not yet']);
    // Moonbeam lists wherever the listed register holds no cut row for it
    expect([...MOONBEAM_LISTS_ON].sort()).toEqual(VENUES.filter((v) => !VENUE_REGISTER.markets.find((m) => m.id === v.id)?.cohorts?.moonbeam?.cut).map((v) => v.id).sort());
    expect(states('olas-base', 'moonbeam')).toEqual(['not yet', 'not yet', 'not yet']);
    expect(at('near-agent-market').cohorts.operator.listings).toBe(8);
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
    expect(cohortOf('moonbeam', f({ wanted: 1, journey: j }), steps, 'operator').list).toEqual({ state: 'live', says: 'shown', read_on: '2026-11-15T00:00:00Z', from: 'journey', who: null, publicState: 'not yet' });
    expect(cohortOf('operator', f({ journey: j }), steps, 'operator').list.state).toBe('not yet');
    // a closed market stays closed, whatever a journey says
    expect(cohortOf('moonbeam', f({ closed: 'closed to new providers', journey: j }), steps, 'operator').list.state).toBe('closed');
  });
  it('_VENUE_TRUTH_v2_: a mark says the state, its words and who moves it; owner steps and builds are not yet', () => {
    const feat = (mark: FeatureMark) => f({ listings: 1, features: { list: { mark, who: 'owner', says: 'w', read_at: '2026-11-14T23:00:00Z' } } });
    const steps = { list: r('live'), take: r('live'), settle: r('live') };
    expect(cohortOf('moonbeam', feat('ok'), steps, 'operator').list).toEqual({ state: 'live', says: 'w', read_on: '2026-11-14T23:00:00Z', from: 'features', who: 'owner', publicState: 'not yet' });
    for (const [mark, state] of [['partial', 'partial'], ['owner step', 'not yet'], ['not built', 'not yet'], ['broken', 'not yet']] as const)
      expect(cohortOf('moonbeam', feat(mark), steps, 'operator').list.state, mark).toBe(state);
    // a step with no mark falls back to the rules
    expect(cohortOf('moonbeam', feat('ok'), steps, 'operator').take.state).toBe('not yet');
  });
  it('docs/VENUES.md prints each shown market with Moonbeam\'s public words, and no row for a market with no proven step', () => {
    const doc = readFileSync(new URL('../docs/VENUES.md', import.meta.url), 'utf8');
    for (const v of VENUES) {
      const row = `| ${v.name} | ${v.does} | ${COHORT_STEPS.map((k) => v.cohorts.moonbeam[k].publicState).join(' | ')} |`;
      if (v.moonbeamLists && provenOnMainnet(v)) expect(doc, v.id).toContain(row);
      else expect(doc, v.id).not.toContain(`| ${v.name} |`);
    }
  });
  it('public text: no internal host, no workflow-tool name, no address', () => {
    expect(JSON.stringify(VENUES.map((v) => v.cohorts))).not.toMatch(/taifoon|\bn8n\b|0x[0-9a-f]{40}/i);
    expect(readFileSync(new URL('../src/market/venues-data.ts', import.meta.url), 'utf8')).not.toMatch(/taifoon|\bn8n\b|0x[0-9a-f]{40}/i);
  });
});

// _MAINNET_IO_v1_ (owner 2026-11-21): a customer reads two words. live needs the step's own live state AND a mainnet run kept whole.
describe('publicState: live only on a mainnet run kept as an I/O fixture', () => {
  const proof = (o: Partial<MainnetProof> = {}): MainnetProof => ({ op: 'list', ref: 'live:m/list@2026-11-06', on: '2026-11-06', run: 'test/io/fixtures/m/listed/run-live-list.json', steps: { listed: 'test/io/fixtures/m/listed/read-x.live-list-listed.json' }, proven: true, ...o });
  const steps = { list: r('live'), take: r('live'), settle: r('n/a', 'nothing settles') };
  const listed = f({ listings: 1, features: { list: { mark: 'ok', who: null, says: 'w', read_at: '2026-11-14T23:00:00Z' }, jobs_received: { mark: 'tested', who: null, says: 'w', read_at: '2026-11-14T23:00:00Z', fixture: 'test/io/fixtures/m/bought/run-fork-sell.json' } } });
  it('the public words are live, not yet and n/a, and nothing else', () => {
    expect([...PUBLIC_STATES]).toEqual(['live', 'not yet', 'n/a']);
    for (const s of Object.keys(STATE_RANK)) expect(PUBLIC_STATES, s).toContain(publicStateOf(s as VenueStepRow['state'], proof()));
    for (const s of ['cut', 'closed', 'shared'] as const) expect(publicStateOf(s, proof())).toBe('not yet');
  });
  it('a live state with its mainnet run and every recorded read is live, and names the run it stands on', () => {
    const c = cohortOf('moonbeam', listed, steps, 'operator', { list: proof() });
    expect(c.list).toMatchObject({ state: 'live', publicState: 'live', mainnet: { ref: 'live:m/list@2026-11-06', on: '2026-11-06', run: 'test/io/fixtures/m/listed/run-live-list.json' } });
    expect(c.settle.publicState).toBe('n/a');
  });
  it('a live state without its mainnet fixture is not yet: no run, a read still missing, or a run not kept whole', () => {
    expect(cohortOf('moonbeam', listed, steps, 'operator').list).toMatchObject({ state: 'live', publicState: 'not yet' });
    expect(cohortOf('moonbeam', listed, steps, 'operator', { list: proof({ steps: { listed: null }, proven: false }) }).list.publicState).toBe('not yet');
    expect(cohortOf('moonbeam', listed, steps, 'operator', { list: proof({ steps: { listed: null }, proven: true }) }).list.publicState, 'the reads decide, not the flag').toBe('not yet');
    expect(cohortOf('moonbeam', listed, steps, 'operator', { list: proof({ proven: false }) }).list.publicState).toBe('not yet');
    expect(cohortOf('moonbeam', listed, steps, 'operator', { list: proof() }).list.mainnet).toBeDefined();
    expect(cohortOf('moonbeam', listed, steps, 'operator', { list: proof({ proven: false }) }).list.mainnet).toBeUndefined();
  });
  it('a mainnet run lifts a step only where the market\'s own evidence state is live: a self-test or a claim stays not yet', () => {
    const c = cohortOf('moonbeam', listed, steps, 'operator', { list: proof(), jobs_received: proof({ op: 'sell' }) });
    expect(c.take).toMatchObject({ state: 'tested', publicState: 'live' });
    const claimed = { ...steps, take: r('not yet') };
    expect(cohortOf('moonbeam', listed, claimed, 'operator', { jobs_received: proof({ op: 'sell' }) }).take.publicState).toBe('not yet');
    const selfTest = { ...steps, take: r('self-test') };
    expect(cohortOf('moonbeam', listed, selfTest, 'operator', { jobs_received: proof({ op: 'sell' }) }).take.publicState).toBe('not yet');
    expect(cohortOf('moonbeam', f({ listings: 1, closed: 'closed to new agents' }), steps, 'operator', { list: proof() }).list.publicState).toBe('not yet');
  });
  it('a cohort never borrows another cohort\'s mainnet run', () => {
    const all = cohortsOf({ operator: listed, moonbeam: listed }, steps, 'operator', { moonbeam: { list: proof() } });
    expect(all.moonbeam.list.publicState).toBe('live'); expect(all.operator.list.publicState).toBe('not yet');
    expect(MAINNET_IO_OF).toBe('moonbeam');
    for (const v of VENUES) for (const k of COHORT_STEPS) expect(['not yet', 'n/a'], `${v.id}.operator.${k}`).toContain(v.cohorts.operator[k].publicState);
  });
  it('the shipped table: every public live has its run file and each recorded read on disk, read on that very run', () => {
    const at = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
    let live = 0;
    for (const v of VENUES) for (const k of COHORT_STEPS) {
      const c = v.cohorts.moonbeam[k];
      expect(PUBLIC_STATES, `${v.id}.${k}`).toContain(c.publicState);
      const p = VENUE_MAINNET[v.id]?.[STEP_FEATURE[k]];
      expect(c.publicState, `${v.id}.${k}`).toBe(publicStateOf(c.state, p, v[k].state));
      if (c.publicState !== 'live') { expect(c.mainnet, `${v.id}.${k}`).toBeUndefined(); continue; }
      live += 1;
      expect([c.state, v[k].state], `${v.id}.${k}`).toContain('live'); expect(v.moonbeamLists).toBe(true);
      const run = at(p!.run);
      expect([run.market, run.run.rung, run.run.ref]).toEqual([v.id, 'live', p!.ref]);
      expect(run.features).toContain(STEP_FEATURE[k]);
      expect(Object.keys(p!.steps)).toEqual(run.covers);
      for (const [step, file] of Object.entries(p!.steps)) {
        const fx = at(file!);
        // a priced door's own 402 with its terms is that step's answer; every other read answered 200
        expect([fx.market, fx.rung, fx.run, fx.path.step, fx.response.status], file!).toEqual([v.id, 'live', p!.ref, step, fx.wall === true ? 402 : 200]);
      }
    }
    expect(live).toBeGreaterThan(0);
    for (const v of VENUES) expect(provenOnMainnet(v), v.id).toBe(COHORT_STEPS.some((k) => v.cohorts.moonbeam[k].publicState === 'live'));
  });
});
