#!/usr/bin/env node
// Every venue's state, as the Moonbeam product's market register reads it, as a typed module: src/market/venues-data.ts.
//   node scripts/gen-venues.mjs --from <business-agent.json>   take a new snapshot of the register (src/market/venues-register.json)
//   node scripts/gen-venues.mjs --listed <listed.json>         take a new snapshot of the listed register's per-cohort facts
//   node scripts/gen-venues.mjs --features <features.json>     take a new snapshot of the feature matrix's marks, per market and cohort
//                                                               (GET /v1/listed?view=features: list, jobs received, pay, settle)
//   node scripts/gen-venues.mjs --journey <a.json,b.json>      take the house agents' journeys (GET /v1/listed?agent=<ref>&view=journey):
//                                                               a market whose own read shows a house agent listed by Moonbeam
//   node scripts/gen-venues.mjs --market-read <read.json>      a market's own read that is newer than a broken mark of the matrix and
//                                                               shows its fault gone (Virtuals ACP: every shown offering carries a name
//                                                               the cohort's seller answers to): the mark becomes partial, with its proof
//   node scripts/gen-venues.mjs --registry <venues-registry.json> the list step's markets, from coord's venue rows (lang/gen/venues-registry.json,
//                                                               their list_market, _LIST_MARKET_v1_): which market id lists an agent on which venue
//   node scripts/gen-venues.mjs                                  write src/market/venues-data.ts from the snapshot
//   node scripts/gen-venues.mjs --check                          fail when the module is not the snapshot's
// The snapshot keeps, per market, the register's list/take/settle state, the proof behind each with its words and read date, and the
// proof of the seller's payout. With --listed it also keeps, per market and cohort, what the listed register holds (_VENUE_TRUTH_v1_):
// how many listings, the directories that show them, a listing shared from the other cohort, a market closed to new agents, and how
// many listings are still wanted. --from and --listed each refresh their own part and keep the other. Public text never names the
// register's internal ids or hosts: the scrub below fails the run if it would.
import { readFileSync, writeFileSync } from 'node:fs';
import { isIoFixture } from './tested-fixture.mjs';
const snap = new URL('../src/market/venues-register.json', import.meta.url);
const out = new URL('../src/market/venues-data.ts', import.meta.url);
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };

// the register's id of the workflow-node market is renamed; every other id is kept
import { RENAME, publicText } from './market-ids.mjs';
// _VENUE_TRUTH_v1_: the operator's cohort is named by its role (`operator`; 0.12 snapshots said `layer`); the register's evidence was read for it
const COHORT_RENAME = { taifoon: 'operator', layer: 'operator' };
const COHORTS = ['operator', 'moonbeam'];
const EVIDENCE_OF = 'operator';
const FORBIDDEN = /taifoon|\bn8n\b|0x[0-9a-fA-F]{40}|\bthe layer\b/i;
const STEPS = ['list', 'take', 'settle'];
const scrubbed = (data, what) => {
  const text = JSON.stringify(data, null, 1);
  const bad = text.match(FORBIDDEN); if (bad) throw new Error(`the ${what} would carry "${bad[0]}" into public text: scrub it first`);
  return text;
};

let prior = null; try { prior = JSON.parse(readFileSync(snap, 'utf8')); } catch { /* no snapshot yet */ }

