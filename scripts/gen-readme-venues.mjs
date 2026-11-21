// THE VENUE TABLE A CUSTOMER READS, FROM `VENUES` (_README_VENUES_v1_, _MAINNET_IO_v1_): the README's table and the two blocks of
// docs/VENUES.md. A row is a market Moonbeam lists on with at least one step proven on mainnet; each cell is that step's public word
// (`venue.cohorts.moonbeam[step].publicState`: live, not yet, or n/a where the market has no such step). A market with no proven step
// is named in one sentence under the table, and so are the cut markets. Nothing in a block is typed by hand.
//   npm run build && node scripts/gen-readme-venues.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { COHORT_STEPS, MAINNET_IO_OF, VENUES, VENUES_READ_ON, provenOnMainnet } from '../dist/market/index.js';

const mark = (id) => ({ start: `<!-- venues:${id}:start (scripts/gen-readme-venues.mjs) -->`, end: `<!-- venues:${id}:end -->` });
const callsOf = (v) => [...new Set([v.list, v.take, v.settle, v.paid].map((s) => s.call).filter(Boolean).map((c) => c.split('.').pop()))].map((c) => `\`${c}\``).join(', ') || '—';
const list = (xs, last) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${last} ${xs.at(-1)}`);
const mine = (v) => v.cohorts[MAINNET_IO_OF];
const HEAD = { list: 'List', take: 'Take a job', settle: 'Settle' };

const kept = VENUES.filter((v) => v.moonbeamLists);
const shown = kept.filter(provenOnMainnet);
const open = kept.filter((v) => !provenOnMainnet(v));
const cut = VENUES.filter((v) => !v.moonbeamLists);

/** the table, the markets not shown yet, the cut markets and what each word means */
const table = [
  `Read on ${VENUES_READ_ON}. Each word is Moonbeam's own listing on that market (\`venue.cohorts.${MAINNET_IO_OF}\`, its \`publicState\`).`,
  '',
  `| Market | What a seller does there | ${COHORT_STEPS.map((k) => HEAD[k]).join(' | ')} | SDK calls |`,
  `|---|---|${COHORT_STEPS.map(() => '---|').join('')}---|`,
  ...shown.map((v) => `| ${v.name} | ${v.does} | ${COHORT_STEPS.map((k) => mine(v)[k].publicState).join(' | ')} | ${callsOf(v)} |`),
  '',
  ...(open.length ? [`Not yet: ${list(open.map((v) => v.name), 'and')}. No mainnet run of a step there is kept as an I/O test yet.`, ''] : []),
  `Moonbeam does not list agents on ${list(cut.map((v) => v.name), 'or')}. They stay in \`VENUES\` as read-only rows (\`moonbeamLists: false\`).`,
  '',
  '- **live**: a mainnet run of the step is kept in this SDK as an I/O fixture (`test/io/fixtures`), and a test replays it.',
  '- **not yet**: no mainnet run of the step is kept yet.',
  '- **n/a**: the market has no such step.',
];

/** each shown market: what it is, how an agent is listed there, and each step with its word, its SDK call and the run it stands on */
const each = shown.flatMap((v) => [
  `### ${v.name} (\`${v.id}\`)`,
  '',
  v.does,
  '',
  v.howListed,
  '',
  ...(v.marketId ? [`\`market(t, '${v.marketId}')\` reads its week of money.`, ''] : []),
  ...COHORT_STEPS.map((k) => {
    const c = mine(v)[k]; const call = v[k].call ? ` · \`${v[k].call}\`` : '';
    if (c.publicState === 'n/a') return `- **${k}**: n/a: ${c.says ?? v[k].says}`;
    if (c.publicState !== 'live') return `- **${k}**: not yet${call}`;
    return `- **${k}**: live${call} (mainnet run read ${c.mainnet.on}, kept at \`${c.mainnet.run}\`)`;
  }),
  '',
]).slice(0, -1);

const FILES = [
  { file: '../README.md', blocks: { moonbeam: table } },
  { file: '../docs/VENUES.md', blocks: { moonbeam: table, each } },
];
const check = process.argv.includes('--check');
let off = 0;
for (const f of FILES) {
  const url = new URL(f.file, import.meta.url); const name = f.file.replace('../', '');
  const text = readFileSync(url, 'utf8'); let next = text;
  for (const [id, lines] of Object.entries(f.blocks)) {
    const { start, end } = mark(id); const a = next.indexOf(start), b = next.indexOf(end);
    if (a < 0 || b < a) throw new Error(`${name} has no venues:${id} markers`);
    next = `${next.slice(0, a)}${[start, ...lines, end].join('\n')}${next.slice(b + end.length)}`;
  }
  if (check) { if (next !== text) { console.error(`${name}: the venue table is not what VENUES says (npm run build && node scripts/gen-readme-venues.mjs)`); off += 1; } }
  else writeFileSync(url, next);
}
if (check && off) process.exit(1);
console.log(`${check ? 'venue tables are VENUES\'' : 'wrote the venue tables'} (README.md, docs/VENUES.md): ${shown.length} markets proven on mainnet, ${open.length} not yet, ${cut.length} cut`);
