/**
 * A pick, the same on every surface: one agent (or listing, route, venue, job) read as one ref `<kind>:<venue>:<native>`, the body of
 * its hire, the answer read for your role and the moves on from it. The core is one module shared byte for byte with the Studio, the
 * CLI and the MCP tools (src/selection/selection.mjs, its language in src/selection/lang-data.ts), so the same input gives the same
 * answer here as there. This SDK runs in the reseller role: an answer keeps its operation links, never another surface's pages.
 *
 *   refOf(id)                       the ref an id names (no call)
 *   resolveRef(t, id, { need })     GET  /ref/:ref      what it is, its seller and its moves, each with the body it sends
 *   quote(t, need, { ref })         POST /demands       a dry run: the match and its terms for the pick, nothing opened
 *   hire(t, need, { ref })          POST /demands       the hire of the pick (keyed): the loop hires that seller first
 *   readAnswer(body)                the seller, the example, the job and the links of an answer, for your role
 */
import { selection, type Answer, type HireBody, type MoveOut, type Ref, type RefRead } from '../selection/selection.mjs';
import { SELECTION_LANG } from '../selection/lang-data.js';
import type { OnboardTransport } from '../onboard/index.js';
import { call, needKey, query, seg } from './http.js';

export type { Answer, HireBody, MoveOut, Ref, RefRead };
/** The role this SDK runs in. */
export const PICK_ROLE = 'reseller';
const core = selection(SELECTION_LANG);

/** The ref an id names when its shape says so (a typed ref, a tree, map or cohort id, a registry agent `<chain>:<agent id>`); any
 *  other id (a listing, a catalogue entry, a seller key) is read by `resolveRef`. No call. */
export const refOf = (id: string): RefRead => core.refOf(id);
/** The body of a pick's hire: a dry run unless `run`. */
export const hireBody = (need: string, o: { ref?: string | null; run?: boolean } = {}): HireBody => core.hireBody(need, o);
/** What an answer shows in a role (this SDK's by default): the matched seller, the class's example need, the job and its links. */
export const readAnswer = (body: unknown, role: string = PICK_ROLE): Answer => core.readAnswer(body, role);
/** The moves from a ref, each with the operation and body it sends; one that acts says it needs a key. */
export const movesOf = (ref: Ref, o: { need?: string | null; signedIn?: boolean } = {}): MoveOut[] => core.movesOf(ref, o);

export type Resolved = { ok: true; ref: Ref; text: string; seller: { catalog_id: string; seller: string | null; via: string } | null; moves: MoveOut[] };
/** One pick read as its ref, its seller and its moves (`GET /ref/:ref`). */
export async function resolveRef(t: OnboardTransport, id: string, o: { need?: string } = {}): Promise<Resolved> {
  return call<Resolved>(t, 'GET', `/ref/${seg(id)}${query({ need: o.need })}`);
}
/** A dry run of the pick's hire (`POST /demands` with `dry_run`): the seller it matched, the class and the terms. Nothing is opened. */
export async function quote(t: OnboardTransport, need: string, o: { ref?: string | null } = {}): Promise<Record<string, unknown>> {
  return call<Record<string, unknown>>(t, 'POST', '/demands', core.hireBody(need, { ref: o.ref ?? null }));
}
/** The hire of the pick (`POST /demands`, keyed): the loop hires that seller first, grades the reply by code and settles it. */
export async function hire(t: OnboardTransport, need: string, o: { ref?: string | null } = {}): Promise<Record<string, unknown>> {
  needKey(t, 'POST /demands');
  return call<Record<string, unknown>>(t, 'POST', '/demands', core.hireBody(need, { ref: o.ref ?? null, run: true }));
}
