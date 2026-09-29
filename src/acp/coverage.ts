import { decodeAcpLog } from './events.js';
import type { AcpEvent, RawLog } from './events.js';

/**
 * Decode coverage — proving the decoder sees everything, not just something.
 *
 * A decoder that silently skips an event it does not recognise is worse than
 * one that fails loudly: the caller gets a job history with a hole in it and no
 * indication that anything is missing. A settled job can look pending, a
 * refunded one can look live, and nothing anywhere says why.
 *
 * So coverage is measured rather than assumed, and an unrecognised topic is
 * surfaced with enough detail to identify it. The intended use is a standing
 * check against live traffic: anything less than total coverage means the
 * protocol emitted something this build has never seen.
 */

export interface CoverageReport {
  readonly total: number;
  readonly decoded: number;
  /** Fraction in [0,1]. A partial history is not a usable history. */
  readonly coverage: number;
  readonly complete: boolean;
  /** Unrecognised topic0s, with how many logs carried each. */
  readonly unknownTopics: Readonly<Record<string, number>>;
  /** One example log per unknown topic, to make identification possible. */
  readonly samples: Readonly<Record<string, RawLog>>;
  readonly events: readonly AcpEvent[];
}

export function measureCoverage(logs: readonly RawLog[]): CoverageReport {
  const events: AcpEvent[] = [];
  const unknownTopics: Record<string, number> = {};
  const samples: Record<string, RawLog> = {};

  for (const log of logs) {
    const event = decodeAcpLog(log);
    if (event) {
      events.push(event);
      continue;
    }
    const topic0 = log.topics?.[0]?.toLowerCase();
    // A log with no topics is not an unrecognised event, it is not an event at
    // all — counting it would inflate the gap with noise.
    if (!topic0) continue;
    unknownTopics[topic0] = (unknownTopics[topic0] ?? 0) + 1;
    samples[topic0] ??= log;
  }

  const total = logs.length;
  const decoded = events.length;
  return {
    total,
    decoded,
    coverage: total === 0 ? 1 : decoded / total,
    complete: Object.keys(unknownTopics).length === 0,
    unknownTopics,
    samples,
    events,
  };
}

/**
 * Throw unless every log decoded.
 *
 * For the standing check against live traffic: a new event type appearing in
 * production should break a build, not quietly degrade every job history the
 * SDK produces afterwards.
 */
export function assertFullCoverage(logs: readonly RawLog[]): CoverageReport {
  const report = measureCoverage(logs);
  if (!report.complete) {
    const detail = Object.entries(report.unknownTopics)
      .map(([topic, count]) => `${topic} (${count} logs)`)
      .join(', ');
    throw new Error(
      `decode coverage is ${(report.coverage * 100).toFixed(2)}%, not 100%. ` +
        `Unrecognised topic0: ${detail}. ` +
        `Add the event to ACP_TOPIC0 and ACP_SIGNATURES, or the job histories built from these logs will have gaps.`,
    );
  }
  return report;
}
