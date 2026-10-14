/**
 * @moonbeam-foundation/sdk/assurance: the job assurance machine as Moonbeam ACP runs it.
 *
 * The machine and the Moonbeam venue come from one shared, pinned file (assurance-shared.ts; do not edit it, it is
 * re-synced from its source). This module adds the Moonbeam rules on top: the hook lane at Moonbeam's hook version, and
 * GLMR as the only money (every amount from the job's own numbers, no price feed).
 */
import {
  quote as coreQuote, run, eventsOf, whoCanEnd, endingOf, VENUES,
  type Economy, type EconomyInput, type EconomyQuote, type NativeStep, type Terms, type State, type PathStep,
} from './assurance-shared.js';

export * from './assurance-shared.js';

/** Moonbeam ACP: the hook on Base, GLMR only, read only for public writes */
export const MOONBEAM = VENUES.moonbeam!;

/** a quote in GLMR only: any other token is refused before the economy is asked */
export function quoteGlmr(i: EconomyInput, economy: Economy): { ok: true; terms: Terms; quote: EconomyQuote } | { ok: false; why: string[] } {
  if (i.token.symbol !== 'GLMR') return { ok: false, why: [`Moonbeam ACP prices in GLMR only, not ${i.token.symbol}`] };
  return coreQuote({ ...i, attachment: 'hook' }, economy);
}

/** a Moonbeam job from its trail (event names or the hook's State enum): where it is, who may end it, how it ended */
export function readJob(trail: NativeStep[]): { ok: true; state: State; path: PathStep[]; ending: ReturnType<typeof endingOf>; exits: ReturnType<typeof whoCanEnd> } | { ok: false; error: string } {
  const ctx = MOONBEAM.ctx!;
  const r = run(eventsOf(trail), ctx);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, state: r.state, path: r.path, ending: endingOf({ ctx, state: r.state, path: r.path }), exits: whoCanEnd(r.state, ctx) };
}
