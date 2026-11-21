// _COORD_IO_COVERAGE_v1_: the pure parts of the coverage matrix, shared by scripts/io-coverage.mjs (gen and check),
// scripts/io-record.mjs (fixtures) and test/io/coverage.test.ts (the matrix, the ratchet, the rendered table).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isRunFile, isRungFile } from './paths-lib.mjs';
import { join, relative } from 'node:path';

export const GAP_REASONS = Object.freeze(['needs_key', 'needs_payment', 'needs_owner_arm', 'no_devnet_twin', 'not_in_coord']);
export const SOURCES = Object.freeze(['live', 'devnet-ledger', 'contract']);
export const OPS_CUE = 'lang/cue/api-operations.cue';
export const BODIES_CUE = 'lang/cue/api-bodies.cue';
export const LISTING_CUE = 'lang/cue/agent-listing.cue';

// ── coord ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Read coord's catalogue at a checkout (or an extracted tree with --sha). */
export function loadCoord(path, o = {}) {
  const need = ['lang/gen/api-contract.json', 'lang/gen/api-bodies.json', OPS_CUE, BODIES_CUE, LISTING_CUE, 'lang/gen/sign.json'];
  for (const f of need) if (!existsSync(join(path, f))) throw new Error(`coord at ${path} has no ${f}`);
  let sha = o.sha ?? null;
  if (!sha) try { sha = execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { sha = null; }
  if (!sha) throw new Error(`no coord sha: ${path} is not a git checkout; pass --sha`);
  const contract = JSON.parse(readFileSync(join(path, 'lang/gen/api-contract.json'), 'utf8'));
  const bodies = JSON.parse(readFileSync(join(path, 'lang/gen/api-bodies.json'), 'utf8'));
  const cue = readFileSync(join(path, OPS_CUE), 'utf8').split('\n');
  const bodiesCue = readFileSync(join(path, BODIES_CUE), 'utf8').split('\n');
  const listingCue = readFileSync(join(path, LISTING_CUE), 'utf8').split('\n');
  const sign = JSON.parse(readFileSync(join(path, 'lang/gen/sign.json'), 'utf8'));
  const ops = new Map();
  for (const r of contract.rows) ops.set(`${r.method} ${r.name}`, r);
  return { path, sha, ops, bodies, cue, bodiesCue, listingCue, sign };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** coord's file:line of an op: the row's "name" line in api-operations.cue whose "method" follows it. */
export function citeOf(c, key) {
  const [method, name] = key.split(' ');
  const re = new RegExp(`^\\s*"name":\\s*"${esc(name)}"\\s*$`);
  for (let i = 0; i < c.cue.length; i++) {
    if (!re.test(c.cue[i])) continue;
    for (let j = i - 3; j <= i + 4; j++) if (j >= 0 && new RegExp(`^\\s*"method":\\s*"${method}"`).test(c.cue[j] ?? '')) return `${OPS_CUE}:${i + 1}`;
  }
  return null;
}
const lineOf = (lines, re, file) => { const i = lines.findIndex((l) => re.test(l)); return i < 0 ? null : `${file}:${i + 1}`; };

/** The top-level keys of a prose field list: "a, b: x, c[] { … }, d? (…)" up to the closing brace or a full stop at depth 0. */
export function proseKeys(text, start = 0, closeOnBrace = true) {
  const keys = []; let depth = 0, seg = '';
  const push = () => { const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(seg); if (m && !keys.includes(m[1])) keys.push(m[1]); seg = ''; };
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if ('{[('.includes(ch)) { depth++; continue; }
    if ('}])'.includes(ch)) { if (depth === 0) { if (closeOnBrace) break; continue; } depth--; continue; }
    if (depth > 0) continue;
    if (ch === ',') { push(); continue; }
    if (!closeOnBrace && (ch === ';' || (ch === '.' && /\s/.test(text[i + 1] ?? ' ')))) break;
    seg += ch;
  }
  push();
  return keys;
}

/** What coord declares an op sends and answers: typed (api-bodies.cue, answer, agent-listing.cue) or named in its prose. */
export function declaredOf(c, key) {
  const op = c.ops.get(key);
  if (!op) return null;
  const prose = `${op.returns ?? ''}`;
  // request
  let request = { from: null, fields: [], required: [] };
  if (op.request && c.bodies[op.request]) {
    const b = c.bodies[op.request];
    request = { from: `${BODIES_CUE}#${op.request}`, cite: lineOf(c.bodiesCue, new RegExp(`^\\t${esc(op.request)}:\\s*\\{`), BODIES_CUE), fields: Object.keys(b.properties ?? {}), required: b.required ?? [] };
  } else if (key === 'POST agent-listings') {
    request = { from: `${LISTING_CUE}#AgentListing`, cite: lineOf(c.listingCue, /^#AgentListing:\s*\{/, LISTING_CUE), fields: cueFields(c.listingCue, '#AgentListing'), required: [] };
  } else {
    const m = /\b(?:Send|POST)\s*\{/.exec(prose);
    if (m) request = { from: `${OPS_CUE} returns (Send { … })`, fields: proseKeys(prose, m.index + m[0].length), required: [] };
  }
  // response
  let response = { from: null, fields: [], typed: null };
  if (op.answer && typeof op.answer === 'object') {
    response = { from: `${OPS_CUE} answer`, fields: Object.keys(op.answer), typed: op.answer };
  } else {
    const ret = /\bReturns\s+(?!\{)/.exec(prose);
    let keys = null;
    if (ret) keys = proseKeys(prose.slice(0, ret.index + ret[0].length) + prose.slice(ret.index + ret[0].length).replace(/ and /g, ', '), ret.index + ret[0].length, false);
    else {
      const re = /\{/g; let mm;
      while ((mm = re.exec(prose))) {
        const before = prose.slice(Math.max(0, mm.index - 8), mm.index);
        if (/(Send|POST)\s*$/.test(before)) { let d = 1, i = mm.index + 1; for (; i < prose.length && d; i++) { if (prose[i] === '{') d++; else if (prose[i] === '}') d--; } re.lastIndex = i; continue; }
        // only a block that opens the answer: at the start, or after a status code, "answer:", "):" or "→"
        if (!/(^|\d{3}|:|→)\s*$/.test(prose.slice(0, mm.index).trim() === '' ? '' : prose.slice(0, mm.index))) break;
        keys = proseKeys(prose, mm.index + 1); break;
      }
    }
    if (keys && keys.length) response = { from: `${OPS_CUE} returns`, fields: keys, typed: null };
  }
  const query = Array.isArray(op.query) && op.query.length ? { from: 'query', names: op.query.map((q) => q.name) }
    : { from: 'prose', names: null, text: `${op.summary ?? ''} ${op.returns ?? ''} ${op.example ?? ''}` };
  return { op, request, response, query, auth: op.auth ?? 'open', internal: op.internal === true };
}

/** The fields of a CUE definition, as dotted paths two levels deep (`identity`, `identity.name`, …). */
export function cueFields(lines, def) {
  const start = lines.findIndex((l) => l.startsWith(`${def}:`));
  if (start < 0) return [];
  const out = []; const stack = []; let depth = 0;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i].replace(/\/\/.*$/, '');
    if (i > start && depth === 1 && /^\s*if\b/.test(l)) break; // the constraints follow the fields
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)[?!]?\s*:/.exec(l);
    if (m && i > start && depth >= 1 && depth <= 2 && !m[1].startsWith('_')) { stack.length = depth - 1; stack.push(m[1]); out.push(stack.join('.')); }
    for (const ch of l) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    if (i > start && depth <= 0) break;
  }
  return [...new Set(out)];
}

/** The op name's path as a pattern: settle/:id → ^/v1/settle/[^/]+$ */
export const pathRe = (name) => new RegExp(`^/v1/${name.split('/').map((s) => (s.startsWith(':') ? '[^/]+' : esc(s))).join('/')}$`);

const flat = (v, pre = '', out = []) => {
  if (Array.isArray(v)) { for (const x of v) flat(x, `${pre}[]`, out); if (!v.length) out.push(`${pre}[]`); return out; }
  if (v && typeof v === 'object') { const ks = Object.keys(v); if (!ks.length && pre) out.push(pre); for (const k of ks) { const p = pre ? `${pre}.${k}` : k; out.push(p); flat(v[k], p, out); } return out; }
  return out;
};
const typeOk = (t, v) => v === null || (t === 'text' ? typeof v === 'string' : t === 'int' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' : t === 'bool' ? typeof v === 'boolean' : true);

/** A fixture against coord's contract: the op is there, its path, query, body and answer carry only what coord declares. */
export function shapeIssues(c, fx) {
  const out = [];
  const d = declaredOf(c, fx.op);
  if (!d) return [`op:${fx.op} is not in coord`];
  const req = fx.request;
  if (req.method !== d.op.method) out.push(`method:${req.method}`);
  if (!pathRe(d.op.name).test(req.path)) out.push(`path:${req.path}`);
  for (const q of Object.keys(req.query ?? {})) {
    const ok = d.query.names ? d.query.names.includes(q) : new RegExp(`\\b${esc(q)}\\b`).test(d.query.text);
    if (!ok) out.push(`query:${q}`);
  }
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object') {
    if (!d.request.from) { if (Object.keys(req.body).length) out.push('body:undeclared'); }
    else {
      const paths = flat(req.body);
      const declared = new Set(d.request.fields);
      const nested = d.request.fields.some((f) => f.includes('.'));
      for (const p of paths) {
        const top = p.split(/[.[]/)[0];
        if (!declared.has(top)) { out.push(`body:${top}`); continue; }
        if (nested) { const two = p.replace(/\[\]/g, '').split('.').slice(0, 2).join('.'); if (two.includes('.') && d.request.fields.some((f) => f.startsWith(`${top}.`)) && !declared.has(two)) out.push(`body:${two}`); }
      }
      for (const r of d.request.required ?? []) if (!(r in req.body)) out.push(`required:${r}`);
    }
  }
  const res = fx.response?.body;
  const strict = fx.source !== 'live';
  if (res && typeof res === 'object' && !Array.isArray(res)) {
    const paths = [...new Set(flat(res))];
    if (d.response.typed) {
      const T = d.response.typed;
      const declared = Object.keys(T);
      for (const p of paths) {
        if (T[p]?.type && !typeOk(T[p].type, getPath(res, p))) out.push(`type:${p}`);
        if (strict && !declared.some((k) => k === p || k.startsWith(`${p}.`) || k.startsWith(`${p}[]`) || p.startsWith(`${k}.`) || p.startsWith(`${k}[]`))) out.push(`response:${p}`);
      }
    } else if (strict) {
      if (!d.response.from) { if (paths.length) out.push('response:undeclared'); }
      else for (const k of Object.keys(res)) if (!d.response.fields.includes(k)) out.push(`response:${k}`);
    }
  }
  return [...new Set(out)];
}
function getPath(o, p) {
  const parts = p.split('.');
  let cur = [o];
  for (const part of parts) {
    const arr = part.endsWith('[]'); const k = arr ? part.slice(0, -2) : part;
    cur = cur.flatMap((x) => (x && typeof x === 'object' ? [x[k]] : []));
    if (arr) cur = cur.flatMap((x) => (Array.isArray(x) ? x : []));
  }
  return cur.length ? cur[0] : undefined;
}

// ── the map ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const slug = (op) => (op ?? 'none').replace(/^(GET|POST)\s+/, '').replace(/:([a-zA-Z]+)/g, '$1').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
export const fixturePath = (r) => `test/io/fixtures/${r.market}/${r.stage}/${r.dir}-${slug(r.op)}${r.variant ? `.${r.variant}` : ''}.json`;

/** op-map rows, one per market x stage x dir x op. */
export function expandRows(map) {
  const out = [];
  const arr = (v, all) => (v === undefined ? all : Array.isArray(v) ? v : typeof v === 'string' && map.groups[v] ? map.groups[v] : [v]);
  for (const r of map.rows) for (const market of arr(r.markets, map.markets)) for (const stage of arr(r.stage, map.stages)) for (const dir of arr(r.dir, map.dirs)) {
    const row = { market, stage, dir, op: r.op ?? null, ...(r.call ? { call: r.call, source: r.source } : {}), ...(r.flow ? { flow: r.flow } : {}), ...(r.variant ? { variant: r.variant } : {}),
      ...(r.gap ? { gap: r.gap } : {}), ...(r.sdk ? { sdk: r.sdk } : {}), ...(r.accept ? { accept: r.accept } : {}), why: r.why ?? r.gap?.why ?? null };
    if (r.call) row.fixture = fixturePath(row);
    out.push(row);
  }
  return out;
}

const CHAIN = [[/agents\/identity|registry\/agents|olas\/mechs|judge\/evidence\/olas/, 8453], [/settle|chain\/|proof\/|pipe\/|sign\/|mech|jobs|handshake|^POST list$|agent-listings/, 36927]];
export const chainOf = (op) => { if (!op) return null; const name = op.replace(/^(GET|POST)\s+/, ''); for (const [re, c] of CHAIN) if (re.test(name) || re.test(op)) return c; return null; };

/** Every coord op a kept market's tags name (its name, path and keywords): each must be placed or set aside in the op-map. */
export function taggedOps(c, map) {
  const out = [];
  for (const [key, op] of c.ops) {
    const txt = [op.name, op.target ?? '', ...(op.keywords ?? [])].join(' ');
    const markets = Object.entries(map.tags).filter(([, re]) => new RegExp(re, 'i').test(txt)).map(([m]) => m);
    if (markets.length) out.push({ op: key, markets });
  }
  return out;
}

/** The recorded coord calls on disk, by repo-relative path (a run file of scripts/gen-paths.mjs is not one, nor a rung's recorded read). */
export function fixturesOnDisk(root) {
  const dir = join(root, 'test/io/fixtures');
  const out = new Map();
  const walk = (d) => { if (!existsSync(d)) return; for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.json') && !isRunFile(f) && !isRungFile(f)) out.set(relative(root, p), JSON.parse(readFileSync(p, 'utf8'))); } };
  walk(dir);
  return out;
}

/** coverage.json from coord, the op-map and the fixtures on disk. */
export function buildCoverage(c, map, fixtures, o = {}) {
  const rows = expandRows(map);
  const issues = [];
  const placed = new Set(rows.map((r) => r.op).filter(Boolean));
  const ignored = new Set(map.ignore.map((i) => i.op));
  const tagged = taggedOps(c, map);
  for (const t of tagged) if (!placed.has(t.op) && !ignored.has(t.op)) issues.push(`new op: ${t.op} (tagged ${t.markets.join(', ')}) has no cell: place it in test/io/op-map.json or set it aside with why`);
  for (const op of [...placed, ...ignored]) if (!c.ops.has(op)) issues.push(`gone: ${op} is in test/io/op-map.json but not in coord ${c.sha.slice(0, 9)}`);
  const declared = {};
  const cells = rows.map((r) => {
    const cite = r.op ? citeOf(c, r.op) : null;
    const d = r.op ? declaredOf(c, r.op) : null;
    if (d && !declared[r.op]) declared[r.op] = { cite, auth: d.auth, request: { from: d.request.from, fields: d.request.fields }, response: { from: d.response.from, fields: d.response.fields } };
    const cell = { market: r.market, stage: r.stage, dir: r.dir, op: r.op, chain: chainOf(r.op), cite, ...(d ? { auth: d.auth } : {}) };
    if (r.gap) return { ...cell, gap: { reason: r.gap.reason, why: r.gap.why } };
    const fx = fixtures.get(r.fixture);
    if (!fx) { issues.push(`missing fixture: ${r.fixture} (${r.call}, ${r.source})`); return { ...cell, call: r.call, fixture: null, source: r.source }; }
    if (fx.source !== r.source) issues.push(`${r.fixture}: source ${fx.source}, the map says ${r.source}`);
    const shape = shapeIssues(c, fx);
    const accepted = new Set(r.accept ?? []);
    const drift = shape.filter((s) => accepted.has(s));
    for (const s of shape.filter((x) => !accepted.has(x))) issues.push(`shape: ${r.fixture}: ${s} (coord ${c.sha.slice(0, 9)})`);
    return { ...cell, call: r.call, fixture: r.fixture, source: fx.source, read_at: fx.read_at, ...(drift.length ? { drift } : {}) };
  });
  for (const p of fixtures.keys()) if (!rows.some((r) => r.fixture === p)) issues.push(`orphan fixture: ${p} (no row of the map names it)`);
  return {
    schema: 'moonbeam.io.coverage.v1',
    rule: '_COORD_IO_COVERAGE_v1_: every kept market x stage x dir has a fixture (live, devnet-ledger or contract) or a named gap; generated by scripts/io-coverage.mjs: do not edit',
    coord: { sha: c.sha, ...(o.ref ? { ref: o.ref } : {}), catalogue: 'lang/gen/api-contract.json', ops: c.ops.size },
    markets: map.markets, stages: map.stages, dirs: map.dirs,
    tagged: { ops: tagged.length, placed: tagged.filter((t) => placed.has(t.op)).length, set_aside: tagged.filter((t) => ignored.has(t.op)).length },
    summary: summaryOf(map, cells),
    cells,
    declared,
    issues,
  };
}

export function summaryOf(map, cells) {
  const out = {};
  for (const m of map.markets) {
    const mine = cells.filter((c) => c.market === m);
    const fixtures = Object.fromEntries(SOURCES.map((s) => [s, mine.filter((c) => c.fixture && c.source === s).length]));
    const gaps = Object.fromEntries(GAP_REASONS.map((g) => [g, mine.filter((c) => c.gap?.reason === g).length]));
    const keys = new Set(mine.map((c) => `${c.stage}/${c.dir}`));
    const withFixture = new Set(mine.filter((c) => c.fixture).map((c) => `${c.stage}/${c.dir}`));
    out[m] = { cells: keys.size, rows: mine.length, cells_with_fixture: withFixture.size, fixtures, gaps };
  }
  return out;
}

export const gapCount = (cov) => {
  const by = Object.fromEntries(GAP_REASONS.map((g) => [g, 0]));
  for (const c of cov.cells) if (c.gap) by[c.gap.reason]++;
  return { total: Object.values(by).reduce((a, b) => a + b, 0), by };
};

const NAMES = { 'x402-base': 'x402', mcp: 'MCP Registry', a2a: 'A2A Registry', erc8004: 'ERC-8004', 'near-agent-market': 'NEAR AI Agent Market', 'erc8183-base': 'Virtuals ACP', 'olas-base': 'Olas Mech' };
const SHORT = { needs_key: 'key', needs_payment: 'payment', needs_owner_arm: 'owner arm', no_devnet_twin: 'no devnet twin', not_in_coord: 'not in coord' };

/** docs/io-coverage.md from coverage.json. */
export function renderDoc(cov) {
  const L = [];
  L.push('# Coord I/O coverage', '');
  L.push('Generated by `scripts/io-coverage.mjs` from coord at `' + cov.coord.sha + '`. Do not edit: `npm run io:check -- --coord <path>` regenerates it.', '');
  L.push('Every kept market, every stage (listed, bought, delivered, settled, paid) and both directions (read, write). Each row is one coord operation with a recorded fixture that the replay test (`test/io/replay.test.ts`) feeds through the SDK, or a named gap. Chain reads and writes are on the devnet, chain 36927.', '');
  L.push('Sources: **live** (a public read, recorded), **devnet-ledger** (built from the devnet economy ledger), **contract** (built from coord\'s declared request and answer fields only).', '');
  L.push('## Per market', '');
  L.push('| Market | Cells | With a fixture | Rows | live | devnet-ledger | contract | Gaps |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const m of cov.markets) {
    const s = cov.summary[m];
    const gaps = GAP_REASONS.filter((g) => s.gaps[g]).map((g) => `${SHORT[g]} ${s.gaps[g]}`).join(', ') || 'none';
    L.push(`| ${NAMES[m] ?? m} | ${s.cells} | ${s.cells_with_fixture} | ${s.rows} | ${s.fixtures.live} | ${s.fixtures['devnet-ledger']} | ${s.fixtures.contract} | ${gaps} |`);
  }
  const g = gapCount(cov);
  L.push('', `Gaps in all: ${g.total} (${GAP_REASONS.map((r) => `${r} ${g.by[r]}`).join(', ')}). The count may only go down (\`test/io/gaps.baseline.json\`).`, '');
  L.push('## Every cell', '');
  L.push('| Market | Stage | Dir | Operation | Chain | Fixture or gap |');
  L.push('|---|---|---|---|---|---|');
  for (const c of cov.cells) {
    const what = c.gap ? `gap: ${c.gap.reason}` : `${c.source}${c.drift ? ` (accepted drift: ${c.drift.join(', ')})` : ''}`;
    L.push(`| ${NAMES[c.market] ?? c.market} | ${c.stage} | ${c.dir} | ${c.op ? `\`${c.op}\`` : 'none'} | ${c.chain ?? ''} | ${what} |`);
  }
  L.push('');
  return L.join('\n');
}
