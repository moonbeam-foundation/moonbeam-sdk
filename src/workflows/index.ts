/**
 * @moonbeam-foundation/sdk/workflows: the Moonbeam Studio's agentic commerce workflows, as data.
 *
 * Each workflow is the canvas the Studio draws (nodes and edges, exported from the Studio's own templates), and every node
 * that calls the layer names the SDK function that runs the same step (`STEP_CALLS`). The pictures in docs/workflows are
 * those canvases, captured from the Studio.
 *
 *   WORKFLOWS                 the seven workflows: publish · list-business · onboard · sell-edge · resell · hire-from-chat · onboard-batch
 *   workflowOf(id)            one workflow, or null
 *   stepsOf(workflow)         its nodes in the order an item travels, each with the SDK call that runs it
 *   diagramOf(workflow)       the workflow as text: one line per step, the call under it (`npx moonbeam workflows`)
 */
import { WORKFLOW_DATA } from './data.js';
import type { Workflow, WorkflowNode } from './types.js';

export type { Workflow, WorkflowEdge, WorkflowNode } from './types.js';

/** Where a step runs in this SDK: the subpath and the function, or the Studio when the step is the Studio's own. */
export type StepCall = { module: '@moonbeam-foundation/sdk/market' | '@moonbeam-foundation/sdk/devnet' | '@moonbeam-foundation/sdk/judge'; fn: string } | { module: null; fn: null; why: string };

const M = '@moonbeam-foundation/sdk/market' as const;
const D = '@moonbeam-foundation/sdk/devnet' as const;
const J = '@moonbeam-foundation/sdk/judge' as const;
const studio = (why: string): StepCall => ({ module: null, fn: null, why });

/** Every layer call a Studio workflow makes, and the SDK function that makes it. A test holds this table complete. */
export const STEP_CALLS: Readonly<Record<string, StepCall>> = Object.freeze({
  'GET /v1/match/search': { module: M, fn: 'searchSellers' },
  'GET /v1/match/demands': { module: M, fn: 'findBuyers' },
  'GET /v1/venues/:id': { module: M, fn: 'market' },
  'GET /v1/settle/:id': { module: M, fn: 'jobRecord' },
  'GET /v1/exchanges': { module: M, fn: 'listedEdges' },
  'GET /v1/agents/identity': { module: M, fn: 'identity' },
  'GET /v1/agents/:chain/:id/readiness': { module: M, fn: 'readiness' },
  'POST /v1/agents/probe': { module: M, fn: 'testEndpoint' },
  'POST /v1/pools/quote': { module: D, fn: 'quoteEdge' },
  'POST /v1/settle': { module: D, fn: 'hire' },
  'POST /v1/handshake': { module: D, fn: 'hire' },
  'POST /v1/judge/compose': { module: J, fn: 'gradeJob' },
  'POST /v1/assurance/call': { module: D, fn: 'settle' },
  'GET /v1/onboard/worklist': { module: D, fn: 'findSellers' },
  'POST /v1/exchanges/edge': { module: D, fn: 'writeEdge' },
  'POST /v1/exchanges/:edge_id/call': { module: D, fn: 'callEdge' },
  // the ten modules of "List my business": each is the Studio's panel; the layer calls under them are these
  'pure:business.workflow': studio('the workflow shell: the Studio keeps the run'),
  'pure:business.read': studio('your own pages, read by the Studio'),
  'pure:business.claim': studio('the claim line, read back from your own host by the Studio'),
  'pure:business.door': { module: M, fn: 'testEndpoint' },
  'pure:business.publish': { module: M, fn: 'publishListing' },
  'pure:business.reach': { module: M, fn: 'readListing' },
  'pure:business.pay': { module: M, fn: 'searchSellers' },
  'pure:business.keep': { module: M, fn: 'readListing' },
  'pure:business.seen': { module: M, fn: 'listingCard' },
  'pure:business.plan': { module: M, fn: 'keyStanding' },
  'pure:onboard.fix': { module: M, fn: 'checkAgent' },
  'pure:manual': studio('the Moonbeam manual, shown in the Studio'),
  'pure:wilson.sides': studio('the quote split for both sides, computed from the quote'),
});

/** The seven workflows of the Moonbeam Studio. */
export const WORKFLOWS: readonly Workflow[] = WORKFLOW_DATA;

/** One workflow by id, or null. */
export const workflowOf = (id: string): Workflow | null => WORKFLOWS.find((w) => w.id === id) ?? null;

/** The canvas picture of a workflow, as captured from the Studio. */
export const imageOf = (w: Pick<Workflow, 'id'>): string => `https://raw.githubusercontent.com/moonbeam-foundation/moonbeam-sdk/main/docs/workflows/${w.id}.png`;

export type Step = WorkflowNode & { call: StepCall | null; tools: string[] };
/**
 * The nodes in the order an item travels (the `main` edges from the trigger), each with its SDK call. A chat agent's model,
 * memory and tools hang off it (`ai_*` edges): they are listed under the agent as `tools`, and each tool follows it.
 */
export function stepsOf(w: Workflow): Step[] {
  const byName = new Map(w.nodes.map((n) => [n.name, n]));
  const main = w.edges.filter((e) => e.type === 'main');
  const into = new Set(main.map((e) => e.to));
  const hangs = new Set(w.edges.filter((e) => e.type !== 'main').map((e) => e.from));
  const start = w.nodes.find((n) => !into.has(n.name) && !hangs.has(n.name) && main.some((e) => e.from === n.name)) ?? w.nodes[0];
  const order: WorkflowNode[] = []; const seen = new Set<string>();
  for (let n = start; n && !seen.has(n.name); n = byName.get(main.find((e) => e.from === n!.name)?.to ?? '')) { seen.add(n.name); order.push(n); }
  const out: Step[] = [];
  for (const n of order) {
    const tools = w.edges.filter((e) => e.type !== 'main' && e.to === n.name).map((e) => e.from);
    out.push({ ...n, call: n.op ? STEP_CALLS[n.op] ?? null : null, tools });
    for (const t of tools) { const x = byName.get(t); if (x && !seen.has(t)) { seen.add(t); out.push({ ...x, call: x.op ? STEP_CALLS[x.op] ?? null : null, tools: [] }); } }
  }
  for (const n of w.nodes) if (!seen.has(n.name)) out.push({ ...n, call: n.op ? STEP_CALLS[n.op] ?? null : null, tools: [] });
  return out;
}

const callText = (c: StepCall | null): string => (!c ? '' : c.module ? `${c.fn}()  ${c.module.replace('@moonbeam-foundation/sdk/', './')}` : `in the Studio: ${c.why}`);
/** The workflow as text, one line per step with the call that runs it. Pure. */
export function diagramOf(w: Workflow): string {
  const steps = stepsOf(w);
  const lines = [`${w.title}`, `${w.does}`, ''];
  steps.forEach((s, i) => {
    const flags = [s.op ?? s.role, s.moves_money ? 'moves money' : null, s.signer ? `${s.signer} signs` : null].filter(Boolean).join(' · ');
    lines.push(`${i === 0 ? '●' : s.tools.length || !w.edges.some((e) => e.type !== 'main' && e.from === s.name) ? '↓' : '└'} ${s.name}${flags ? `  (${flags})` : ''}`);
    const c = callText(s.call); if (c) lines.push(`    ${c}`);
  });
  return lines.join('\n');
}
