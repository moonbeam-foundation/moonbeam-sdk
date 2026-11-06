/**
 * @moonbeam-foundation/sdk/workflows: the Moonbeam Studio's agentic commerce workflows, as data.
 *
 * Each workflow is the canvas the Studio draws (nodes and edges, exported from the Studio's own templates), and every node
 * that calls the layer names the SDK function that runs the same step (`STEP_CALLS`). The pictures in docs/workflows are
 * those canvases, captured from the Studio.
 *
 *   WORKFLOWS                 the seven workflows: publish · list-business · onboard · sell-edge · resell · hire-from-chat · onboard-batch
 *   workflowOf(id)            one workflow, or null
 *   stepsOf(workflow)         its nodes in the order an item travels, each with its class, meaning, SDK call and last verification
 *   STEPS · NODE_CLASSES      what every node is: class, meaning, access, markets, the SDK call on Base and on the test network
 *   VERIFIED                  the last recorded run of each layer call (what ran, when, and its evidence)
 *   diagramOf(workflow)       the workflow as text: one line per step, the call under it (`npx moonbeam workflows`)
 */
import { WORKFLOW_DATA } from './data.js';
import type { Workflow, WorkflowNode } from './types.js';

export type { Workflow, WorkflowEdge, WorkflowNode } from './types.js';
export { NODE_CLASSES, STEPS, classOf } from './steps.js';
export type { NodeClass, Market, Access, StepInfo } from './steps.js';
import { STEPS, classOf, type NodeClass, type StepInfo } from './steps.js';
import { VERIFIED } from './verified.js';
export { VERIFIED } from './verified.js';
export type { Verification } from './verified.js';

/** Where a step runs in this SDK: the subpath and the function, or the Studio when the step is the Studio's own. */
export type StepCall = { module: `@moonbeam-foundation/sdk/${'market' | 'devnet' | 'judge' | 'resale' | 'assurance'}`; fn: string } | { module: null; fn: null; why: string };
/** Every layer call a Studio workflow makes, and the SDK function that runs it on Base (0.10.0's table, now derived from STEPS). */
export const STEP_CALLS: Readonly<Record<string, StepCall>> = Object.freeze(Object.fromEntries(Object.entries(STEPS).map(([op, i]) =>
  [op, i.base ? { module: `@moonbeam-foundation/sdk/${i.base.module}` as const, fn: i.base.fn } : { module: null, fn: null, why: `in the Studio: ${i.means}` }])));

/** The seven workflows of the Moonbeam Studio. */
export const WORKFLOWS: readonly Workflow[] = WORKFLOW_DATA;

/** One workflow by id, or null. */
export const workflowOf = (id: string): Workflow | null => WORKFLOWS.find((w) => w.id === id) ?? null;

/** The canvas picture of a workflow, as captured from the Studio. */
export const imageOf = (w: Pick<Workflow, 'id'>): string => `https://raw.githubusercontent.com/moonbeam-foundation/moonbeam-sdk/main/docs/workflows/${w.id}.png`;

export type Step = WorkflowNode & { class: NodeClass; info: StepInfo | null; call: StepCall | null; verified: (typeof VERIFIED)[string] | null; tools: string[] };
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
  const step = (n: WorkflowNode, tools: string[]): Step => ({ ...n, class: classOf(n), info: n.op ? STEPS[n.op] ?? null : null, call: n.op ? STEP_CALLS[n.op] ?? null : null, verified: n.op ? VERIFIED[n.op] ?? null : null, tools });
  for (const n of order) {
    const tools = w.edges.filter((e) => e.type !== 'main' && e.to === n.name).map((e) => e.from);
    out.push(step(n, tools));
    for (const t of tools) { const x = byName.get(t); if (x && !seen.has(t)) { seen.add(t); out.push(step(x, [])); } }
  }
  for (const n of w.nodes) if (!seen.has(n.name)) out.push(step(n, []));
  return out;
}

const callText = (c: StepCall | null): string => (!c ? '' : c.module ? `${c.fn}()  ${c.module.replace('@moonbeam-foundation/sdk/', './')}` : c.why);
const MARK = { ran: '✓', planned: '◇', refused: '✗', 'not-run': '·', studio: '▪' } as const;
/** The workflow as text, one line per step with the call that runs it. Pure. */
export function diagramOf(w: Workflow): string {
  const steps = stepsOf(w);
  const lines = [`${w.title}`, `${w.does}`, ''];
  steps.forEach((s, i) => {
    const flags = [s.class, s.op, s.moves_money ? 'moves money' : null, s.signer ? `${s.signer} signs` : null].filter(Boolean).join(' · ');
    lines.push(`${i === 0 ? '●' : s.tools.length || !w.edges.some((e) => e.type !== 'main' && e.from === s.name) ? '↓' : '└'} ${s.name}  (${flags})${s.verified ? `  ${MARK[s.verified.status]} ${s.verified.status}` : ''}`);
    const c = callText(s.call); if (c) lines.push(`    ${c}`);
    if (s.info) lines.push(`    ${s.info.means}`);
  });
  return lines.join('\n');
}
