// _STATE_TABLE_v1_: the typed state table of the commerce machine, pure parts. scripts/gen-states.mjs does the reading and writing.
// The machine is vendored in scripts/coord-lang/commerce-machine.json (never edited here). The table keeps only a state's id, step,
// kind, led, label, its one GET read and the legal moves; every text field of the machine stays out of the published package.
export const RULE = '_STATE_TABLE_v1_';
export const SOURCE = 'scripts/coord-lang/commerce-machine.json';

/** "GET /v1/listings/:id" -> { method: 'GET', path: '/v1/listings/:id' } */
export function readOf(op) {
  const m = /^(GET) (\/v1\/[A-Za-z0-9_\-/:.]+)$/.exec(op ?? '');
  if (!m) throw new Error(`a state read must be a GET /v1 route, got ${JSON.stringify(op)}`);
  return { method: m[1], path: m[2] };
}

/** the state table from the machine: stages then side states, in the machine's order */
export function buildStates(machine) {
  if (!Array.isArray(machine?.stages) || !Array.isArray(machine?.side) || !Array.isArray(machine?.moves)) throw new Error('not the commerce machine (stages, side, moves)');
  const states = [...machine.stages, ...machine.side].map((s) => ({
    id: s.id, step: s.step, kind: s.kind, led: s.led ?? null, label: s.label, read: readOf(s.reads?.op),
  }));
  const ids = new Set(states.map((s) => s.id));
  if (ids.size !== states.length) throw new Error('duplicate state id in the machine');
  const moves = machine.moves.map((m) => ({ from: m.from, to: m.to }));
  for (const m of moves) if (!ids.has(m.from) || !ids.has(m.to)) throw new Error(`move ${m.from} -> ${m.to} names a state the machine does not have`);
  return { schema: 'moonbeam.states.v1', states, moves };
}

export const renderJson = (table) => `${JSON.stringify(table, null, 1)}\n`;

/** the typed module of the same table (the package imports TS, not JSON: Node needs an import attribute for JSON) */
export const renderTs = (table) => [
  `// generated: do not edit. ${RULE}: scripts/gen-states.mjs writes this from ${SOURCE} (npm run gen:states).`,
  `export const STATES_DATA = ${JSON.stringify(table.states)} as const;`,
  `export const MOVES_DATA = ${JSON.stringify(table.moves)} as const;`,
  '',
].join('\n');