const from = arg('--from');
const listedPath = arg('--listed');
const featuresPath = arg('--features');
const journeyPaths = arg('--journey')?.split(',').filter(Boolean) ?? null;
const marketReadPath = arg('--market-read');
const registryPath = arg('--registry');
// _VENUE_TRUTH_v2_: the feature matrix's features each SDK step reads (src/market/cohorts.ts STEP_FEATURE holds the same mapping;
// test/cohorts.test.ts fails when the snapshot lacks one), and its marks as they are written
const FEATURES = ['list', 'jobs_received', 'pay', 'settle'];
const MARKS = ['ok', 'tested', 'partial', 'not built', 'owner step', 'broken'];
// a market's own read, never the register's row, moves a cohort's list from a journey
const OWN_READ = (kind) => typeof kind === 'string' && kind !== 'register_row';
// the stricter words of public text written by this generator from the feature matrix and the journeys
const PLAIN = /taifoon|\bn8n\b|0x[0-9a-fA-F]{40}|the layer|genie|\[internal\]|markup|checked before you pay/i;
const plain = (t) => (typeof t === 'string' && !PLAIN.test(t) ? t : null);
if (from || listedPath || featuresPath || journeyPaths || marketReadPath || registryPath) {
  let markets = prior?.markets ?? [];
  let source = prior?.source ?? null;
  if (from) {
    const reg = JSON.parse(readFileSync(from, 'utf8'));
    if (!reg.markets || !Array.isArray(reg.market_order)) throw new Error(`${from} is not the market register (no markets / market_order)`);
    source = reg.marker ?? null;
    markets = reg.market_order.map((id) => {
      const m = reg.markets[id]; if (!m) throw new Error(`market ${id} is in market_order but not in markets`);
      const ev = m.evidence ?? {};
      // an outside seller is not named in public text: a host in brackets is dropped
      // and so is a note in brackets that names an internal repo or tool
      const words = (t) => (typeof t === 'string' ? publicText(t).replace(/\bthe layer['’]s\b/gi, 'the operator’s').replace(/\bthe layer\b/gi, 'the operator').replace(/\s*\((?:[a-z0-9-]+\.)+[a-z]{2,}\)/gi, '').replace(/\s*\([^()]*(?:taifoon|\bn8n\b)[^()]*\)/gi, '') : null);
      const step = (s) => ({ register: m.sell?.[s] ?? 'none', proof: ev[s]?.proof ?? 'none', says: words(ev[s]?.says), read_on: ev[s]?.read_on ?? null });
      const mid = RENAME[id] ?? id;
      const kept = prior?.markets?.find((x) => x.id === mid)?.cohorts;
      return {
        id: mid,
        entry: { cost: m.entry?.cost ?? 'unknown', done: m.entry?.done === true, what: words(m.entry?.what) },
        ...Object.fromEntries(STEPS.map((s) => [s, step(s)])),
        paid: ev.payout ? { proof: ev.payout.proof, says: words(ev.payout.says), read_on: ev.payout.read_on } : null,
        ...(kept ? { cohorts: kept } : {}),
      };
    });
  }
  let cohorts = prior?.cohorts ?? null;
  if (listedPath) {
    const listed = JSON.parse(readFileSync(listedPath, 'utf8'));
    if (!Array.isArray(listed.rows) || !Array.isArray(listed.wanted)) throw new Error(`${listedPath} is not the listed register (no rows / wanted)`);
    const cohortOf = (c) => { const id = COHORT_RENAME[c] ?? c; if (!COHORTS.includes(id)) throw new Error(`unknown cohort ${c} in ${listedPath}`); return id; };
    const marketOf = (m) => RENAME[m] ?? m;
    const ids = new Set(markets.map((m) => m.id));
    for (const r of [...listed.rows, ...listed.wanted]) if (!ids.has(marketOf(r.market))) throw new Error(`the listed register names market ${r.market}, which the register snapshot does not hold`);
    // a directory is named by its own name, and a shared listing by its reason, each without the note in brackets
    const dirName = (v) => v.replace(/\s*\(.*\)\s*$/, '').trim();
    // a closed market is said by the first clause of its reason
    const clause = (w) => w.split(':')[0].trim();
    const factsOf = (cohort, market) => {
      const rows = listed.rows.filter((r) => cohortOf(r.cohort) === cohort && marketOf(r.market) === market);
      const wanted = listed.wanted.filter((w) => cohortOf(w.cohort) === cohort && marketOf(w.market) === market);
      const own = rows.filter((r) => !r.shared);
      // the market's own read of a shared listing says it best; a directory's copy comes after
      const shared = rows.filter((r) => r.shared).sort((a, b) => Number(!!a.via) - Number(!!b.via))[0];
      const closed = wanted.find((w) => w.closed === true);
      // _MARKETS_CUT_v2_: the owner cut this market from the cohort (listed.cue who: "cut"); coord is the one source of the cut
      const cut = wanted.find((w) => w.who === 'cut');
      return {
        listings: own.filter((r) => !r.via).length,
        directories: [...new Set(own.filter((r) => r.via).map((r) => dirName(r.via)))],
        // _SHARED_WORDS_v1_ (2026-11-15: "the layer's one ERC-8004 agent" reached public text): the operator cohort is named by its role
        shared: shared ? dirName(shared.shared).replace(/\bthe layer['’]s\b/gi, 'the operator’s').replace(/\bthe layer\b/gi, 'the operator') : null,
        closed: closed ? clause(closed.why) : null,
        cut: cut ? plain(cut.why) ?? 'the owner cut this market' : null,
        wanted: wanted.filter((w) => w.closed !== true && w.who !== 'cut').length,
        since: rows.map((r) => r.since).filter(Boolean).sort().at(-1) ?? null,
      };
    };
    // the feature matrix and journey reads are their own parts: a --listed refresh keeps them
    const keep = (m, c) => { const k = m.cohorts?.[c] ?? {}; return { ...(k.features ? { features: k.features } : {}), ...(k.journey ? { journey: k.journey } : {}) }; };
    markets = markets.map((m) => ({ ...m, cohorts: Object.fromEntries(COHORTS.map((c) => [c, { ...factsOf(c, m.id), ...keep(m, c) }])) }));
    cohorts = { ...(cohorts ?? {}), source: listed.rule ?? null, approved_on: listed.approved?.on ?? null, evidence_of: EVIDENCE_OF, ids: COHORTS };
  }
  if (featuresPath) {
    const fm = JSON.parse(readFileSync(featuresPath, 'utf8'));
    if (fm.rule !== 'LISTED_FEATURES_v1' || !Array.isArray(fm.cells)) throw new Error(`${featuresPath} is not the feature matrix (rule LISTED_FEATURES_v1, cells)`);
    const ids = new Set(markets.map((m) => m.id));
    const cohortOf = (c) => { const id = COHORT_RENAME[c] ?? c; if (!COHORTS.includes(id)) throw new Error(`unknown cohort ${c} in ${featuresPath}`); return id; };
    const cells = fm.cells.filter((x) => FEATURES.includes(x.feature));
    for (const x of cells) {
      if (!ids.has(RENAME[x.venue_id] ?? x.venue_id)) throw new Error(`the feature matrix names market ${x.venue_id}, which the register snapshot does not hold`);
      if (!MARKS.includes(x.mark)) throw new Error(`the feature matrix marks ${x.venue_id}.${x.feature} '${x.mark}', not one of ${MARKS.join(', ')}`);
      // _VENUE_TESTED_v1_: a tested mark stands only on Moonbeam's own end-to-end run kept here as an I/O fixture (test/io/…)
      if (x.mark === 'tested' && !isIoFixture(x.fixture))
        throw new Error(`the feature matrix marks ${x.venue_id}.${x.feature} tested, but its fixture ${x.fixture ?? '(none)'} is not an I/O fixture of this SDK`);
    }
    // the operator cohort's own words name the operator, so only Moonbeam's are kept, and only when they are plain
    const featuresOf = (c, id) => {
      const mine = cells.filter((x) => cohortOf(x.cohort) === c && (RENAME[x.venue_id] ?? x.venue_id) === id);
      if (!mine.length) return null;
      return Object.fromEntries(FEATURES.filter((f) => mine.some((x) => x.feature === f)).map((f) => {
        const x = mine.find((y) => y.feature === f);
        return [f, { mark: x.mark, who: x.who ?? null, says: c === 'moonbeam' ? plain(x.how) : null, read_at: x.read_at ?? fm.read_at ?? null, ...(x.mark === 'tested' ? { fixture: x.fixture } : {}) }];
      }));
    };
    markets = markets.map((m) => ({ ...m, cohorts: Object.fromEntries(COHORTS.map((c) => {
      const prev = m.cohorts?.[c] ?? { listings: 0, directories: [], shared: null, closed: null, wanted: 0, since: null };
      const { features: _f, ...rest } = prev; const f = featuresOf(c, m.id);
      return [c, { ...rest, ...(f ? { features: f } : {}) }];
    })) }));
    const at = cells.map((x) => x.read_at).filter(Boolean).sort().at(-1) ?? fm.read_at ?? null;
    cohorts = { ...(cohorts ?? { source: null, approved_on: null, evidence_of: EVIDENCE_OF, ids: COHORTS }), features: { source: fm.rule, read_at: at } };
  }
  if (journeyPaths) {
    const reads = journeyPaths.map((p) => { const j = JSON.parse(readFileSync(p, 'utf8')); if (j.schema !== 'listed.journey.v1') throw new Error(`${p} is not listed.journey.v1`); return j; });
    for (const j of reads) if (j.agent?.kind !== 'house') throw new Error(`the journey of ${j.agent?.ref} is not a house agent's: only Moonbeam's own agents say where Moonbeam is listed`);
    const listedOn = (id) => {
      const hits = reads.flatMap((j) => j.venues.filter((v) => (RENAME[v.venue_id] ?? v.venue_id) === id && v.standing === 'listed_by_moonbeam' && OWN_READ(v.proof?.kind))
        .map((v) => ({ standing: v.standing, ref: j.agent.ref, proof: v.proof.kind, says: plain(v.why), read_at: v.proof.read_at ?? j.read_at })));
      return hits.sort((a, b) => String(b.read_at).localeCompare(String(a.read_at)))[0] ?? null;
    };
    markets = markets.map((m) => {
      const prev = m.cohorts?.moonbeam ?? { listings: 0, directories: [], shared: null, closed: null, wanted: 0, since: null };
      const { journey: _j, ...rest } = prev; const j = listedOn(m.id);
      return { ...m, cohorts: { ...(m.cohorts ?? {}), moonbeam: { ...rest, ...(j ? { journey: j } : {}) } } };
    });
    const at = reads.map((j) => j.read_at).filter(Boolean).sort().at(-1) ?? null;
    cohorts = { ...(cohorts ?? { source: null, approved_on: null, evidence_of: EVIDENCE_OF, ids: COHORTS }), journey: { source: 'listed.journey.v1', agents: reads.map((j) => j.agent.ref), read_at: at } };
  }
  if (marketReadPath) {
    // { kind: 'virtuals.agent', cohort, venue: 'erc8183-base', url, read_at, body: <GET api.acp.virtuals.io/agents/:id>, seller_names: [...] }
    const mr = JSON.parse(readFileSync(marketReadPath, 'utf8'));
    if (mr.kind !== 'virtuals.agent' || mr.venue !== 'erc8183-base' || !mr.read_at || !Array.isArray(mr.seller_names)) throw new Error(`${marketReadPath} is not a Virtuals ACP agent read (kind, venue, read_at, body, seller_names)`);
    const cohort = COHORT_RENAME[mr.cohort] ?? mr.cohort; if (!COHORTS.includes(cohort)) throw new Error(`unknown cohort ${mr.cohort} in ${marketReadPath}`);
    const rec = mr.body?.data ?? mr.body;
    const shown = (rec?.offerings ?? []).filter((o) => !o.isHidden);
    const known = new Set(mr.seller_names);
    const onBase = (rec?.chains ?? []).some((c) => Number(c.chainId) === 8453 && c.erc8004AgentId);
    const healed = onBase && shown.length > 0 && shown.every((o) => typeof o.name === 'string' && o.name.trim() && known.has(o.name));
    markets = markets.map((m) => {
      if (m.id !== mr.venue) return m;
      const f = m.cohorts?.[cohort]?.features ?? {};
      const fixed = Object.fromEntries(Object.entries(f).map(([id, x]) => [id, healed && x.mark === 'broken' && String(x.read_at ?? '') < mr.read_at
        ? { mark: 'partial', who: x.who, says: x.says, read_at: mr.read_at, proof: { kind: 'virtuals.agent', url: mr.url, ref: `${shown.length} shown, every one named`, read_at: mr.read_at, was: 'broken' } }
        : x]));
      return { ...m, cohorts: { ...m.cohorts, [cohort]: { ...m.cohorts[cohort], features: fixed } } };
    });
    console.log(`market read ${mr.venue}/${cohort}: ${healed ? `${shown.length} shown, every one named: a broken mark read before ${mr.read_at} is partial` : 'the fault still shows: the marks stand'}`);
  }
  // _LIST_MARKET_v1_ (2026-11-22): the list step's markets are coord's venue rows that carry list_market; a directory (a protocol row:
  // ERC-8004, MCP, A2A) is listed by default, a market venue (Virtuals ACP) when named, and it also takes an outside seller's board row
  let listMarkets = prior?.list_markets ?? null;
  if (registryPath) {
    const reg = JSON.parse(readFileSync(registryPath, 'utf8'));
    if (reg.schema !== 'taifoon.venues.registry.v1' || !reg.venues) throw new Error(`${registryPath} is not coord's venues registry`);
    const rows = Object.entries(reg.venues).filter(([, v]) => typeof v.list_market === 'string').map(([id, v]) => [RENAME[id] ?? id, { market: v.list_market, directory: v.kind === 'protocol' }]);
    if (!rows.length) throw new Error(`${registryPath} names no list_market: regenerate it from coord lang/cue/venues-registry.cue`);
    listMarkets = Object.fromEntries(rows);
    console.log(`list markets: ${rows.map(([id, r]) => `${id}=${r.market}`).join(', ')}`);
  }
  const dates = markets.flatMap((m) => [...STEPS.map((s) => m[s].read_on), m.paid?.read_on]).filter(Boolean).sort();
  const data = { source, read_on: dates.at(-1) ?? null, ...(cohorts ? { cohorts } : {}), ...(listMarkets ? { list_markets: listMarkets } : {}), markets };
  const text = scrubbed(data, 'snapshot');
  writeFileSync(snap, `${text}\n`);
  console.log(`wrote src/market/venues-register.json: ${markets.length} markets, read on ${data.read_on} (${data.source}${cohorts ? `, cohorts from ${cohorts.source}` : ''})`);
}

const data = JSON.parse(readFileSync(snap, 'utf8'));
scrubbed(data, 'snapshot');
const text = `// GENERATED by scripts/gen-venues.mjs from venues-register.json (the Moonbeam product's market register). Do not edit.\n` +
  `import type { RegisterSnapshot } from './venues.js';\n\nexport const VENUE_REGISTER: RegisterSnapshot = ${JSON.stringify(data, null, 1)};\n`;
if (process.argv.includes('--check')) {
  let now = ''; try { now = readFileSync(out, 'utf8'); } catch { /* missing */ }
  if (now !== text) { console.error('src/market/venues-data.ts is not venues-register.json: run node scripts/gen-venues.mjs'); process.exit(1); }
  console.log(`venues: ${data.markets.length} markets in step with venues-register.json (read on ${data.read_on})`);
} else { writeFileSync(out, text); console.log(`wrote src/market/venues-data.ts (${data.markets.length} markets)`); }
