// THE README'S MOONBEAM TABLE, FROM `VENUES` (_README_VENUES_v1_): the markets Moonbeam lists on (`moonbeamLists`), each with Moonbeam's
// own states (`venue.cohorts.moonbeam`) and its SDK calls, then one line naming the cut markets. Nothing in the table is typed by hand.
//   npm run build && node scripts/gen-readme-venues.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { VENUES, VENUES_READ_ON } from '../dist/market/index.js';

const readme = new URL('../README.md', import.meta.url);
const START = '<!-- venues:moonbeam:start (scripts/gen-readme-venues.mjs) -->';
const END = '<!-- venues:moonbeam:end -->';
const callsOf = (v) => [...new Set([v.list, v.take, v.settle, v.paid].map((s) => s.call).filter(Boolean).map((c) => c.split('.').pop()))].map((c) => `\`${c}\``).join(', ') || '—';
const kept = VENUES.filter((v) => v.moonbeamLists);
const cut = VENUES.filter((v) => !v.moonbeamLists);
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`);
const block = [
  START,
  `Read on ${VENUES_READ_ON}. The states are Moonbeam's own listing on each market (\`venue.cohorts.moonbeam\`).`,
  '',
  '| Market | What a seller does there | Moonbeam: list | Take a job · settle | SDK calls |',
  '|---|---|---|---|---|',
  ...kept.map((v) => { const m = v.cohorts.moonbeam; return `| ${v.name} | ${v.does} | ${m.list.state} | ${m.take.state} · ${m.settle.state} | ${callsOf(v)} |`; }),
  '',
  `Moonbeam does not list agents on ${list(cut.map((v) => v.name))}. They stay in \`VENUES\` as read-only rows (\`moonbeamLists: false\`).`,
  '',
  '- **live**: listed and read back on the market (list), or running there for outside money (take, settle).',
  '- **tested**: Moonbeam ran the whole step end to end itself and keeps the run as an I/O test (`test/io`).',
  '- **partial**: part of the step runs.',
  '- **shared**: another cohort\'s listing stands in. **closed**: the market takes no new agent.',
  '- **n/a**: the market has no such step.',
  END,
].join('\n');

const text = readFileSync(readme, 'utf8');
const a = text.indexOf(START), b = text.indexOf(END);
if (a < 0 || b < a) throw new Error('README.md has no venues:moonbeam markers');
const next = `${text.slice(0, a)}${block}${text.slice(b + END.length)}`;
if (process.argv.includes('--check')) {
  if (next !== text) { console.error('README.md: the Moonbeam venue table is not what VENUES says (npm run build && node scripts/gen-readme-venues.mjs)'); process.exit(1); }
  console.log(`README.md: the Moonbeam venue table is VENUES' (${kept.length} markets, ${cut.length} cut)`);
} else { writeFileSync(readme, next); console.log(`wrote README.md: ${kept.length} markets, ${cut.length} cut`); }
