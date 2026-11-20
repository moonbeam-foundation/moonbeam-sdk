// THE STATES OF A SALE: every state of the commerce machine with the one read that shows it. The table is generated
// (scripts/gen-states.mjs): ids, steps, kinds, lights, labels, reads and legal moves, nothing typed by hand.
import type { OnboardTransport } from '../onboard/index.js';
import { MarketError, call } from './http.js';
import { MOVES_DATA, STATES_DATA } from './states-data.js';

/** where a state sits in the sale's six steps */
export type StateStep = (typeof STATES_DATA)[number]['step'];
/** `stage` (the main line), `held` (waiting) or `terminal` (ended) */
export type StateKind = (typeof STATES_DATA)[number]['kind'];
export type StateId = (typeof STATES_DATA)[number]['id'];
export type State = {
  id: StateId;
  step: StateStep;
  kind: StateKind;
  /** the light the state shows: green, amber, red or off (null on the main line, where the read decides) */
  led: 'green' | 'amber' | 'red' | 'off' | null;
  label: string;
  /** the one read that shows this state */
  read: { method: 'GET'; path: string };
};
export type Move = { from: StateId; to: StateId };
export type StateRead = { state: State; status: number; body: unknown };

/** every state, in the machine's order */
export const STATES: readonly State[] = Object.freeze(STATES_DATA.map((s) => Object.freeze({ ...s, read: Object.freeze({ ...s.read }) })) as State[]);
/** the legal moves between states */
export const MOVES: readonly Move[] = Object.freeze(MOVES_DATA.map((m) => Object.freeze({ ...m })) as Move[]);

/** One state by id; throws for an id the machine does not have. */
export function stateOf(id: string): State {
  const s = STATES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown state "${id}": one of ${STATES.map((x) => x.id).join(', ')}`);
  return s;
}

/** The read's path with its `:placeholders` filled from `params`; throws for one that is missing. */
export function statePath(state: State, params: Record<string, string | number> = {}): string {
  return state.read.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_m, k: string) => {
    const v = params[k];
    if (v === undefined || v === null || v === '') throw new Error(`state "${state.id}" reads ${state.read.path}: missing param "${k}"`);
    return encodeURIComponent(String(v));
  });
}

/** Read one state: GET its route (the path is /v1/..., the transport's base already ends in it). A refusal answers its status and body. */
export async function readState(t: OnboardTransport, id: string, params: Record<string, string | number> = {}): Promise<StateRead> {
  const state = stateOf(id);
  const path = statePath(state, params).replace(/^\/v1/, '');
  try {
    return { state, status: 200, body: await call<unknown>(t, 'GET', path) };
  } catch (e) {
    if (e instanceof MarketError) return { state, status: e.status, body: e.body };
    throw e;
  }
}
