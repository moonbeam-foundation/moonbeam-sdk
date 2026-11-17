/**
 * The ports a playground run goes through, and in-memory fakes of them (`fakePorts`). No live port ships here: a run on a
 * network needs the coord pipe's sign purposes of that network armed first.
 *
 *   wallet   signs the `wallet:*` steps (the buyer's, the seller's, the backer's) and names the run's parties
 *   stream   the coord pipe: `sign(step)` is a sign request for a `coord:*` step, answered with { tx, ack };
 *            `settle(plan, steps)` hands the run to the sale run, which acks each stage it reached
 *   chain    `event(tx)` reads a transaction's events; `waitUntil(window)` resolves once chain time passed it (never a sleep)
 */
import { keccakHex } from '../onboard/index.js';
import type { Address, Hex } from '../onboard/index.js';
import type { LightId, Wait } from './cases.js';
import type { Plan, PlanStep, Parties } from './index.js';

/** An acknowledgement on the coord pipe: of a sign request (`signed`), or of a stage the sale run reached. `tx`: the
 *  transaction the stage rests on (for `paid`, the transfer to the seller). */
export interface Ack { id: string; stage: LightId | 'signed'; tx?: Hex }
/** One event a transaction emitted. */
export interface ChainEvent { name: string; args?: Readonly<Record<string, unknown>> }
/** What a step waits for: a window after the previous transaction, or a point in chain time (the deadline). */
export interface WaitFor { window: Wait; seconds?: number; at?: number; after: Hex | null }

export interface WalletPort {
  /** the run's parties: on the devnet, wallets made for this run only */
  parties?(): Promise<Parties>;
  sign(step: PlanStep): Promise<{ tx: Hex | null }>;
}
/**
 * How the coord stream answered one sign request. Absent means `signed` when a transaction came back (the fakes leave it out).
 *   signed        the purpose is armed and released a signature; `tx` is the transaction that went out
 *   shadow        the purpose is in shadow: the signer answers what it WOULD sign (`would`) and signs nothing, so no transaction
 *   refused       the purpose or a rule refused it (`reason` carries the signer's code and words)
 *   not_routable  no route to the signer for this request on this port (`reason` says what is missing)
 *   no_answer     the request went out and no result came back within the port's reads
 */
export type SignStatus = 'signed' | 'shadow' | 'refused' | 'not_routable' | 'no_answer';
export interface SignAnswer { tx: Hex | null; ack: Ack | null; status?: SignStatus; reason?: string; would?: unknown }

export interface StreamPort {
  sign(step: PlanStep): Promise<SignAnswer>;
  settle(plan: Plan, steps: readonly RunStepResult[]): Promise<{ acks: readonly Ack[] } | null>;
}
export interface ChainPort {
  event(tx: Hex): Promise<readonly ChainEvent[]>;
  waitUntil(w: WaitFor): Promise<void>;
}
export interface Ports { wallet: WalletPort; stream: StreamPort; chain: ChainPort }

/** A step as it ran. */
export interface RunStepResult extends PlanStep {
  tx: Hex | null; ack: Ack | null; events: readonly ChainEvent[]; ok: boolean;
  /** a Moonbeam step's answer on the stream when it was not a plain signature; `skipped`: a user step not sent after a step that
   *  only would sign (its chain state never came to be) */
  sign?: { status: SignStatus | 'skipped'; reason?: string; would?: unknown };
}

// ── in-memory fakes ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FakeOptions {
  /** stages the fake sale run does not ack */
  withhold?: readonly LightId[];
  /** a step fn the fake signers return no transaction for */
  noTxFor?: string;
  /** the run's parties (default: three made-up addresses) */
  parties?: Parties;
}
export interface FakePorts extends Ports {
  /** every port call, in order */
  log: string[];
  /** the fake chain's clock, advanced by waitUntil only */
  clock: { now: number };
}

const FAKE_PARTIES: Parties = Object.freeze({
  buyer: '0x00000000000000000000000000000000000000B1' as Address,
  seller: '0x00000000000000000000000000000000000000b2' as Address,
  backer: '0x00000000000000000000000000000000000000B3' as Address,
});

/** In-memory ports: each signed step gets a transaction whose events are the ones the plan expects of it. */
export function fakePorts(o: FakeOptions = {}): FakePorts {
  const log: string[] = [];
  const clock = { now: 1_800_000_000 };
  const byTx = new Map<Hex, PlanStep>();
  let n = 0;
  const txOf = (step: PlanStep): Hex | null => {
    if (o.noTxFor !== undefined && step.fn === o.noTxFor) return null;
    const tx = keccakHex(new TextEncoder().encode(`fake-tx:${++n}:${step.fn}`));
    byTx.set(tx, step);
    return tx;
  };
  const parties = o.parties ?? FAKE_PARTIES;
  return {
    log, clock,
    wallet: {
      parties: async () => { log.push('wallet.parties'); return parties; },
      sign: async (step) => { log.push(`wallet.sign ${step.fn}`); return { tx: txOf(step) }; },
    },
    stream: {
      sign: async (step) => {
        log.push(`stream.sign ${step.fn} ${step.signer}`);
        const tx = txOf(step);
        return { tx, ack: tx ? { id: `ack:${n}`, stage: 'signed' } : null };
      },
      settle: async (plan, steps) => {
        log.push('stream.settle');
        const ending = steps.find((s) => s.ends && s.tx);
        const acks: Ack[] = [];
        for (const l of plan.lights) {
          if (!l.expected || o.withhold?.includes(l.light)) continue;
          acks.push({ id: `ack:${l.light}`, stage: l.light, ...(l.light === 'paid' && ending?.tx ? { tx: ending.tx } : {}) });
        }
        return { acks };
      },
    },
    chain: {
      event: async (tx) => {
        log.push('chain.event');
        const step = byTx.get(tx);
        if (!step) return [];
        const ev: ChainEvent[] = step.expects.events.map((name) => ({ name, ...(name === 'JobOpened' && step.expects.opens ? { args: { seller: step.expects.opens.seller } } : {}) }));
        for (const t of step.expects.transfers ?? []) ev.push({ name: 'Transfer', args: { to: t.to, value: t.units } });
        return ev;
      },
      waitUntil: async (w) => {
        log.push(`chain.waitUntil ${w.window}`);
        clock.now = w.at !== undefined ? Math.max(clock.now, w.at + 1) : clock.now + (w.seconds ?? 0) + 1;
      },
    },
  };
}
