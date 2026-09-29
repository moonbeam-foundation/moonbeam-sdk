import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACP_TOPIC0,
  assertFullCoverage,
  blockers,
  decodeAcpLogs,
  foldTask,
  localClock,
  measureCoverage,
  parseUnits,
  readinessForBacker,
  readinessForChallenger,
  readinessForClient,
  readinessForDoubter,
  readinessForEvaluator,
  readinessForProvider,
  summarise,
  terminalTopics,
  toOutcome,
  WATCHED_EVENTS,
  watchedTopics,
  watchManifest,
} from '../src/index.js';
import type { JobTerms, RawLog } from '../src/index.js';
import fixture from './fixtures/base-job.json' with { type: 'json' };

const usdc = (v: string) => parseUnits(v);

const TERMS: JobTerms = {
  pay: usdc('100'),
  premium: usdc('1'),
  deposit: usdc('40'),
  evaluatorBond: usdc('25'),
  poolCapital: usdc('5000'),
  damage: usdc('70'),
};

/**
 * Onboarding blocks only what nobody would knowingly agree to, and cautions
 * about real risk that is nonetheless a legitimate choice. Blocking a
 * legitimate choice would be paternalism; letting an unintended loss through
 * would be negligence.
 */
describe('every actor is told what it risks before it commits', () => {
  const all = [
    readinessForClient({ terms: TERMS }),
    readinessForProvider({ terms: TERMS, freeCapital: usdc('1000') }),
    readinessForEvaluator({ terms: TERMS, freeCapital: usdc('1000'), canProve: true }),
    readinessForBacker({ terms: TERMS, backing: usdc('100'), poolCapital: usdc('5000'), openJobs: 10 }),
    readinessForDoubter({ terms: TERMS, notional: usdc('30'), feeBps: 34 }),
    readinessForChallenger({ terms: TERMS, bond: usdc('10') }),
  ];

  it.each(all)('states a bond and a risk for $role', (readiness) => {
    expect(readiness.youBond.length).toBeGreaterThan(0);
    expect(readiness.youRisk.length).toBeGreaterThan(0);
  });

  it('clears a well-formed intent for every actor', () => {
    for (const readiness of all) {
      expect(readiness.safe, summarise(readiness)).toBe(true);
    }
  });
});

describe('client', () => {
  it('warns when cover stops short of the damage', () => {
    const thin: JobTerms = { ...TERMS, poolCapital: usdc('5'), damage: usdc('500') };
    const findings = readinessForClient({ terms: thin }).findings;
    expect(findings.some((f) => f.message.includes('short of the damage'))).toBe(true);
  });

  it('refuses a job where the premium rounds away', () => {
    // Free cover is not a bargain: nobody is paid to carry the risk.
    const free: JobTerms = { ...TERMS, premium: 0n };
    const readiness = readinessForClient({ terms: free });
    expect(readiness.safe).toBe(false);
    expect(blockers(readiness)[0]?.message).toContain('nobody is being paid');
  });

  it('always says that a rejection pays no cover', () => {
    const notes = readinessForClient({ terms: TERMS }).findings.map((f) => f.message);
    expect(notes.some((m) => m.includes('only an adjudication'))).toBe(true);
  });
});

describe('provider', () => {
  it('blocks a job it cannot bond', () => {
    const readiness = readinessForProvider({ terms: TERMS, freeCapital: usdc('10') });
    expect(readiness.safe).toBe(false);
  });

  it('cautions when a deposit leaves no room for another job', () => {
    const readiness = readinessForProvider({ terms: TERMS, freeCapital: usdc('50') });
    expect(readiness.safe).toBe(true);
    expect(readiness.findings.some((f) => f.severity === 'caution')).toBe(true);
  });
});

describe('evaluator', () => {
  it('blocks when the bond cannot be posted', () => {
    expect(readinessForEvaluator({ terms: TERMS, freeCapital: usdc('1'), canProve: true }).safe).toBe(false);
  });

  /** An evaluator that cannot prove is still useful — it can refuse safely. */
  it('cautions rather than blocks when it cannot produce a proof', () => {
    const readiness = readinessForEvaluator({ terms: TERMS, freeCapital: usdc('1000'), canProve: false });
    expect(readiness.safe).toBe(true);
    expect(readiness.findings.some((f) => f.message.includes('reject but never approve'))).toBe(true);
  });
});

