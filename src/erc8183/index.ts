/**
 * ERC-8183 (Agentic Commerce) — the standard this floor implements.
 *
 * The draft ERC defines a job with escrowed budget, six states
 * (Open → Funded → Submitted → Completed | Rejected | Expired), three roles
 * (client, provider, evaluator), and an optional hook interface (IACPHook)
 * called before and after every core function. This module pins the
 * standard's vocabulary so the rest of the SDK can speak it natively:
 * event topics verified against live ledgers (the Base ACP ledger and the
 * Arc testnet reference deployment emit these exact signatures), the state
 * machine, and the mapping between the standard's states and this
 * protocol's four endings.
 *
 * Where the standard ends and this protocol begins, in one sentence: 8183
 * settles when the evaluator says so; here the deposit outweighs the job,
 * the verdict is computed from evidence, and the premium pays the capital
 * that stood behind the work — all designed to ride the standard's own
 * hook, so a job on this floor is a standard job that happens to be
 * guaranteed.
 *
 * Pure by construction, like the rest of the SDK: constants and total
 * functions, no I/O.
 */

/* ── The standard's state machine ───────────────────────────────────────── */

export type Erc8183State =
  | 'Open'
  | 'Funded'
  | 'Submitted'
  | 'Completed'
  | 'Rejected'
  | 'Expired';

export const TERMINAL_STATES: readonly Erc8183State[] = ['Completed', 'Rejected', 'Expired'];

/** The transitions the draft allows, by role. Anything not listed reverts. */
export const TRANSITIONS: readonly {
  readonly from: Erc8183State;
  readonly to: Erc8183State;
  readonly by: 'client' | 'provider' | 'evaluator' | 'anyone';
  readonly call: string;
}[] = [
  { from: 'Open', to: 'Funded', by: 'client', call: 'fund' },
  { from: 'Open', to: 'Rejected', by: 'client', call: 'reject' },
  { from: 'Funded', to: 'Submitted', by: 'provider', call: 'submit' },
  { from: 'Funded', to: 'Rejected', by: 'evaluator', call: 'reject' },
  { from: 'Funded', to: 'Expired', by: 'anyone', call: 'expire (after expiredAt)' },
  { from: 'Submitted', to: 'Completed', by: 'evaluator', call: 'complete' },
  { from: 'Submitted', to: 'Rejected', by: 'evaluator', call: 'reject' },
  { from: 'Submitted', to: 'Expired', by: 'anyone', call: 'expire (after expiredAt)' },
];

/* ── Event topics, verified against live ledgers ────────────────────────── */

/**
 * topic0 for each standard event, confirmed by a signature census over raw
 * logs of the Base ACP ledger and the Arc testnet reference deployment
 * (2026-09-07). If a ledger emits these, our decoder reads it unchanged.
 */
export const EVENT_TOPICS = {
  JobCreated: '0xb0f0239bfdd96453e24733e18bfc24b70d8fadf123dd977473518dd577ee79b9',
  BudgetSet: '0x869e2577b006bf47ee981cf6fec2e25583548081c14b98deab587f77b5068038',
  JobFunded: '0xe3fbcc1ea1bdc559ec7f0347efde7655e58b5f45a30b0e4470a583c3ef5496b3',
  ProviderSet: '0x9a87df076ea1725aba8ba29d32517ce37c9597d88cbf16ec6707892cc330ab69',
  JobSubmitted: '0x80c17db79857f338a6a6df68a6883ecc0ce78e2202fe61ed979733573f40538e',
  JobCompleted: '0x0fd54bd364fa9e67f17b091aefe930932c09fe7651cf5ad02c71a418f3341444',
  JobRejected: '0xae7362b1af91f4492868987b9c73990d780060811551b58728fbe96fd1bab275',
  JobExpired: '0x97237956f8810192811e2c3f273fd02c5d6295206fdd9c62e6fe2bfc19ba9232',
  PaymentReleased: '0x21d71db5be59bb9fa133895586b7404307dd33fb93b16db09dc6f1d9d7d231b0',
  Refunded: '0x7ca5472b7ea78c2c0141c5a12ee6d170cf4ce8ed06be3d22c8252ddfc7a6a2c4',
  EvaluatorFeePaid: '0x253dd534010ac976fa263caa123bae79b9c50292adf7ce67bdc5ec309f784e61',
} as const;

export type Erc8183Event = keyof typeof EVENT_TOPICS;

