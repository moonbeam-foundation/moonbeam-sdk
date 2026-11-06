/** One node of a Studio workflow: its role on the canvas, the layer call it runs (null for the trigger, the model and the
 *  output), and what it does to the world. */
export type WorkflowNode = {
  name: string;
  role: string | null;
  op: string | null;
  title: string | null;
  effect: string | null;
  moves_money: boolean;
  signer: string | null;
};
/** One edge of the canvas: `main` carries the item from step to step; `ai_*` hand a chat agent its model, memory and tools. */
export type WorkflowEdge = { from: string; to: string; type: string };
/** One workflow of the Moonbeam Studio, as its canvas draws it. */
export type Workflow = { id: string; title: string; does: string; nodes: WorkflowNode[]; edges: WorkflowEdge[] };