describe('backer', () => {
  it('blocks joining a pool that is already over-committed', () => {
    // The shortfall exists before you arrive; joining buys into it.
    const readiness = readinessForBacker({
      terms: TERMS, backing: usdc('100'), poolCapital: usdc('100'), openJobs: 50,
    });
    expect(readiness.safe).toBe(false);
    expect(blockers(readiness)[0]?.message).toContain('committed');
  });

  it('cautions when the premium is too low for the expected failure rate', () => {
    const readiness = readinessForBacker({
      terms: TERMS, backing: usdc('10'), poolCapital: usdc('5000'), openJobs: 1, expectedFailureRate: 0.5,
    });
    expect(readiness.findings.some((f) => f.message.includes('loses money'))).toBe(true);
  });

  it('cautions when one backer would be most of the pool', () => {
    const readiness = readinessForBacker({
      terms: TERMS, backing: usdc('9000'), poolCapital: usdc('1000'), openJobs: 1,
    });
    expect(readiness.findings.some((f) => f.message.includes('most of this pool'))).toBe(true);
  });
});

describe('doubter', () => {
  it('blocks a position larger than the capital that could pay it', () => {
    const readiness = readinessForDoubter({ terms: TERMS, notional: usdc('9000'), feeBps: 34 });
    expect(readiness.safe).toBe(false);
    expect(blockers(readiness)[0]?.message).toContain('can never pay out');
  });

  it('states the break-even failure rate', () => {
    const readiness = readinessForDoubter({ terms: TERMS, notional: usdc('30'), feeBps: 34 });
    expect(readiness.findings.some((f) => f.message.includes('break even'))).toBe(true);
  });
});

describe('challenger', () => {
  /** The payout is fixed at the evaluator's bond, so over-bonding only adds loss. */
  it('blocks a bond larger than the payout', () => {
    const readiness = readinessForChallenger({ terms: TERMS, bond: usdc('100') });
    expect(readiness.safe).toBe(false);
    expect(blockers(readiness)[0]?.message).toContain('loses money even when you are right');
  });

  it('blocks when the evaluator has no bond to win', () => {
    const readiness = readinessForChallenger({ terms: { ...TERMS, evaluatorBond: 0n }, bond: usdc('1') });
    expect(readiness.safe).toBe(false);
  });

  it('cautions when confidence is below break-even', () => {
    const readiness = readinessForChallenger({ terms: TERMS, bond: usdc('10'), confidence: 0.1 });
    expect(readiness.findings.some((f) => f.message.includes('confidence'))).toBe(true);
  });
});

/**
 * Decode coverage is a hard requirement: a decoder that silently skips an
 * event produces job histories with holes and no indication anything is
 * missing.
 */
describe('decode coverage', () => {
  const logs = fixture as RawLog[];

  it('reports total coverage on real chain logs', () => {
    const report = measureCoverage(logs);
    expect(report.coverage).toBe(1);
    expect(report.complete).toBe(true);
    expect(report.unknownTopics).toEqual({});
  });

  it('does not throw on fully-decodable logs', () => {
    expect(() => assertFullCoverage(logs)).not.toThrow();
  });

  it('fails loudly on an unrecognised event, naming the topic', () => {
    const unknown = `0x${'99'.repeat(32)}`;
    expect(() => assertFullCoverage([...logs, { topics: [unknown], data: '0x' }])).toThrow(/not 100%/);
    expect(() => assertFullCoverage([...logs, { topics: [unknown], data: '0x' }])).toThrow(unknown);
  });

  it('keeps a sample of each unknown topic so it can be identified', () => {
    const unknown = `0x${'99'.repeat(32)}`;
    const report = measureCoverage([{ topics: [unknown], data: '0xabcd' }]);
    expect(report.samples[unknown]?.data).toBe('0xabcd');
  });

  it('ignores logs that carry no topics at all', () => {
    // Not an unrecognised event — not an event. Counting it would inflate the gap.
    expect(measureCoverage([{ topics: [], data: '0x' }]).complete).toBe(true);
  });
});

