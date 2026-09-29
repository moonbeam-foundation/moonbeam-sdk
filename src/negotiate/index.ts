/**
 * Negotiation — how two agents that have never met arrive at terms.
 *
 * The rest of this SDK starts at `settle()`, which takes `JobTerms` as given.
 * This module is the step before: it is the pure state machine that turns an
 * open intent into terms both sides are bound by, and it exists because the
 * alternative on the floor today is that a buyer simply *names* a worker and
 * funds the job directly. Naming works. It does not discover a price, it does
 * not let an unknown counterparty compete, and it gives neither side a record
 * of what was agreed before the work started.
 *
 * The design rule, and the reason this is not just a message bus: **a bid is an
 * offer to be bound, so it must be checkable before it is accepted.** Every bid
 * that enters this machine is validated against the invariants `settle()` will
 * later assume — the deposit outweighs the job, cover is residual behind that
 * deposit, the pool can actually pay what it promises. A bid that fails is
 * refused by name, at the moment it is made, rather than accepted and then
 * discovered to be unsettleable when money is already locked.
 *
 * That is the whole difference between negotiation and haggling: at the end of
 * this machine you hold terms that the settlement core can already price, and
 * an acceptance digest that neither side can quietly edit afterwards.
 *
 * Pure by construction: no clock, no chain, no I/O. The caller supplies the
 * epoch. Nothing here signs anything or sends anything, so the invariants are
 * properties you can test rather than claims you have to trust.
 */

import type { Money } from '../core/money.js';
import type { JobTerms } from '../core/types.js';
import { min, sum, clampToZero } from '../core/money.js';

/* ── The intent ─────────────────────────────────────────────────────────── */

/**
 * What a buyer publishes when it wants work done and does not yet know by whom.
 *
 * `capabilities` is matched against what an agent published on registration, so
 * discovery and negotiation speak the same vocabulary rather than two.
 */
export interface Intent {
  /** Stable id for this intent. The caller supplies it; this module never invents one. */
  readonly id: string;
  /** What the work is, as a digest. The spec itself lives off-chain. */
  readonly specDigest: string;
  /** What the buyer will accept, as a digest, sealed before any bid arrives. */
  readonly acceptanceDigest: string;
  /** Capabilities a bidder must have published to be eligible. */
  readonly capabilities: readonly string[];
  /** The most the buyer will pay for the work itself, excluding cover. */
  readonly maxPay: Money;
  /** What the buyer stands to lose if the work is bad. Sets the cover a bid must carry. */
  readonly damage: Money;
  /** Epoch after which the intent is no longer open. */
  readonly closesAt: number;
}

/* ── The bid ────────────────────────────────────────────────────────────── */

/**
 * An offer to do the work on stated terms.
 *
 * A bid names its own bond. That is deliberate: the worker, not the buyer,
 * decides how much it is willing to put behind its own reliability, and the
 * floor prices that choice. A bidder that will not outweigh the job it is
 * bidding on is telling you something, and this module makes it say it out loud
 * rather than discovering it at settlement.
 */
export interface Bid {
  readonly intentId: string;
  /** The bidding agent's id, as registered. */
  readonly agent: string;
  /** What it will do the work for. */
  readonly pay: Money;
  /** What it will bond behind that work. */
  readonly deposit: Money;
  /** Capabilities this agent published on registration. */
  readonly capabilities: readonly string[];
  /** Epoch the bid was made. */
  readonly at: number;
}

/**
 * What the cover side offers behind a given bid: the premium it charges and the
 * capital it commits. Supplied by the caller because pricing cover is the
 * pool's business, not this module's.
 */
export interface CoverQuote {
  readonly premium: Money;
  readonly poolCapital: Money;
  readonly evaluatorBond: Money;
}

/* ── Refusals ───────────────────────────────────────────────────────────── */

/**
 * Why a bid cannot be accepted.
 *
 * Typed refusals rather than thrown strings, in the same register the rest of
 * the protocol uses: each names the thing that caused it, so a caller can act
 * on it without a support conversation.
 */
export type RefusalCode =
  | 'INTENT_CLOSED'
  | 'WRONG_INTENT'
  | 'CAPABILITY_MISSING'
  | 'ABOVE_MAX_PAY'
  | 'DEPOSIT_BELOW_JOB'
  | 'COVER_CANNOT_PAY';

export interface Refusal {
  readonly code: RefusalCode;
  /** Plain-language reason, safe to show a person. */
  readonly reason: string;
}

/* ── The machine ────────────────────────────────────────────────────────── */

/** Where an intent is in its life. */
export type NegotiationPhase = 'open' | 'agreed' | 'expired';

export interface Negotiation {
  readonly intent: Intent;
  readonly phase: NegotiationPhase;
  /** Bids that passed validation, in the order they arrived. */
  readonly bids: readonly Bid[];
  /** Bids that were refused, each with its reason. */
  readonly refused: readonly (Refusal & { readonly bid: Bid })[];
  /** The winning bid, once one has been accepted. */
  readonly accepted?: Bid;
}

/** Open an intent for bidding. */
export function open(intent: Intent): Negotiation {
  return { intent, phase: 'open', bids: [], refused: [] };
}

