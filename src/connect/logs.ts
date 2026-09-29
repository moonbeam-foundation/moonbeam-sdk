import type { RawLog } from '../acp/events.js';
import { err, ok } from './result.js';
import type { LookupError, Result } from './result.js';

/**
 * Reading event logs, with the guards that experience demands.
 *
 * Two failure modes are common enough to design against, and both are
 * dangerous precisely because they look like success:
 *
 *   1. Some providers return an empty log set instead of an error. An empty
 *      result is indistinguishable from a genuinely quiet range, so a caller
 *      concludes "nothing happened" when the truth is "nobody looked".
 *   2. Some providers reject wide block ranges. A query that silently fails
 *      leaves a hole in history that later reads never revisit.
 *
 * The answer to both is to make emptiness explicit and paging automatic.
 */

export interface LogQuery {
  readonly fromBlock: number;
  readonly toBlock: number;
  readonly address?: string;
  readonly topics?: readonly (string | null)[];
}

export interface LogSource {
  logs(query: LogQuery): Promise<Result<readonly RawLog[], LookupError>>;
}

/**
 * Largest span a single query may cover.
 *
 * Chosen because widely used endpoints reject anything larger. Paging below
 * this is always safe; above it, results may be silently truncated.
 */
export const MAX_BLOCK_SPAN = 1_800;

export function splitRange(fromBlock: number, toBlock: number, span = MAX_BLOCK_SPAN): LogQuery[] {
  if (toBlock < fromBlock) return [];
  const pages: LogQuery[] = [];
  for (let start = fromBlock; start <= toBlock; start += span) {
    pages.push({ fromBlock: start, toBlock: Math.min(start + span - 1, toBlock) });
  }
  return pages;
}

export interface FetchLogsOptions {
  readonly span?: number;
  /**
   * Treat an empty result as authoritative.
   *
   * Defaults to `false`: an empty page is reported as `noData` rather than as
   * "no events", because the two are not the same and only the caller knows
   * whether its source is one that lies about emptiness.
   */
  readonly trustEmpty?: boolean;
}

/**
 * Read a block range in safe-sized pages.
 *
 * Stops at the first page that fails, rather than returning a partial history
 * that looks complete — a gap silently swallowed here becomes a wrong verdict
 * later.
 */
export async function fetchLogRange(
  source: LogSource,
  query: LogQuery,
  options: FetchLogsOptions = {},
): Promise<Result<readonly RawLog[], LookupError>> {
  const pages = splitRange(query.fromBlock, query.toBlock, options.span ?? MAX_BLOCK_SPAN);
  const collected: RawLog[] = [];

  for (const page of pages) {
    const result = await source.logs({ ...query, ...page });
    if (!result.ok) return result;
    collected.push(...result.value);
  }

  if (collected.length === 0 && !options.trustEmpty) {
    return err({
      kind: 'noData',
      detail: `no logs in blocks ${query.fromBlock}-${query.toBlock}; empty results are not treated as authoritative`,
    });
  }

  return ok(collected);
}