describe('the watch list a proof layer indexes from', () => {
  it('publishes every topic the decoder recognises', () => {
    expect(watchedTopics()).toHaveLength(Object.keys(ACP_TOPIC0).length);
    expect(WATCHED_EVENTS).toHaveLength(Object.keys(ACP_TOPIC0).length);
  });

  /**
   * The pairing that matters: an indexer missing a terminal event leaves jobs
   * looking permanently unsettled, which is far less obvious than missing an
   * opening event.
   */
  it('marks the terminal events that must never be missed', () => {
    const terminal = terminalTopics();
    expect(terminal).toContain(ACP_TOPIC0.jobCompleted);
    expect(terminal).toContain(ACP_TOPIC0.jobRefunded);
    expect(terminal).toContain(ACP_TOPIC0.adjudicated);
    expect(terminal).not.toContain(ACP_TOPIC0.jobCreated);
  });

  it('separates the two lifecycles, which have different shapes', () => {
    expect(watchedTopics('virtuals-acp')).toContain(ACP_TOPIC0.jobCreated);
    expect(watchedTopics('virtuals-acp')).not.toContain(ACP_TOPIC0.taskOpened);
    expect(watchedTopics('moonbeam-acp')).toContain(ACP_TOPIC0.taskOpened);
  });

  it('covers every event decoded from real traffic', () => {
    // If live logs decode to an event that is not on the watch list, an indexer
    // built from the manifest would never have captured it.
    const seen = new Set(decodeAcpLogs(fixture as RawLog[]).map((e) => e.kind));
    const listed = new Set(WATCHED_EVENTS.map((e) => e.name));
    for (const kind of seen) expect(listed.has(kind as never)).toBe(true);
  });

  it('describes itself as plain data another language can read', () => {
    const manifest = watchManifest();
    expect(JSON.parse(JSON.stringify(manifest)).events.length).toBe(WATCHED_EVENTS.length);
    expect(manifest.ledgers.some((l) => l.deployed)).toBe(true);
  });

  it('records that only one of the two lifecycles is actually deployed', () => {
    const manifest = watchManifest();
    expect(manifest.ledgers.find((l) => l.id === 'moonbeam-acp')?.deployed).toBe(false);
  });
});

describe('folding is unaffected by onboarding', () => {
  it('still settles the real job', () => {
    expect(foldTask(decodeAcpLogs(fixture as RawLog[])).contradictions).toEqual([]);
  });
});

/**
 * Fixture coverage.
 *
 * A decoder that recognises an event type no fixture exercises has a path
 * nothing has ever run. This suite fails when a new type is added without a
 * fixture, which is the only way that gap stays visible.
 *
 * See test/fixtures/README.md for what each file holds and where it came from.
 */
describe('every event type has a fixture behind it', () => {
  const dir = join(import.meta.dirname, 'fixtures');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

  const allEvents = files.flatMap((f) =>
    decodeAcpLogs(JSON.parse(readFileSync(join(dir, f), 'utf8')) as RawLog[]),
  );
  const covered = new Set(allEvents.map((e) => e.kind));

  it.each(WATCHED_EVENTS.map((e) => e.name))('exercises %s', (name) => {
    expect(covered.has(name as never)).toBe(true);
  });

  it.each(files)('%s decodes completely', (file) => {
    const logs = JSON.parse(readFileSync(join(dir, file), 'utf8')) as RawLog[];
    expect(measureCoverage(logs).complete).toBe(true);
  });

  /**
   * A fixture that starts mid-lifecycle folds into a state no real job would
   * be in, so each one must carry a whole history and reach an ending.
   */
  it.each(files)('%s folds to a settled outcome', (file) => {
    const logs = JSON.parse(readFileSync(join(dir, file), 'utf8')) as RawLog[];
    const state = foldTask(decodeAcpLogs(logs));
    expect(state.contradictions).toEqual([]);
    expect(toOutcome(state, localClock(2_000_000_000)).verdict).not.toBeNull();
  });

  it('documents itself', () => {
    // The README is the only place the provenance of each capture is recorded.
    expect(existsSync(join(dir, 'README.md'))).toBe(true);
  });
});