/**
 * Check a bid against the invariants settlement will later assume.
 *
 * Exported on its own so a bidder can check its own bid before making it, and
 * get the same answer the floor will give.
 */
export function checkBid(intent: Intent, bid: Bid, cover: CoverQuote, now: number): Refusal | null {
  if (bid.intentId !== intent.id) {
    return { code: 'WRONG_INTENT', reason: 'This bid names a different intent.' };
  }
  if (now > intent.closesAt) {
    return { code: 'INTENT_CLOSED', reason: 'The intent closed before this bid arrived.' };
  }
  const missing = intent.capabilities.filter((c) => !bid.capabilities.includes(c));
  if (missing.length > 0) {
    return {
      code: 'CAPABILITY_MISSING',
      reason: `The intent asks for ${missing.join(', ')}, which this agent has not published.`,
    };
  }
  if (bid.pay > intent.maxPay) {
    return { code: 'ABOVE_MAX_PAY', reason: 'The bid asks more than the buyer will pay.' };
  }

  /* The deterrence rule, enforced at the moment the offer is made rather than
     discovered at settlement: a worker who cheats must lose more than the job
     pays it, or the arithmetic argues for cheating. */
  if (bid.deposit <= bid.pay) {
    return {
      code: 'DEPOSIT_BELOW_JOB',
      reason: 'The bond must outweigh the job, so that cheating always costs more than it pays.',
    };
  }

  /* Bonds first, pool second: the pool covers only what the bond cannot, and it
     must actually be able to cover that residual. A quote that cannot pay what
     it promises is refused here rather than failing when a buyer needs it. */
  const residual = clampToZero(intent.damage - bid.deposit);
  if (cover.poolCapital < residual) {
    return {
      code: 'COVER_CANNOT_PAY',
      reason: 'Committed cover is smaller than the residual it would have to pay behind this bond.',
    };
  }
  return null;
}

/** Record a bid, or record why it was refused. Never throws. */
export function bid(n: Negotiation, b: Bid, cover: CoverQuote, now: number): Negotiation {
  if (n.phase !== 'open') return n;
  const refusal = checkBid(n.intent, b, cover, now);
  if (refusal) return { ...n, refused: [...n.refused, { ...refusal, bid: b }] };
  return { ...n, bids: [...n.bids, b] };
}

/** Close an intent whose window has passed, with no winner. */
export function expire(n: Negotiation, now: number): Negotiation {
  if (n.phase !== 'open' || now <= n.intent.closesAt) return n;
  return { ...n, phase: 'expired' };
}

/**
 * The cheapest bid that also cleared every check.
 *
 * Cheapest, not "best": ranking on anything softer than price would need a
 * reputation model this layer does not have, and inventing one here would hide
 * a judgement call inside a function that looks like arithmetic. A caller with
 * its own ranking can read `bids` and choose.
 */
export function bestBid(n: Negotiation): Bid | null {
  if (n.bids.length === 0) return null;
  return n.bids.reduce((a, b) => (b.pay < a.pay ? b : a));
}

/**
 * Accept a bid and produce the terms settlement will price.
 *
 * This is the join between the two halves of the SDK: everything before it is
 * discovery and agreement, everything after it is `settle()`. The terms that
 * come out are complete, so no field is filled in later by anybody.
 */
export function accept(
  n: Negotiation,
  winner: Bid,
  cover: CoverQuote,
): { negotiation: Negotiation; terms: JobTerms } | Refusal {
  if (n.phase !== 'open') {
    return { code: 'INTENT_CLOSED', reason: 'This negotiation is no longer open.' };
  }
  if (!n.bids.some((b) => b.agent === winner.agent && b.pay === winner.pay)) {
    return { code: 'WRONG_INTENT', reason: 'That bid is not among the ones that cleared.' };
  }
  const terms: JobTerms = {
    pay: winner.pay,
    premium: cover.premium,
    deposit: winner.deposit,
    evaluatorBond: cover.evaluatorBond,
    poolCapital: cover.poolCapital,
    damage: n.intent.damage,
  };
  return { negotiation: { ...n, phase: 'agreed', accepted: winner }, terms };
}

/**
 * What the buyer locks when the job opens: the work, plus cover.
 *
 * Stated as its parts rather than a total. A single summed figure mixes the
 * purchase with the fee and drifts whenever the illustration does; the parts
 * are what a reader can actually act on.
 */
export function lockedByBuyer(terms: JobTerms): { pay: Money; premium: Money; total: Money } {
  return { pay: terms.pay, premium: terms.premium, total: sum([terms.pay, terms.premium]) };
}

/**
 * How much of `damage` the bond covers, and how much the pool would.
 *
 * The same split `settle()` applies, exposed before anyone commits, so a buyer
 * can see where its cover actually comes from while it still has a choice.
 */
export function coverSplit(terms: JobTerms): { fromDeposit: Money; fromPool: Money } {
  const fromDeposit = min(terms.damage, terms.deposit);
  const fromPool = min(clampToZero(terms.damage - terms.deposit), terms.poolCapital);
  return { fromDeposit, fromPool };
}
