// lang/emit/selection.mjs (types: selection.d.mts) — _SELECTION_v1_: the ONE selection core (taifoon-web docs/design/studio-selection.md). A pick is one typed
// ref, `<kind>:<venue>:<native>`; this reads any id a surface holds as that ref, builds the body of its hire, reads the answer for a
// role and lists the moves on from it. Every surface that picks (taifoon-web Studio, Genie and MCP, the taifoon CLI, the Moonbeam SDK)
// holds a byte copy of this file beside lang/gen/selection.json (consumers.json selection-*) and runs lang/vectors/selection-cases.json, so
// one input gives one answer everywhere. The role is a parameter: the house and a reseller call the same operations with the same
// bodies, and a reseller is shown operations only.
// Pure: the language (kinds, venues, roles, reasons, moves) is passed in, so nothing here is a list of its own.

const NATIVE = /^[^\s<>"'\\]{1,200}$/;
const REGISTRY_ID = /^(\d{1,12}):(\d{1,40})$/;
const COHORT_ID = /^grid:([a-z0-9][a-z0-9._-]{0,62})\/(.+)$/;
const TREE_PREFIX = 'agent:';

/**
 * @typedef {{ kind: string, venue: string, native: string }} Ref
 * @typedef {{ ok: true, ref: Ref, text: string } | { ok: false, reason: string }} RefRead
 * @typedef {{ id: string, op: { method: string, name: string }, kinds: string[], needs: string, body: string }} Move
 * @typedef {{ kinds: string[], venues: string[], registry_venue: string, roles: Record<string, { pages: boolean }>,
 *   op_prefix: string, reasons: { malformed: string, unknown: string, conflict: string }, moves: Move[] }} SelectionLang
 */

/** The core over one language (lang/gen/selection.json). @param {SelectionLang} lang */
export function selection(lang) {
  const kinds = new Set(lang.kinds);
  const venues = new Set(lang.venues);
  const R = lang.reasons;
  const no = (reason) => ({ ok: false, reason });
  /** @param {Ref} r @returns {RefRead} */
  const yes = (r) => ({ ok: true, ref: r, text: `${r.kind}:${r.venue}:${r.native}` });
  const agent = (venue, native) => (venues.has(venue) && NATIVE.test(native) ? yes({ kind: 'agent', venue, native }) : null);

  /** A typed ref as written: `<kind>:<venue>:<native>`, the kind and the venue of the language. @param {unknown} raw @returns {RefRead} */
  function parseRef(raw) {
    if (typeof raw !== 'string') return no(R.malformed);
    const s = raw.trim();
    const a = s.indexOf(':'); const b = a < 0 ? -1 : s.indexOf(':', a + 1);
    if (b < 0) return no(R.malformed);
    const kind = s.slice(0, a); const venue = s.slice(a + 1, b); const native = s.slice(b + 1);
    if (!kinds.has(kind) || !venues.has(venue) || !NATIVE.test(native)) return no(R.malformed);
    return yes({ kind, venue, native });
  }

  /** Any id a surface holds, read as a ref when its shape alone says what it names: a typed ref, a tree id (`agent:<id>`), a cohort id
   *  (`grid:<venue>/<native>`), a venue's own id (`<venue>.<native>`) or a registry agent (`<chain>:<agent id>`). Any other id (a
   *  listing, a catalogue entry, a seller key, an endpoint) is the store's to read: ref_unknown here. @param {unknown} raw @returns {RefRead} */
  function refOf(raw) {
    if (typeof raw !== 'string') return no(R.malformed);
    const s = raw.trim();
    if (!s || !NATIVE.test(s)) return no(R.malformed);
    const typed = parseRef(s);
    if (typed.ok) return typed;
    if (s.startsWith(TREE_PREFIX)) return refOf(s.slice(TREE_PREFIX.length));
    const reg = REGISTRY_ID.exec(s);
    if (reg) return agent(lang.registry_venue, `${reg[1]}:${reg[2]}`) ?? no(R.unknown);
    const cohort = COHORT_ID.exec(s);
    if (cohort) return agent(cohort[1], cohort[2]) ?? no(R.unknown);
    const dot = s.indexOf('.');
    if (dot > 0) { const r = agent(s.slice(0, dot), s.slice(dot + 1)); if (r) return r; }
    return no(R.unknown);
  }

  /** The body of a pick's hire: what is needed, the pick as its seller, a dry run unless it runs.
   *  @param {string} need @param {{ ref?: string | null, run?: boolean }} [o] */
  function hireBody(need, o = {}) {
    const ref = typeof o.ref === 'string' && o.ref.trim() ? { ref: o.ref.trim() } : {};
    return o.run ? { need: String(need).trim(), ...ref } : { need: String(need).trim(), ...ref, dry_run: true };
  }

  /** What a surface in a role shows of a hire's answer: the matched seller, the class example when the words did not fit, the job,
   *  and its links. A role without pages keeps the operation links only. @param {unknown} body @param {string} role */
  function readAnswer(body, role) {
    const r = lang.roles[role];
    if (!r) throw new TypeError(`no role ${role}`);
    const at = (o, k) => (o && typeof o === 'object' ? o[k] : undefined);
    const str = (v) => (typeof v === 'string' && v ? v : null);
    const seller = str(at(at(body, 'picked'), 'seller')) ?? str(at(at(body, 'catalog'), 'seller'));
    const cands = at(body, 'candidates');
    const example = (Array.isArray(cands) ? cands : []).map((c) => str(at(c, 'example'))).find(Boolean) ?? null;
    const job = str(at(at(body, 'demand'), 'id')) ?? str(at(body, 'id'));
    const given = at(body, 'links');
    const links = Object.fromEntries(Object.entries(given && typeof given === 'object' ? given : {})
      .filter(([, v]) => typeof v === 'string' && (r.pages || v.startsWith(lang.op_prefix))));
    return { seller, example, job, links, reason: str(at(body, 'code')) };
  }

  /** The moves from a pick, for a role: each names its operation and the body it sends; a move that needs a sign-in says so.
   *  @param {Ref} ref @param {{ need?: string | null, signedIn?: boolean }} [o] */
  function movesOf(ref, o = {}) {
    const text = `${ref.kind}:${ref.venue}:${ref.native}`;
    return lang.moves.filter((m) => m.kinds.includes(ref.kind)).map((m) => ({
      id: m.id, op: m.op, needs: m.needs === 'sign_in' && o.signedIn ? 'nothing' : m.needs,
      body: m.body === 'none' || !o.need ? null : hireBody(o.need, { ref: text, run: m.body === 'hire' }),
    }));
  }

  return { parseRef, refOf, hireBody, readAnswer, movesOf };
}
