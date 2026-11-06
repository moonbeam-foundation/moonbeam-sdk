import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import * as marketMod from '../src/market/index.js';
import * as devnetMod from '../src/devnet/index.js';
import * as judgeMod from '../src/judge/index.js';
import { STEP_CALLS, WORKFLOWS, diagramOf, imageOf, stepsOf, workflowOf } from '../src/workflows/index.js';

const MODULES: Record<string, Record<string, unknown>> = { '@moonbeam-foundation/sdk/market': marketMod, '@moonbeam-foundation/sdk/devnet': devnetMod, '@moonbeam-foundation/sdk/judge': judgeMod };

describe('the Studio’s workflows (./workflows)', () => {
  it('seven workflows, each with its picture captured from the Studio', () => {
    expect(WORKFLOWS.map((w) => w.id)).toEqual(['publish', 'list-business', 'onboard', 'sell-edge', 'resell', 'hire-from-chat', 'onboard-batch']);
    for (const w of WORKFLOWS) {
      expect(existsSync(new URL(`../docs/workflows/${w.id}.png`, import.meta.url)), w.id).toBe(true);
      expect(imageOf(w)).toBe(`https://raw.githubusercontent.com/moonbeam-foundation/moonbeam-sdk/main/docs/workflows/${w.id}.png`);
    }
  });
  it('every layer call a workflow makes names an SDK function that exists, or says why it is the Studio’s', () => {
    for (const w of WORKFLOWS) for (const n of w.nodes) {
      if (!n.op) continue;
      const c = STEP_CALLS[n.op];
      expect(c, `${w.id}.${n.name}: ${n.op}`).toBeTruthy();
      if (c!.module) expect(typeof MODULES[c!.module]![c!.fn], `${c!.module} ${c!.fn}`).toBe('function');
      else expect(c!.why.length).toBeGreaterThan(10);
    }
    // a row no workflow uses is a step of the Studio's palette (Find buyers, Market), or a stale row
    const used = new Set(WORKFLOWS.flatMap((w) => w.nodes.map((n) => n.op)));
    expect(Object.keys(STEP_CALLS).filter((op) => !used.has(op))).toEqual(['GET /v1/match/demands', 'GET /v1/venues/:id']);
  });
  it('steps travel from the trigger to the output; a chat agent’s model, memory and tools follow it', () => {
    const sell = stepsOf(workflowOf('sell-edge')!).map((s) => s.name);
    expect(sell).toEqual(['A buyer asks', 'find_edge', 'sell_through', 'Sold']);
    const chat = stepsOf(workflowOf('hire-from-chat')!);
    expect(chat[0]!.name).toBe('Chat'); expect(chat[chat.length - 1]!.name).toBe('Answer');
    expect(chat.find((s) => s.name === 'Moonbeam agent')!.tools).toContain('find_seller');
    for (const w of WORKFLOWS) expect(stepsOf(w)).toHaveLength(w.nodes.length);
    expect(workflowOf('nope')).toBeNull();
  });
  it('the diagram names each step’s SDK call', () => {
    const d = diagramOf(workflowOf('sell-edge')!);
    expect(d).toContain('listedEdges()  ./market'); expect(d).toContain('callEdge()  ./devnet');
  });
  it('the data is the Studio’s export, and names no internal product', () => {
    const json = readFileSync(new URL('../src/workflows/studio-workflows.json', import.meta.url), 'utf8');
    expect(JSON.parse(json)).toEqual(WORKFLOWS);
    expect(json).not.toMatch(/taifoon|n8n|genie|0x[0-9a-fA-F]{40}/i);
  });
});
