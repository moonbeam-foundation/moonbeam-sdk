#!/usr/bin/env node
// Draw every workflow from its data: docs/workflows/<id>.svg (and .png with --png, through headless Chrome).
// One look for all seven: a node's colour is its class, its corner mark is its last verification (src/workflows/verified.ts).
//   npm run build && node scripts/gen-diagrams.mjs [--png]
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { WORKFLOWS, stepsOf, NODE_CLASSES, VERIFIED } from '../dist/workflows/index.js';

const COLOR = {
  trigger: '#5B6475', agent: '#6D28D9', model: '#8B5CF6', memory: '#A78BFA', knowledge: '#1F8F8B', check: '#2F6FDB',
  transform: '#D9733F', connector: '#D6156F', money: '#B42318', studio: '#98A2B3', output: '#344054',
};
const MARK = { ran: ['#12B76A', '✓'], planned: ['#7A5AF8', '◇'], refused: ['#F04438', '✗'], 'not-run': ['#F79009', '·'], studio: ['#98A2B3', '▪'] };
const W = 184, H = 82, GX = 30, GY = 46, PAD = 28, PER_ROW = 5;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const label = (s) => s.op ? s.op.replace(/^pure:business\./, 'module: ').replace(/^pure:/, '') : s.class;

function box(s, x, y) {
  const c = COLOR[s.class] ?? '#667085'; const v = s.verified ? MARK[s.verified.status] : null;
  const call = s.call?.fn ? `${s.call.fn}()` : '';
  return `<g transform="translate(${x},${y})">
  <rect width="${W}" height="${H}" rx="10" fill="#FFFFFF" stroke="#D0D5DD"/>
  <rect width="6" height="${H}" rx="3" fill="${c}"/>
  <text x="16" y="21" font-size="10.5" font-weight="600" fill="${c}" letter-spacing=".4">${esc(s.class.toUpperCase())}</text>
  <text x="16" y="40" font-size="14" font-weight="600" fill="#101828">${esc(cut(s.name, 21))}</text>
  <text x="16" y="57" font-size="10.5" fill="#475467" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">${esc(cut(label(s), 27))}</text>
  ${call ? `<text x="16" y="72" font-size="10.5" fill="#667085" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">${esc(cut(call, 27))}</text>` : ''}
  ${v ? `<circle cx="${W - 15}" cy="15" r="9" fill="${v[0]}"/><text x="${W - 15}" y="19.5" font-size="12" font-weight="700" fill="#fff" text-anchor="middle">${v[1]}</text>` : ''}
</g>`;
}
const arrow = (x1, y1, x2, y2) => `<path d="M${x1},${y1} L${x2},${y2}" stroke="#98A2B3" stroke-width="1.6" fill="none" marker-end="url(#a)"/>`;
const elbow = (x1, y1, x2, y2) => `<path d="M${x1},${y1} V${(y1 + y2) / 2} H${x2} V${y2}" stroke="#98A2B3" stroke-width="1.6" fill="none" marker-end="url(#a)"/>`;

function draw(w) {
  const steps = stepsOf(w);
  const hangs = new Set(w.edges.filter((e) => e.type !== 'main').map((e) => e.from));
  const chain = steps.filter((s) => !hangs.has(s.name));
  const parts = []; const at = new Map();
  chain.forEach((s, i) => { const r = Math.floor(i / PER_ROW), c = i % PER_ROW; at.set(s.name, [PAD + c * (W + GX), 64 + r * (H + GY)]); });
  const rows = Math.ceil(chain.length / PER_ROW);
  let y0 = 64 + rows * (H + GY) + 18;
  // a chat agent's model, memory and tools: one row under the chain, wired up to their agent
  const tools = steps.filter((s) => hangs.has(s.name));
  tools.forEach((s, i) => at.set(s.name, [PAD + (i % PER_ROW) * (W + GX), y0 + Math.floor(i / PER_ROW) * (H + GY)]));
  const toolRows = Math.ceil(tools.length / PER_ROW);
  const cols = Math.min(PER_ROW, Math.max(chain.length, tools.length));
  const width = Math.max(PAD * 2 + cols * W + (cols - 1) * GX, 640);
  const legendY = toolRows ? y0 + toolRows * (H + GY) + 4 : 64 + rows * (H + GY) - GY + 30;
  for (let i = 1; i < chain.length; i++) {
    const [ax, ay] = at.get(chain[i - 1].name), [bx, by] = at.get(chain[i].name);
    parts.push(ay === by ? arrow(ax + W, ay + H / 2, bx - 3, by + H / 2) : elbow(ax + W / 2, ay + H, bx + W / 2, by - 3));
  }
  // the agent's model, memory and tools: one group, wired once to the agent they serve
  const owner = [...new Set(w.edges.filter((x) => x.type !== 'main').map((x) => x.to))][0];
  if (tools.length && owner && at.get(owner)) {
    const [ox, oy] = at.get(owner); const gx = PAD - 12, gy = y0 - 30, gw = Math.min(PER_ROW, tools.length) * (W + GX) - GX + 24, gh = toolRows * (H + GY) - GY + 42;
    parts.push(`<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" rx="12" fill="#F4F3FF" stroke="#C4B5FD" stroke-dasharray="5 4"/>`);
    parts.push(`<text x="${gx + 14}" y="${gy + 18}" font-size="11" font-weight="600" fill="#6D28D9">the agent’s model, memory and tools</text>`);
    parts.push(`<path d="M${ox + W / 2},${oy + H} V${gy - 3}" stroke="#A78BFA" stroke-width="1.6" stroke-dasharray="4 3" fill="none" marker-end="url(#a)"/>`);
  }
  for (const s of steps) { const p = at.get(s.name); if (p) parts.push(box(s, p[0], p[1])); }
  const used = [...new Set(steps.map((s) => s.class))];
  const leg = used.map((c, i) => `<g transform="translate(${PAD + (i % 6) * 150},${legendY + Math.floor(i / 6) * 20})"><rect width="10" height="10" rx="2" fill="${COLOR[c]}"/><text x="16" y="9.5" font-size="11" fill="#475467">${c}</text></g>`).join('');
  const marks = Object.entries({ ran: 'ran live', planned: 'planned', 'not-run': 'not run today', studio: 'the Studio’s own' })
    .map(([k, t], i) => `<g transform="translate(${PAD + i * 150},${legendY + Math.ceil(used.length / 6) * 20 + 6})"><circle cx="5" cy="5" r="6" fill="${MARK[k][0]}"/><text x="5" y="8.5" font-size="8.5" font-weight="700" fill="#fff" text-anchor="middle">${MARK[k][1]}</text><text x="16" y="9.5" font-size="11" fill="#475467">${t}</text></g>`).join('');
  const height = legendY + Math.ceil(used.length / 6) * 20 + 34;
  const at0 = steps.find((s) => s.verified)?.verified?.at ?? '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter,system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#98A2B3"/></marker></defs>
