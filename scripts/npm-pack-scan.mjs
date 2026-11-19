#!/usr/bin/env node
// _NPM_PACK_SCAN_v1_ (owner 2026-11-19: "for all npm packages add the kms access scans"): the one scan every package we publish
// runs before `npm publish` (its prepublishOnly). It reads exactly the files npm would publish (`npm pack --dry-run --json`) and
// refuses the publish when one of them holds:
//   1. a key or secret: coord keys (tfr_, tfn_live_), AWS keys, Anthropic keys, PEM private keys, npm tokens, a PRIVATE_KEY /
//      MNEMONIC / SECRET assignment with a value;
//   2. the KMS/SSM side: kms-access and its registry, KMS key ARNs and aliases, SSM parameter reads, our AWS account ids, the
//      boxes' addresses and root paths;
//   3. one of our own key, Safe, payee or treasury addresses;
//   4. a file that must never ship (.env, .npmrc, *.pem, *.key, id_rsa, a kms-access audit log).
// 2 and 3 are read at scan time from the operator's local key registry (KMS_REGISTRY, else ~/.kms-access/registry.json, a link to it) and never written into any repo: without the registry those checks are skipped and
// the scan says so (--strict makes that a refusal). Findings name the file and the kind, never the value.
// A package may name what it publishes on purpose in .npm-pack-scan-allow.json (reviewed in its repo like any code):
//   { "addresses": [{ "sha256": "<sha256 of the lowercased address>", "why": "…" }], "kinds": [{ "kind": "kms-access", "files": ["src/…"], "why": "…" }] }
// An address is named by its hash only, so the allow file holds none. Each entry needs a why.
// Canonical copy: ~/projects/coord-gates/npm-pack-scan.mjs; each package repo vendors it byte for byte as scripts/npm-pack-scan.mjs
// (coord-gates/npm-pack-scan-sync.sh, which also --checks the copies).
//   node scripts/npm-pack-scan.mjs [--dir <package dir>] [--tarball <file.tgz>] [--strict] [--json]
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const strict = process.argv.includes('--strict');