/** Reverse lookup: what does this topic0 mean? Unknown topics return undefined. */
export function eventForTopic(topic0: string): Erc8183Event | undefined {
  const t = topic0.toLowerCase();
  return (Object.keys(EVENT_TOPICS) as Erc8183Event[]).find(
    (k) => EVENT_TOPICS[k].toLowerCase() === t,
  );
}

/** Fold a lifecycle event into the state it evidences. Non-transition events return undefined. */
export function stateAfter(event: Erc8183Event): Erc8183State | undefined {
  switch (event) {
    case 'JobCreated': return 'Open';
    case 'JobFunded': return 'Funded';
    case 'JobSubmitted': return 'Submitted';
    case 'JobCompleted': return 'Completed';
    case 'JobRejected': return 'Rejected';
    case 'JobExpired': return 'Expired';
    default: return undefined;
  }
}

/* ── This protocol's endings, in the standard's vocabulary ──────────────── */

export type Ending = 'done-right' | 'bad-work' | 'void' | 'cheat';

/**
 * Every ending of this floor lands in a standard terminal state; the
 * assurance semantics (premium routing, deposit claims, computed verdicts)
 * are the hook's business, never a new state. That is the whole
 * compatibility claim, stated as a total function.
 */
export function standardStateFor(ending: Ending): Erc8183State {
  switch (ending) {
    case 'done-right': return 'Completed';
    case 'bad-work': return 'Rejected';
    case 'void': return 'Expired';
    case 'cheat': return 'Rejected'; // + deposit claim via the hook
  }
}

/* ── Two settlement modes, both first-class ─────────────────────────────── */

/**
 * The standard settles a job when the evaluator attests; this floor can also
 * settle by computed verdict through the hook. BOTH stay intact, by design:
 *
 * - ATTESTED: the vanilla ERC-8183 path. The evaluator (who may be the
 *   client itself) marks Completed or Rejected. No premium, no deposit
 *   requirement, no cover. This is how the coordination layer settles today,
 *   and jobs settled this way remain fully readable, decodable, and valid
 *   here forever.
 * - ASSURED: the same lifecycle with the assurance hook attached: deposit
 *   outweighs the job, the buyer paid the premium, and completion/rejection
 *   is bound to a verdict recomputed from sealed evidence. The hook refuses
 *   settlements the evidence contradicts; it never invents new states.
 *
 * Nothing about ASSURED invalidates ATTESTED: an attested job and an
 * assured job emit the same events and land in the same terminal states.
 * The difference is what stands behind the ending, and receipts say which.
 */
export type SettlementMode = 'ATTESTED' | 'ASSURED';

export interface SettlementShape {
  /** Hook contract bound to the job, if any. */
  readonly hook?: string;
  /** Deposit locked by the provider, in job-money units. */
  readonly deposit?: bigint;
  /** Premium the client paid for cover, in job-money units. */
  readonly premium?: bigint;
}

/** Refusals, in the SDK's usual register: named, not thrown strings. */
export type ModeRefusal =
  | { readonly ok: true; readonly mode: SettlementMode }
  | { readonly ok: false; readonly code: 'ASSURED_WITHOUT_DEPOSIT' | 'ASSURED_WITHOUT_PREMIUM'; readonly reason: string };

/**
 * Classify a job's settlement mode from its shape. A job with no hook is
 * ATTESTED (the standard default, always valid). A job with a hook must
 * carry both the deposit and the premium, or it is refused by name: an
 * assurance hook without money behind it would be a costume, not cover.
 */
export function settlementModeOf(shape: SettlementShape): ModeRefusal {
  if (!shape.hook) return { ok: true, mode: 'ATTESTED' };
  if (!shape.deposit || shape.deposit <= 0n)
    return { ok: false, code: 'ASSURED_WITHOUT_DEPOSIT', reason: 'a hook-bound job must lock a provider deposit' };
  if (!shape.premium || shape.premium <= 0n)
    return { ok: false, code: 'ASSURED_WITHOUT_PREMIUM', reason: 'a hook-bound job must carry the buyer-paid premium' };
  return { ok: true, mode: 'ASSURED' };
}

/* ── The hook seam ──────────────────────────────────────────────────────── */

/**
 * The standard's extension point: IACPHook, called before/after each core
 * function. The assurance layer binds here. This constant names the
 * functions the draft marks hookable, so the future hook implementation and
 * its tests share one source of truth with the docs.
 */
export const HOOKABLE_CALLS = ['fund', 'submit', 'complete', 'reject'] as const;
