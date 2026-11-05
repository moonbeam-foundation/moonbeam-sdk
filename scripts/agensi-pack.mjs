#!/usr/bin/env node
// Build the skills of this package as one Agensi pack (agensi.io: a marketplace of SKILL.md skills an agent loads through its MCP
// server). The pack is the published skills/ folder, unchanged but for the listing fields Agensi reads, in its layout:
//   moonbeam-assurance-skills/README.md            its `# heading` is the pack's name
//   moonbeam-assurance-skills/skills/<name>/SKILL.md one per skill; `name` and `description` as written, then summary, version, tags, docs_url
//   moonbeam-assurance-skills.zip                  what the creator uploads (free; text only, at most 100 files and 5 MB)
//   node scripts/agensi-pack.mjs [out-dir]           out-dir defaults to the system temp folder; prints the zip's path
// The version is this package's, and the build stops when that version is not on npm: a skill must match what `npm i` installs.
// MOONBEAM_PACK_UNPUBLISHED=1 builds it anyway (a preview only, never to submit).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACK = 'moonbeam-assurance-skills';
const LIMITS = { files: 100, bytes: 5 * 1024 * 1024, summary: 300 };
const TAGS = ['moonbeam', 'assurance', 'agent-commerce', 'base'];
const q = (s) => JSON.stringify(String(s));
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

/** One SKILL.md with the listing fields after its description: summary (its first sentence), version, tags, docs_url. Pure. */
export function packSkill(text, { version }) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith('description:'));
  const name = /^name:\s*(\S+)/m.exec(text)?.[1];
  if (lines[0] !== '---' || at < 0 || !name) throw new Error('agensi-pack: a SKILL.md needs frontmatter with name and description');
  const description = lines[at].replace(/^description:\s*/, '').replace(/^"(.*)"$/, '$1');
  const summary = (/^(.*?[.!?])(\s|$)/.exec(description)?.[1] ?? description).slice(0, LIMITS.summary);
  lines.splice(at + 1, 0, `summary: ${q(summary)}`, `version: ${q(version)}`, `tags: [${TAGS.map(q).join(', ')}]`,
    `docs_url: ${q(`https://github.com/moonbeam-foundation/moonbeam-sdk/tree/main/skills/${name}`)}`);
  return lines.join('\n');
}

/** The pack's README: the heading names the pack; one line per skill. Pure. */
export function packReadme(skills, { version }) {
  return ['# Moonbeam assurance skills', '',
    'Skills for insured AI agent work on Base: a price, a judge and a deadline, settled against proof. One skill per actor of a job',
    '(client, provider, evaluator, challenger, backer, doubter), a router, and a decoder for on-chain agent-commerce logs.', '',
    ...skills.map((s) => `- \`${s.name}\`: ${s.summary}`), '',
    `They use @moonbeam-foundation/sdk ${version} (Apache-2.0): \`npm i @moonbeam-foundation/sdk\`.`,
    'Source: https://github.com/moonbeam-foundation/moonbeam-sdk', ''].join('\n');
}

export function buildPack(out, { version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version } = {}) {
  const pack = join(out, PACK); rmSync(pack, { recursive: true, force: true }); mkdirSync(join(pack, 'skills'), { recursive: true });
  const skills = [];
  for (const name of readdirSync(join(root, 'skills')).filter((d) => statSync(join(root, 'skills', d)).isDirectory()).sort()) {
    cpSync(join(root, 'skills', name), join(pack, 'skills', name), { recursive: true });
    const f = join(pack, 'skills', name, 'SKILL.md'); const text = packSkill(readFileSync(f, 'utf8'), { version }); writeFileSync(f, text);
    skills.push({ name, summary: JSON.parse(/^summary: (.*)$/m.exec(text)[1]) });
  }
  writeFileSync(join(pack, 'README.md'), packReadme(skills, { version }));
  cpSync(join(root, 'LICENSE'), join(pack, 'LICENSE'));
  const files = walk(pack); const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
  if (files.length > LIMITS.files || bytes > LIMITS.bytes) throw new Error(`agensi-pack: ${files.length} files, ${bytes} bytes: over ${LIMITS.files} files / ${LIMITS.bytes} bytes`);
  const zip = join(out, `${PACK}.zip`); rmSync(zip, { force: true });
  execFileSync('zip', ['-qrX', zip, PACK], { cwd: out });
  return { pack, zip, skills: skills.length, files: files.map((f) => relative(pack, f)).sort(), bytes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), 'moonbeam-agensi-')));
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  let published = false;
  try { published = execFileSync('npm', ['view', `@moonbeam-foundation/sdk@${version}`, 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === version; } catch {}
  if (!published && process.env.MOONBEAM_PACK_UNPUBLISHED !== '1') {
    console.error(`agensi-pack: @moonbeam-foundation/sdk ${version} is not on npm; publish it first (MOONBEAM_PACK_UNPUBLISHED=1 for a preview)`);
    process.exit(1);
  }
  mkdirSync(out, { recursive: true });
  const r = buildPack(out, { version });
  console.log(`${r.skills} skills, ${r.files.length} files, ${r.bytes} bytes → ${r.zip}${published ? '' : ' (PREVIEW: this version is not on npm, do not submit)'}`);
}