export const SECRET_PATTERNS = [
  ['coord key (tfr_)', /tfr_[A-Za-z0-9_-]{12,}/],
  ['coord live key (tfn_live_)', /tfn_live_[A-Za-z0-9_-]{8,}/],
  ['AWS access key id', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['AWS secret key assignment', /aws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+]{40}/i],
  ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{16,}/],
  ['OpenAI-style key', /\bsk-(proj-)?[A-Za-z0-9]{32,}/],
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{30,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['secret assignment', /\b[A-Z0-9_]*(PRIVATE_KEY|MNEMONIC|SEED_PHRASE|SECRET_KEY|API_SECRET)\b\s*[=:]\s*['"]?(0x)?[A-Za-z0-9_+/-]{24,}/],
];
// The generic part; the names of ours (projects, roles, hosts, the registry path) come from this Mac at scan time (kmsPatterns),
// so this file names none of them. The tool's name is joined at run time so this file does not match itself.
const TOOL = ['kms', 'access'].join('-');
export const KMS_PATTERNS = [
  [TOOL, new RegExp(`\\b${TOOL}\\b|\\.${TOOL}/`)],
  ['a KMS key ARN', /arn:aws:kms:[a-z0-9-]+:\d{12}:(key|alias)\//],
  ['an SSM parameter read', /\bssm\s+get-parameters?\b|GetParameter(s|sByPath)?\b.*WithDecryption/],
  ['an ssh to root', /\bssh\s+(-\S+\s+)*root@/],
];
/** the patterns of ours, read from the key registry and ~/.ssh/config on this Mac (none without them) */
export function kmsPatterns(registryFile, registry) {
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const out = [];
  const home = process.env.HOME || '';
  if (registryFile) { let real = registryFile; try { real = realpathSync(registryFile); } catch { /* as given */ } out.push(['the key registry path', new RegExp(esc(real.replace(home, '').replace(/^\//, '')))]); }
  const projects = Object.keys(registry?.projects ?? {});
  if (projects.length) {
    out.push(['a KMS alias of ours', new RegExp(`\\balias/(${projects.map(esc).join('|')})[\\w/-]*`)]);
    const roles = [...new Set(JSON.stringify(registry).match(/role\/[\w+=,.@-]+/g) ?? [])];
    if (roles.length) out.push(['a role of ours', new RegExp(roles.map(esc).join('|'))]);
  }
  try {
    const hosts = [...readFileSync(join(home, '.ssh/config'), 'utf8').matchAll(/^\s*HostName\s+(\d{1,3}(?:\.\d{1,3}){3})\s*$/gim)].map((m) => m[1]);
    if (hosts.length) out.push(['a box address of ours', new RegExp(`(?<![\\d.])(${[...new Set(hosts)].map(esc).join('|')})(?![\\d])`)]);
  } catch { /* no ssh config */ }
  return out;
}
const NEVER_SHIP = /(^|\/)(\.env(\..*)?|\.npmrc|id_rsa(\.pub)?|id_ed25519|[^/]+\.pem|[^/]+\.key|audit\.jsonl)$/;

/** our own addresses and AWS account ids, from the local key registry (empty without it) */
export function ownFacts(file = process.env.KMS_REGISTRY || join(process.env.HOME || '', '.kms-access/registry.json')) {
  const out = { registry: existsSync(file), addresses: new Set(), accounts: new Set(), patterns: kmsPatterns(null, null) };
  if (!out.registry) return out;
  const text = readFileSync(file, 'utf8');
  out.patterns = kmsPatterns(file, JSON.parse(text));
  for (const m of text.matchAll(/arn:aws:[a-z]+::?(\d{12}):|"account(?:Id)?"\s*:\s*"(\d{12})"/g)) out.accounts.add(m[1] ?? m[2]);
  const walk = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${i}`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    else if (typeof v === 'string' && /(keys\.[^.]+\.address|safe|owner|treasury|pay_?to|payout|reserve|solana|deployer|signer)/i.test(path)
      && (/^0x[0-9a-fA-F]{40}$/.test(v) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v))) out.addresses.add(v.toLowerCase());
  };
  walk(JSON.parse(text), '');
  return out;
}

const sha = (s) => createHash('sha256').update(s).digest('hex');
/** the package's allow file (empty without one); an entry without a why is refused */
export function allowOf(dir) {
  const f = dir && join(dir, '.npm-pack-scan-allow.json');
  if (!f || !existsSync(f)) return { addresses: new Set(), kinds: [] };
  const a = JSON.parse(readFileSync(f, 'utf8'));
  for (const e of [...(a.addresses ?? []), ...(a.kinds ?? [])]) if (!e.why) throw new Error('.npm-pack-scan-allow.json: every entry says why');
  return { addresses: new Set((a.addresses ?? []).map((e) => e.sha256)), kinds: a.kinds ?? [] };
}

/** the findings in one file's text: [kind, ...] (never the value) */
export function findingsIn(text, own = { addresses: new Set(), accounts: new Set() }, allow = { addresses: new Set(), kinds: [] }, file = '') {
  const allowedKind = (n) => allow.kinds.some((k) => k.kind === n && (k.files ?? []).includes(file));
  const kms = [...KMS_PATTERNS, ...(own.patterns ?? [])];
  const hits = [...SECRET_PATTERNS.filter(([, re]) => re.test(text)), ...kms.filter(([n, re]) => re.test(text) && !allowedKind(n))].map(([n]) => n);
  const low = text.toLowerCase();
  const addr = [...own.addresses].filter((a) => low.includes(a) && !allow.addresses.has(sha(a)));
  if (addr.length) hits.push(`${addr.length} of our own key/Safe/payee/treasury addresses (${addr.map((a) => `${a.slice(0, 6)}…`).join(', ')})`);
  const acct = [...own.accounts].filter((a) => new RegExp(`(?<!\\d)${a}(?!\\d)`).test(text));
  if (acct.length) hits.push(`${acct.length} of our AWS account ids`);
  return hits;
}

/** the files npm would publish from `dir`, as [relative path, absolute path] */
function packedFiles(dir) {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  return JSON.parse(out)[0].files.map((f) => [f.path, join(dir, f.path)]);
}
/** the files of a published tarball, unpacked into a temp dir */
function tarballFiles(tgz) {
  const d = mkdtempSync(join(tmpdir(), 'npm-pack-scan-'));
  execFileSync('tar', ['xzf', tgz, '-C', d]);
  const files = [];
  const walk = (p) => { for (const f of readdirSync(p)) { const q = join(p, f); if (statSync(q).isDirectory()) walk(q); else files.push([relative(join(d, 'package'), q), q]); } };
  walk(d);
  return { files, cleanup: () => rmSync(d, { recursive: true, force: true }) };
}

export function scan(files, own, allow = { addresses: new Set(), kinds: [] }) {
  const findings = [];
  for (const [rel, abs] of files) {
    if (/(^|\/)npm-pack-scan\.mjs$/.test(rel)) continue; // this scan itself (its patterns name the kinds)
    if (NEVER_SHIP.test(rel)) findings.push({ file: rel, kinds: ['a file that must never ship'] });
    const st = statSync(abs);
    if (st.size > 16 << 20) continue;
    const buf = readFileSync(abs);
    if (buf.includes(0) && !/\.(js|mjs|cjs|json|map|md|txt|ts)$/.test(rel)) continue; // binary
    const kinds = findingsIn(buf.toString('utf8'), own, allow, rel);
    if (kinds.length) findings.push({ file: rel, kinds });
  }
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('npm-pack-scan.mjs')) {
  const own = ownFacts();
  const tgz = arg('--tarball');
  const dir = arg('--dir') ?? process.cwd();
  let files, cleanup = () => {};
  if (tgz) ({ files, cleanup } = tarballFiles(tgz)); else files = packedFiles(dir);
  const findings = scan(files, own, tgz ? undefined : allowOf(dir));
  cleanup();
  const name = tgz ?? (() => { try { const p = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')); return `${p.name}@${p.version}`; } catch { return dir; } })();
  if (process.argv.includes('--json')) console.log(JSON.stringify({ name, files: files.length, registry: own.registry, findings }));
  else {
    for (const f of findings) console.error(`  ${f.file}: ${f.kinds.join('; ')}`);
    console.error(`npm-pack-scan ${name}: ${files.length} files, ${findings.length ? `${findings.length} refused` : 'clean'}${own.registry ? `, own addresses ${own.addresses.size} and accounts ${own.accounts.size} checked` : ', NO key registry here: own addresses and accounts not checked'}`);
  }
  if (findings.length || (strict && !own.registry)) process.exit(1);
}