<rect width="100%" height="100%" rx="14" fill="#FCFCFD"/>
<text x="${PAD}" y="30" font-size="17" font-weight="700" fill="#101828">${esc(w.title)}</text>
<text x="${PAD}" y="48" font-size="11.5" fill="#667085">Moonbeam Studio workflow · ${steps.length} nodes · verified ${esc(at0)} · npx moonbeam workflows ${esc(w.id)}</text>
${parts.join('\n')}
${leg}${marks}
</svg>`;
}

mkdirSync(new URL('../docs/workflows/', import.meta.url), { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
for (const w of WORKFLOWS) {
  const svg = draw(w);
  const f = new URL(`../docs/workflows/${w.id}.svg`, import.meta.url);
  writeFileSync(f, svg);
  if (process.argv.includes('--png')) {
    const [, wd, ht] = /width="(\d+)" height="(\d+)"/.exec(svg);
    const html = new URL(`../docs/workflows/.${w.id}.html`, import.meta.url);
    writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style>${svg}`);
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2', `--window-size=${wd},${ht}`,
      `--screenshot=${new URL(`../docs/workflows/${w.id}.png`, import.meta.url).pathname}`, html.href], { stdio: 'ignore' });
    execFileSync('rm', ['-f', html.pathname]);
  }
  console.log(`${w.id}: ${stepsOf(w).length} nodes`);
}
// docs/WORKFLOWS.md: every workflow, its picture, and one row per node (class, call, SDK, meaning, last verification)
const RAW = 'https://raw.githubusercontent.com/moonbeam-foundation/moonbeam-sdk/main/docs';
const word = { ran: '✓ ran live', planned: '◇ planned', refused: '✗ refused', 'not-run': '· not run', studio: '▪ the Studio' };
const md = ['# The Moonbeam Studio\'s workflows, node by node', '',
  'Each workflow is drawn from its data (`@moonbeam-foundation/sdk/workflows`); a node\'s colour is its class, its mark its last verification. ' +
  'The same canvases as the Studio shows them are under [`docs/studio/`](studio/).', '',
  '| Class | Means |', '|---|---|', ...Object.entries(NODE_CLASSES).map(([k, v]) => `| **${k}** | ${v} |`), ''];
for (const w of WORKFLOWS) {
  md.push(`## ${w.title} · \`${w.id}\``, '', w.does, '', `![${w.title}](${RAW}/workflows/${w.id}.png)`, '',
    '| # | Node | Class | Layer call | SDK | What it means | Last run |', '|---|---|---|---|---|---|---|');
  stepsOf(w).forEach((s, i) => md.push(`| ${i + 1} | ${s.name} | ${s.class} | ${s.op && !s.op.startsWith('pure:') ? `\`${s.op}\`` : '–'} | ${s.call?.fn ? `\`${s.call.fn}()\` ${s.call.module.replace('@moonbeam-foundation/sdk/', './')}` : '–'} | ${s.info?.means ?? NODE_CLASSES[s.class]} | ${s.verified ? `${word[s.verified.status]} ${s.verified.at}: ${s.verified.evidence.replace(/\|/g, '/').slice(0, 140)}${s.verified.testnet?.txs?.length ? `; on the test network ${s.verified.testnet.txs.length} transactions${s.verified.testnet.ending ? `, ending ${s.verified.testnet.ending}` : ''} ([the run](#test-network-run))` : ''}` : '–'} |`));
  md.push('', `\`npx moonbeam workflows ${w.id}\` prints the same steps.`, '');
}
const tn = Object.values(VERIFIED).find((v) => v.testnet?.txs?.length && v.testnet.ending)?.testnet;
if (tn) md.push('## Test network run', '', `One job, end to end, through the Studio's run on ${tn.at ?? ''}: hand-over ${tn.handshake ?? ''}, grade ${tn.decision ?? ''}, ending ${tn.ending}.`, '',
  '| Step | Signer | Chain | Block | Transaction |', '|---|---|---|---|---|', ...tn.txs.map((x) => `| ${x.action} | ${x.signer} | ${x.chain} | ${x.block} | \`${x.tx}\` |`), '');
writeFileSync(new URL('../docs/WORKFLOWS.md', import.meta.url), md.join('\n'));
console.log('classes:', Object.keys(NODE_CLASSES).join(' '), '· wrote docs/WORKFLOWS.md');
