#!/usr/bin/env node
// _SELECTION_v1_: the language of a pick for this SDK (the reseller's projection, src/selection/selection.public.json, vendored from
// the coordination layer with its core src/selection/selection.mjs) as typed data the build ships: src/selection/lang-data.ts.
//   node scripts/gen-selection.mjs           write src/selection/lang-data.ts
//   node scripts/gen-selection.mjs --check   fail when it differs from what the vendored language gives
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'src/selection/selection.public.json';
const OUT = 'src/selection/lang-data.ts';
// the data the core reads; the schema and source names stay in the vendored file
const { schema: _schema, source: _source, ...lang } = JSON.parse(readFileSync(join(root, SRC), 'utf8'));
const text = `// generated: do not edit. scripts/gen-selection.mjs writes this from ${SRC} (npm run gen:selection).\nimport type { SelectionLang } from './selection.mjs';\n\nexport const SELECTION_LANG: SelectionLang = ${JSON.stringify(lang)};\n`;
if (process.argv.includes('--check')) {
  const same = existsSync(join(root, OUT)) && readFileSync(join(root, OUT), 'utf8') === text;
  if (!same) { console.error(`${OUT}: not the vendored language (node scripts/gen-selection.mjs)`); process.exit(1); }
  console.log(`selection language: ${lang.kinds.length} kinds, ${lang.venues.length} venues, ${lang.moves.length} moves`);
} else { writeFileSync(join(root, OUT), text); console.log(`wrote ${OUT}`); }
