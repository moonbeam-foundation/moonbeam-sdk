/**
 * @taifoon/assurance: the assurance product's core. _ASSURANCE_CORE_v1_
 *
 * ONE file with NO imports, pure and browser-safe, so a project that cannot install this package (the site, the SDKs)
 * carries a byte-identical copy and pins its hash (scripts/sync.mjs). What is in it:
 *
 *   machine    the coordination state machine, generated from schemas/transitions.json: every state, every transition
 *              with its trigger and actor per lane, every timeout, ending and exclusion, the source vocabularies, the money
 *              effects, the external-cover policy machine, and the revenue hooks of schemas/phase-map.json.
 *   next       next(state, event, ctx): one step of a job, from a named transition, a source event or the clock.
 *   endings    endingOf(job): how a job ended, the verdict it writes into the seller's record, and what external cover
 *              does with it; whoCanEnd(state): who may end each held state, and when.
 *   the job    the venue-neutral assured job: price, deposit, cover, evaluator, deadlines, terms.
 *   flows      quote, buy, settle, claim, composed from an Economy the caller passes in (jev-wilson's economy); this file
 *              computes no premium, leg or compensation itself: it picks, checks and refuses.
 *
 * Nothing here reads a network, signs or holds a key. Amounts are bigint smallest units.
 */

// ── GENERATED from schemas/transitions.json and schemas/phase-map.json by scripts/gen.mjs: do not edit ──
export const MACHINE = {
 "version": "coordination.transitions.v1",
 "initial": "Open",
 "lanes": [
  "handshake",
  "hook",
  "erc8183",
  "erc8183-extra",
  "memo-acp"
 ],
 "continues": {
  "handshake": "hook"
 },
 "observedLanes": [
  "olas-mech",
  "grid"
 ],
 "states": [
  {
   "id": "Open",
   "terminal": false,
   "holdsFunds": false,
   "timeout": null
  },
  {
   "id": "Delivered",
   "terminal": false,
   "holdsFunds": false,
   "timeout": null
  },
  {
   "id": "Created",
   "terminal": false,
   "holdsFunds": false,
   "timeout": {
    "after": "expiredAt",
    "to": "Cancelled"
   }
  },
  {
   "id": "Funded",
   "terminal": false,
   "holdsFunds": true,
   "timeout": {
    "after": "expiredAt | hook deadline",
    "to": "Expired"
   }
  },
  {
   "id": "Submitted",
   "terminal": false,
   "holdsFunds": true,
   "timeout": {
    "after": "expiredAt | hook deadline",
    "to": "Expired"
   }
  },
  {
   "id": "Graded",
   "terminal": false,
   "holdsFunds": true,
   "timeout": {
    "after": "hook deadline",
    "to": "Expired"
   }
  },
  {
   "id": "Held",
   "terminal": false,
   "holdsFunds": true,
   "timeout": {
    "after": "hook deadline",
    "to": "Expired"
   }
  },
  {
   "id": "Opened",
   "terminal": false,
   "holdsFunds": true,
   "timeout": {
    "after": "hook deadline",
    "to": "Expired"
   }
  },
  {
   "id": "RejectPending",
   "terminal": false,
   "holdsFunds": true,
   "timeout": {
    "after": "disputeDeadline (RejectProposed field)",
    "to": "Rejected"
   }
  },
  {
   "id": "Disputed",
   "terminal": false,
   "holdsFunds": true,
   "timeout": {
    "after": "arbitrationDeadline (DisputeOpened field)",
    "to": "Rejected"
   }
  },
  {
   "id": "Settled",
   "terminal": true,
   "holdsFunds": false,
   "timeout": null
  },
  {
   "id": "Rejected",
   "terminal": true,
   "holdsFunds": false,
   "timeout": null
  },
  {
   "id": "Expired",
   "terminal": true,
   "holdsFunds": false,
   "timeout": null
  },
  {
   "id": "Cheat",
   "terminal": true,
   "holdsFunds": false,
   "timeout": null
  },
  {
   "id": "Cancelled",
   "terminal": true,
   "holdsFunds": false,
   "timeout": null
  }
 ],
 "transitions": [
  {
   "id": "dispatch_no_work",
   "from": "Open",
   "to": "Open",
   "timeout": null,
   "hook": null,
   "by": {
    "handshake": {
     "type": "offchain",
     "name": "dispatch answered without work",
     "actor": "layer"
    }
   }
  },
  {
   "id": "dispatch_delivered",
   "from": "Open",
   "to": "Delivered",
   "timeout": null,
   "hook": null,
   "by": {
    "handshake": {
     "type": "offchain",
     "name": "reply held with its keccak digest",
     "actor": "seller (answers its own endpoint; the layer holds the reply)"
    }
   }
  },
  {
   "id": "pregrade",
   "from": "Delivered",
   "to": "Delivered",
   "timeout": null,
   "hook": null,
   "by": {
    "handshake": {
     "type": "offchain",
     "name": "RUBRIC_v1 compose on the handshake subject; decision.v2 anchored on JevDecisionLog (36927)",
     "actor": "layer (trial / layer key) or the caller’s TypeSafe credential"
    }
   }
  },
  {
   "id": "fund_offer",
   "from": "Open",
   "to": "Funded",
   "timeout": null,
   "hook": null,
   "by": {
    "hook": {
     "type": "call",
     "name": "JobFunded (+ JobCovered)",
     "actor": "buyer (after the seller approves D and the buyer approves P + π)"
    }
   }
  },
  {
   "id": "fund_delivered",
   "from": "Delivered",
   "to": "Funded",
   "timeout": null,
   "hook": null,
   "by": {
    "hook": {
     "type": "call",
     "name": "JobFunded (+ JobCovered)",
     "actor": "buyer"
    }
   }
  },
  {
   "id": "create",
   "from": "Open",
   "to": "Created",
   "timeout": null,
   "hook": null,
   "by": {
    "erc8183": {
     "type": "event",
     "name": "JobCreated",
     "actor": "client"
    },
    "erc8183-extra": {
     "type": "event",
     "name": "JobCreated",
     "actor": "client"
    },
    "memo-acp": {
     "type": "event",
     "name": "JobCreated (phase 0 REQUEST)",
     "actor": "client"
    }
   }
  },
  {
   "id": "terms",
   "from": "Created",
   "to": "Created",
   "timeout": null,
   "hook": null,
   "by": {
    "erc8183": {
     "type": "event",
     "name": "BudgetSet",
     "actor": "client | provider"
    },
    "erc8183-extra": {
     "type": "event",
     "name": "BudgetSet(uint256,address,uint256) · ProviderSet(uint256,address,uint256)",
     "actor": "client"
    },
    "memo-acp": {
     "type": "event",
     "name": "JobPhaseUpdated 0→1 (NEGOTIATION)",
     "actor": "provider"
    }
   }
  },
  {
   "id": "fund",
   "from": "Created",
   "to": "Funded",
   "timeout": null,
   "hook": null,
   "by": {
    "erc8183": {
     "type": "event",
     "name": "JobFunded",
     "actor": "client"
    },
    "erc8183-extra": {
     "type": "event",
     "name": "JobFunded",
     "actor": "client"
    },
    "memo-acp": {
     "type": "event",
     "name": "JobPhaseUpdated 1→2 (TRANSACTION)",
     "actor": "client"
    }
   }
  },
  {
   "id": "reject_unfunded",
   "from": "Created",
   "to": "Rejected",
   "timeout": null,
   "hook": null,
   "by": {
    "erc8183": {
     "type": "event",
     "name": "JobRejected",
     "actor": "client"
    },
    "erc8183-extra": {
     "type": "event",
     "name": "JobRejected",
     "actor": "client"
    },
    "memo-acp": {
     "type": "event",
     "name": "JobPhaseUpdated 0|1→5 (REJECTED)",
     "actor": "provider | client"
    }
   }
  },
  {
   "id": "lapse",
   "from": "Created",
   "to": "Cancelled",
   "timeout": {
    "after": "expiredAt",
    "default": true
   },
   "hook": null,
   "by": {
    "erc8183": {
     "type": "timeout",
     "name": "expiredAt passed with no JobFunded",
     "actor": "nobody (the observatory derives lapsed_unfunded)"
    },
    "erc8183-extra": {
     "type": "timeout",
     "name": "expiredAt passed with no JobFunded",
     "actor": "nobody"
    },
    "memo-acp": {
     "type": "timeout",
     "name": "expiredAt passed before TRANSACTION",
     "actor": "nobody"
    }
   }
  },
  {
   "id": "expire_unfunded",
   "from": "Created",
   "to": "Expired",
   "timeout": {
    "after": "expiredAt",
    "default": false
   },
   "hook": null,
   "by": {
    "erc8183": {
     "type": "event",
     "name": "JobExpired (no Refunded: nothing was escrowed)",
     "actor": "anyone"
    },
    "erc8183-extra": {
     "type": "event",
     "name": "JobExpired",
     "actor": "anyone"
    },
    "memo-acp": {
     "type": "event",
     "name": "JobPhaseUpdated 0|1→6 (EXPIRED)",
     "actor": "anyone"
    }
   }
  },
  {
   "id": "submit_unfunded",
   "from": "Created",
   "to": "Submitted",
   "timeout": null,
   "hook": null,
   "by": {
    "erc8183": {
     "type": "event",
     "name": "JobSubmitted (+ JobCompleted + PaymentReleased in the same tx when the evaluator is 0x0)",
     "actor": "provider"
    }
   }
  },
  {
   "id": "submit",
   "from": "Funded",
   "to": "Submitted",
   "timeout": null,
   "hook": null,
   "by": {
    "erc8183": {
     "type": "event",
     "name": "JobSubmitted",
     "actor": "provider"
    },
    "erc8183-extra": {
     "type": "event",
     "name": "JobSubmitted",
     "actor": "provider"
    },
    "memo-acp": {
     "type": "event",
     "name": "JobPhaseUpdated 2→3 (EVALUATION)",
     "actor": "provider"
    },
    "hook": {
     "type": "call",
     "name": "Submitted",
     "actor": "seller"
    }
   }
  },
  {
   "id": "reject_undelivered",
   "from": "Funded",
   "to": "Rejected",
   "timeout": null,
   "hook": null,
   "by": {
    "erc8183": {
     "type": "event",
     "name": "JobRejected",
     "actor": "evaluator"
    },
    "erc8183-extra": {
     "type": "event",
     "name": "JobRejected",
     "actor": "evaluator"
    },
    "memo-acp": {
     "type": "event",
     "name": "JobPhaseUpdated 2→5 (REJECTED)",
     "actor": "provider | evaluator"
    }
   }
  },
  {
   "id": "expire_undelivered",
   "from": "Funded",
   "to": "Expired",
   "timeout": {
    "after": "expiredAt | hook deadline",
    "default": true
   },
   "hook": null,
   "by": {
    "erc8183": {
     "type": "event",
     "name": "JobExpired + Refunded",
     "actor": "anyone"
    },
    "erc8183-extra": {
     "type": "event",
     "name": "JobExpired + Refunded",
     "actor": "anyone"
    },
    "memo-acp": {
     "type": "event",
     "name": "JobPhaseUpdated 2→6 (EXPIRED)",
     "actor": "anyone"
    },
    "hook": {
     "type": "call",
     "name": "Expired(jobId, triggeredBy) (+ NoShowCompensated on a V5 hook)",
     "actor": "anyone"
    }
   }
  },
  {
   "id": "complete",
   "from": "Submitted",
   "to": "Settled",
   "timeout": null,
   "hook": null,
   "by": {
    "erc8183": {
     "type": "event",
     "name": "JobCompleted + PaymentReleased (+ EvaluatorFeePaid)",
     "actor": "evaluator (the client itself on 10,927 of 11,052 indexed jobs)"
    },
    "erc8183-extra": {
     "type": "event",
     "name": "PaymentReleased + JobCompleted + Settled",
     "actor": "platform evaluator"
    },
    "memo-acp": {
     "type": "event",
     "name": "JobPhaseUpdated 3→4 (COMPLETED) + USDC to the provider",
     "actor": "evaluator (usually the client)"
    },
    "hook": {
     "type": "call",
     "name": "Completed(jobId, premiumToPool) (+ PremiumSplit on a V5 hook)",
     "actor": "buyer | hook evaluator; a V4 job that names an evaluator: that evaluator only"
    }
   }
  },
  {
   "id": "reject_delivered",
   "from": "Submitted",
   "to": "Rejected",
   "timeout": null,
   "hook": null,
   "by": {
    "erc8183": {
     "type": "event",
     "name": "JobRejected",
     "actor": "evaluator"
    },
    "erc8183-extra": {
     "type": "event",
     "name": "JobRejected",
     "actor": "evaluator"
    },
    "memo-acp": {
     "type": "event",
     "name": "JobPhaseUpdated 3→5 (REJECTED)",
     "actor": "evaluator"
    },
    "hook": {
     "type": "call",
     "name": "Rejected(jobId, verdictDigest)",
     "actor": "buyer | hook evaluator"
    }
   }
  },
  {
   "id": "expire_delivered",
   "from": "Submitted",
   "to": "Expired",
   "timeout": {
    "after": "expiredAt | hook deadline",
    "default": true
   },
   "hook": null,
   "by": {
    "erc8183": {
     "type": "event",
     "name": "JobExpired + Refunded",
     "actor": "anyone"
    },
    "erc8183-extra": {
     "type": "event",
     "name": "JobExpired + Refunded",
     "actor": "anyone"
    },
    "memo-acp": {
     "type": "event",
     "name": "JobPhaseUpdated 3→6 (EXPIRED)",
     "actor": "anyone"
    },
    "hook": {
     "type": "call",
     "name": "Expired(jobId, triggeredBy)",
     "actor": "anyone"
    }
   }
  },
  {
   "id": "cheat",
   "from": "Submitted",
   "to": "Cheat",
   "timeout": null,
   "hook": null,
   "by": {
    "hook": {
     "type": "call",
     "name": "Cheated(jobId, loss, fromDeposit, fromPool)",
     "actor": "arbitrator"
    }
   }
  },
  {
   "id": "cheat_after_reject",
   "from": "Rejected",
   "to": "Cheat",
   "timeout": null,
   "hook": {
    "only": [
     "V1"
    ]
   },
   "by": {
    "hook": {
     "type": "call",
     "name": "Cheated(jobId, loss, fromDeposit, fromPool)",
     "actor": "arbitrator"
    }
   }
  },
  {
   "id": "grade_auto",
   "from": "Submitted",
   "to": "Graded",
   "timeout": null,
   "hook": null,
   "by": {
    "hook": {
     "type": "offchain",
     "name": "RUBRIC_v1 compose → complete | reject (auto), decision.v2 anchored",
     "actor": "layer"
    }
   }
  },
  {
   "id": "hold",
   "from": "Submitted",
   "to": "Held",
   "timeout": null,
   "hook": null,
   "by": {
    "hook": {
     "type": "offchain",
     "name": "RUBRIC_v1 compose → needs_review",
     "actor": "layer"
    }
   }
  },
  {
   "id": "graded_complete",
   "from": "Graded",
   "to": "Settled",
   "timeout": null,
   "hook": null,
   "by": {
    "hook": {
     "type": "call",
     "name": "Completed(jobId, premiumToPool)",
     "actor": "buyer"
    }
   }
  },
  {
   "id": "graded_reject",
   "from": "Graded",
   "to": "Rejected",
   "timeout": null,
   "hook": null,
   "by": {
    "hook": {
     "type": "call",
     "name": "Rejected(jobId, verdictDigest)",
     "actor": "buyer | hook evaluator"
    }
   }
  },
  {
   "id": "graded_expire",
   "from": "Graded",
   "to": "Expired",
   "timeout": {
    "after": "hook deadline",
    "default": true
   },
   "hook": null,
   "by": {
    "hook": {
     "type": "call",
     "name": "Expired(jobId, triggeredBy)",
     "actor": "anyone"
    }
   }
  },
  {
   "id": "graded_cheat",
   "from": "Graded",
   "to": "Cheat",
   "timeout": null,
   "hook": null,
   "by": {
    "hook": {
     "type": "call",
     "name": "Cheated",
     "actor": "arbitrator"
    }
   }
  },
  {
   "id": "held_complete",
   "from": "Held",
   "to": "Settled",
   "timeout": null,
   "hook": null,
   "by": {
    "hook": {
     "type": "call",
     "name": "VerdictPosted + Completed",
     "actor": "registered evaluator (devnet JudgeAdapter today)"
    }
   }
  },
  {
   "id": "held_reject",
   "from": "Held",
   "to": "Rejected",
   "timeout": null,
   "hook": null,
   "by": {
    "hook": {
     "type": "call",
     "name": "VerdictPosted + Rejected",
     "actor": "registered evaluator"
    }
   }
  },
  {
   "id": "held_expire",
   "from": "Held",
   "to": "Expired",
   "timeout": {
    "after": "hook deadline",
    "default": true
   },
   "hook": null,
   "by": {
    "hook": {
     "type": "call",
     "name": "Expired(jobId, triggeredBy)",
     "actor": "anyone"
    }
   }
  },
  {
   "id": "held_cheat",
   "from": "Held",
   "to": "Cheat",
   "timeout": null,
   "hook": null,
   "by": {
    "hook": {
     "type": "call",
     "name": "Cheated",
     "actor": "arbitrator"
    }
   }
  },
  {
   "id": "open_v4",
   "from": "Open",
   "to": "Opened",
   "timeout": null,
   "hook": {
    "since": "V4"
   },
   "by": {
    "hook": {
     "type": "call",
     "name": "JobOpened (+ JobSpecCommitted, X402PaymentReceived)",
     "actor": "buyer"
    }
   }
  },
  {
   "id": "accept_v4",
   "from": "Opened",
   "to": "Funded",
   "timeout": null,
   "hook": {
    "since": "V4"
   },
   "by": {
    "hook": {
     "type": "call",
     "name": "JobAccepted + JobFunded (+ JobCovered)",
     "actor": "seller (locks its deposit)"
    }
   }
  },
  {
   "id": "cancel_open_v4",
   "from": "Opened",
   "to": "Expired",
   "timeout": null,
   "hook": {
    "since": "V4"
   },
   "by": {
    "hook": {
     "type": "call",
     "name": "OpenCancelled + Settled(ending 7)",
     "actor": "buyer"
    }
   }
  },
  {
   "id": "expire_open_v4",
   "from": "Opened",
   "to": "Expired",
   "timeout": {
    "after": "hook deadline",
    "default": true
   },
   "hook": {
    "since": "V4"
   },
   "by": {
    "hook": {
     "type": "call",
     "name": "Settled(ending 2) + Expired(jobId, triggeredBy)",
     "actor": "anyone"
    }
   }
  },
  {
   "id": "propose_reject_v4",
   "from": "Submitted",
   "to": "RejectPending",
   "timeout": null,
   "hook": {
    "since": "V4"
   },
   "by": {
    "hook": {
     "type": "call",
     "name": "RejectProposed(jobId, verdictDigest, disputeDeadline)",
     "actor": "named evaluator | hook evaluator"
    }
   }
  },
  {
   "id": "graded_propose_reject_v4",
   "from": "Graded",
   "to": "RejectPending",
   "timeout": null,
   "hook": {
    "since": "V4"
   },
   "by": {
    "hook": {
     "type": "call",
     "name": "VerdictPosted + RejectProposed",
     "actor": "named evaluator (the fee-forwarding JudgeAdapter)"
    }
   }
  },
  {
   "id": "held_propose_reject_v4",
   "from": "Held",
   "to": "RejectPending",
   "timeout": null,
   "hook": {
    "since": "V4"
   },
   "by": {
    "hook": {
     "type": "call",
     "name": "VerdictPosted + RejectProposed",
     "actor": "named evaluator"
    }
   }
  },
  {
   "id": "finalize_reject_v4",
   "from": "RejectPending",
   "to": "Rejected",
   "timeout": {
    "after": "disputeDeadline",
    "default": true
   },
   "hook": {
    "since": "V4"
   },
   "by": {
    "hook": {
     "type": "call",
     "name": "Rejected + Settled(ending 3) (+ EvaluatorFeePaid)",
     "actor": "anyone"
    }
   }
  },
  {
   "id": "dispute_v4",
   "from": "RejectPending",
   "to": "Disputed",
   "timeout": null,
   "hook": {
    "since": "V4"
   },
   "by": {
    "hook": {
     "type": "call",
     "name": "DisputeOpened(jobId, arbitrationDeadline)",
     "actor": "seller"
    }
   }
  },
  {
   "id": "resolve_seller_v4",
   "from": "Disputed",
   "to": "Settled",
   "timeout": null,
   "hook": {
    "since": "V4"
   },
   "by": {
    "hook": {
     "type": "call",
     "name": "DisputeResolved + Completed + Settled(ending 6)",
     "actor": "arbitrator"
    }
   }
  },
  {
   "id": "resolve_buyer_v4",
   "from": "Disputed",
   "to": "Rejected",
   "timeout": null,
   "hook": {
    "since": "V4"
   },
   "by": {
    "hook": {
     "type": "call",
     "name": "DisputeResolved + Rejected + Settled(ending 3)",
     "actor": "arbitrator"
    }
   }
  },
  {
   "id": "stale_dispute_v4",
   "from": "Disputed",
   "to": "Rejected",
   "timeout": {
    "after": "arbitrationDeadline",
    "default": true
   },
   "hook": {
    "since": "V4"
   },
   "by": {
    "hook": {
     "type": "call",
     "name": "Rejected + Settled(ending 3)",
     "actor": "anyone"
    }
   }
  },
  {
   "id": "auto_complete_v4",
   "from": "Submitted",
   "to": "Settled",
   "timeout": {
    "after": "submittedAt + reviewWindow (V4 job terms)",
    "default": true
   },
   "hook": {
    "since": "V4"
   },
   "by": {
    "hook": {
     "type": "call",
     "name": "AutoCompleted + Completed + Settled(ending 5) (+ EvaluatorFeeRefunded)",
     "actor": "anyone"
    }
   }
  },
  {
   "id": "graded_auto_complete_v4",
   "from": "Graded",
   "to": "Settled",
   "timeout": {
    "after": "submittedAt + reviewWindow (V4 job terms)",
    "default": true
   },
   "hook": {
    "since": "V4"
   },
   "by": {
    "hook": {
     "type": "call",
     "name": "AutoCompleted + Completed + Settled(ending 5) (+ EvaluatorFeeRefunded)",
     "actor": "anyone"
    }
   }
  },
  {
   "id": "held_auto_complete_v4",
   "from": "Held",
   "to": "Settled",
   "timeout": {
    "after": "submittedAt + reviewWindow (V4 job terms)",
    "default": true
   },
   "hook": {
    "since": "V4"
   },
   "by": {
    "hook": {
     "type": "call",
     "name": "AutoCompleted + Completed + Settled(ending 5) (+ EvaluatorFeeRefunded)",
     "actor": "anyone"
    }
   }
  }
 ],
 "endings": [
  {
   "id": "completed",
   "state": "Settled",
   "verdict": "correct",
   "countsInN": true,
   "jevCase": false
  },
  {
   "id": "cheated",
   "state": "Cheat",
   "verdict": "incorrect",
   "countsInN": true,
   "jevCase": false
  },
  {
   "id": "rejected_delivered",
   "state": "Rejected",
   "verdict": "incorrect",
   "countsInN": true,
   "jevCase": true
  },
  {
   "id": "expired_undelivered",
   "state": "Expired",
   "verdict": "incorrect",
   "countsInN": true,
   "jevCase": false
  },
  {
   "id": "expired_delivered",
   "state": "Expired",
   "verdict": "undecided",
   "countsInN": false,
   "jevCase": true
  },
  {
   "id": "rejected_undelivered",
   "state": "Rejected",
   "verdict": "excluded:rejected_before_delivery",
   "countsInN": false,
   "jevCase": false
  },
  {
   "id": "lapsed_unfunded",
   "state": "Cancelled",
   "verdict": "excluded:lapsed_unfunded",
   "countsInN": false,
   "jevCase": false
  },
  {
   "id": "open",
   "state": null,
   "verdict": "excluded:open",
   "countsInN": false,
   "jevCase": false
  }
 ],
 "exclusions": [
  {
   "rule": "budget not > 0 (any ending)",
   "verdict": "excluded:unpaid"
  },
  {
   "rule": "memo-acp or erc8183-extra, expired_undelivered and never funded",
   "verdict": "excluded:expired_unfunded"
  },
  {
   "rule": "memo-acp or erc8183-extra, rejected_undelivered and never funded",
   "verdict": "excluded:rejected_unfunded"
  },
  {
   "rule": "V4 hook job the seller never accepted (JobOpened, no JobFunded), expired or cancelled",
   "verdict": "excluded:expired_unfunded"
  }
 ],
 "maps": {
  "hookState": {
   "0": "Open",
   "1": "Funded",
   "2": "Submitted",
   "3": "Settled",
   "4": "Expired",
   "5": "Rejected",
   "6": "Cheat",
   "7": "Opened",
   "8": "RejectPending",
   "9": "Disputed"
  },
  "memoAcpPhase": {
   "0": "Created",
   "1": "Created",
   "2": "Funded",
   "3": "Submitted",
   "4": "Settled",
   "5": "Rejected",
   "6": "Expired"
  },
  "handshakeState": {
   "OPEN": "Open",
   "NOTIFIED": "Open",
   "PRICED": "Open",
   "OFFERED": "Open",
   "DELIVERED": "Delivered",
   "ACCEPTED": "Funded",
   "PROVED": "Submitted",
   "SETTLED": "Settled",
   "EXPIRED": "Expired",
   "REJECTED": "Rejected",
   "CHEAT": "Cheat"
  },
  "event": {
   "JobCreated": "Created",
   "BudgetSet": "Created",
   "ProviderSet": "Created",
   "JobFunded": "Funded",
   "JobCovered": "Funded",
   "JobSubmitted": "Submitted",
   "Submitted": "Submitted",
   "JobCompleted": "Settled",
   "PaymentReleased": "Settled",
   "Settled": "Settled",
   "Completed": "Settled",
   "JobRejected": "Rejected",
   "Rejected": "Rejected",
   "JobExpired": "Expired",
   "Expired": "Expired",
   "Cheated": "Cheat",
   "Refunded": null,
   "EvaluatorFeePaid": null,
   "JobOpened": "Opened",
   "RejectProposed": "RejectPending",
   "DisputeOpened": "Disputed",
   "OpenCancelled": "Expired"
  },
  "ending": {
   "open": null,
   "lapsed_unfunded": "Cancelled",
   "completed": "Settled",
   "rejected_delivered": "Rejected",
   "rejected_undelivered": "Rejected",
   "expired_delivered": "Expired",
   "expired_undelivered": "Expired",
   "cheated": "Cheat"
  }
 },
 "money": [
  {
   "event": "Encumbered",
   "contract": "pool",
   "money": "reserve",
   "with": [
    "fund_offer",
    "fund_delivered",
    "accept_v4"
   ]
  },
  {
   "event": "JobCoveredCross",
   "contract": "hook",
   "money": "reserve",
   "with": [
    "fund_offer",
    "fund_delivered"
   ]
  },
  {
   "event": "PremiumReceived",
   "contract": "pool",
   "money": "in",
   "with": [
    "complete",
    "graded_complete",
    "held_complete",
    "auto_complete_v4",
    "graded_auto_complete_v4",
    "held_auto_complete_v4",
    "resolve_seller_v4"
   ]
  },
  {
   "event": "RewardPremiumReceived",
   "contract": "pool",
   "money": "in",
   "with": [
    "complete",
    "graded_complete",
    "held_complete",
    "auto_complete_v4",
    "graded_auto_complete_v4",
    "held_auto_complete_v4",
    "resolve_seller_v4"
   ]
  },
  {
   "event": "Released",
   "contract": "pool",
   "money": "release",
   "with": [
    "complete",
    "graded_complete",
    "held_complete",
    "reject_delivered",
    "graded_reject",
    "held_reject",
    "expire_undelivered",
    "expire_delivered",
    "graded_expire",
    "held_expire",
    "cheat",
    "graded_cheat",
    "held_cheat",
    "propose_reject_v4",
    "graded_propose_reject_v4",
    "held_propose_reject_v4",
    "auto_complete_v4",
    "graded_auto_complete_v4",
    "held_auto_complete_v4"
   ]
  },
  {
   "event": "CoverReleaseFailed",
   "contract": "hook",
   "money": "release_failed",
   "with": [
    "complete",
    "graded_complete",
    "held_complete",
    "reject_delivered",
    "graded_reject",
    "held_reject",
    "expire_undelivered",
    "expire_delivered",
    "graded_expire",
    "held_expire",
    "cheat",
    "graded_cheat",
    "held_cheat",
    "propose_reject_v4",
    "graded_propose_reject_v4",
    "held_propose_reject_v4",
    "auto_complete_v4",
    "graded_auto_complete_v4",
    "held_auto_complete_v4"
   ]
  },
  {
   "event": "CoverPaid",
   "contract": "pool",
   "money": "out",
   "with": [
    "cheat",
    "graded_cheat",
    "held_cheat",
    "cheat_after_reject"
   ]
  },
  {
   "event": "CrossCoverPaid",
   "contract": "hook",
   "money": "out",
   "with": [
    "cheat",
    "graded_cheat",
    "held_cheat"
   ]
  },
  {
   "event": "Refunded",
   "contract": "erc8183",
   "money": "out",
   "with": [
    "reject_undelivered",
    "reject_delivered",
    "expire_undelivered",
    "expire_delivered"
   ]
  },
  {
   "event": "EvaluatorFeePaid",
   "contract": "erc8183 · hook (V4)",
   "money": "out",
   "with": [
    "complete",
    "graded_complete",
    "held_complete",
    "finalize_reject_v4",
    "resolve_buyer_v4",
    "stale_dispute_v4"
   ]
  },
  {
   "event": "JobAccepted",
   "contract": "hook",
   "money": "in",
   "with": [
    "accept_v4"
   ]
  },
  {
   "event": "EvaluatorFeeRefunded",
   "contract": "hook",
   "money": "out",
   "with": [
    "complete",
    "graded_complete",
    "held_complete",
    "auto_complete_v4",
    "graded_auto_complete_v4",
    "held_auto_complete_v4",
    "resolve_seller_v4",
    "cancel_open_v4",
    "expire_open_v4",
    "expire_undelivered",
    "cheat",
    "graded_cheat",
    "held_cheat",
    "finalize_reject_v4",
    "resolve_buyer_v4",
    "stale_dispute_v4"
   ]
  },
  {
   "event": "PremiumSplit",
   "contract": "hook",
   "money": "in",
   "with": [
    "complete",
    "graded_complete",
    "held_complete",
    "auto_complete_v4",
    "graded_auto_complete_v4",
    "held_auto_complete_v4",
    "resolve_seller_v4"
   ]
  },
  {
   "event": "NoShowCompensated",
   "contract": "hook",
   "money": "out",
   "with": [
    "expire_undelivered"
   ]
  },
  {
   "event": "RejectionCompensated",
   "contract": "hook",
   "money": "out",
   "with": [
    "finalize_reject_v4",
    "resolve_buyer_v4",
    "stale_dispute_v4"
   ]
  },
  {
   "event": "FeeForwarded",
   "contract": "judge-adapter",
   "money": "out",
   "with": [
    "complete",
    "graded_complete",
    "held_complete",
    "propose_reject_v4",
    "graded_propose_reject_v4",
    "held_propose_reject_v4"
   ]
  },
  {
   "event": "PayableMemoExecuted",
   "contract": "memo-acp",
   "money": "in",
   "with": [
    "fund"
   ]
  },
  {
   "event": "X402PaymentReceived",
   "contract": "memo-acp · hook (V4)",
   "money": "in",
   "with": [
    "fund",
    "open_v4"
   ]
  },
  {
   "event": "ClaimApproved",
   "contract": "erc8183-extra",
   "money": "out",
   "with": [
    "fund_offer",
    "fund_delivered",
    "fund",
    "submit"
   ]
  },
  {
   "event": "ClaimSettled",
   "contract": "erc8183-extra",
   "money": "out",
   "with": [
    "fund_offer",
    "fund_delivered",
    "fund",
    "submit"
   ]
  },
  {
   "event": "Disbursed",
   "contract": "erc8183-extra",
   "money": "out",
   "with": [
    "complete",
    "graded_complete",
    "held_complete",
    "submit"
   ]
  },
  {
   "event": "PlatformFeePaid",
   "contract": "erc8183-extra",
   "money": "out",
   "with": [
    "complete",
    "graded_complete",
    "held_complete",
    "submit"
   ]
  }
 ],
 "cover": {
  "lane": "external-cover",
  "states": [
   {
    "id": "Quoted",
    "terminal": false,
    "holdsFunds": false
   },
   {
    "id": "Active",
    "terminal": false,
    "holdsFunds": true
   },
   {
    "id": "Settled",
    "terminal": true,
    "holdsFunds": false
   },
   {
    "id": "Expired",
    "terminal": true,
    "holdsFunds": false
   }
  ],
  "transitions": [
   {
    "id": "quote",
    "from": null,
    "to": "Quoted",
    "actor": "layer (observer + pricer + attestor)",
    "call": "GET /v1/cover/quote"
   },
   {
    "id": "buy",
    "from": "Quoted",
    "to": "Active",
    "actor": "buyer",
    "call": "buyCover(quote, signatures)"
   },
   {
    "id": "settle",
    "from": "Active",
    "to": "Settled",
    "actor": "anyone (the statement is the authority)",
    "call": "settle(policyId, statement, signatures, proof)"
   },
   {
    "id": "expire",
    "from": "Active",
    "to": "Expired",
    "actor": "anyone",
    "call": "expire(policyId)"
   }
  ],
  "endings": [
   {
    "code": 1,
    "id": "COMPLETED",
    "pays": false,
    "from": [
     "completed"
    ],
    "premium": "pool"
   },
   {
    "code": 2,
    "id": "REFUNDED",
    "pays": false,
    "from": [
     "rejected_undelivered",
     "rejected_delivered",
     "expired_undelivered",
     "expired_delivered"
    ],
    "premium": "pool"
   },
   {
    "code": 3,
    "id": "UNDELIVERED",
    "pays": true,
    "from": [
     "expired_undelivered",
     "rejected_undelivered",
     "completed (no deliverable: an operator force-settle, an x402 call that returned nothing)"
    ],
    "premium": "pool"
   },
   {
    "code": 4,
    "id": "DELIVERED_FINDING",
    "pays": true,
    "from": [
     "cheated",
     "completed",
     "rejected_delivered",
     "expired_delivered"
    ],
    "premium": "pool"
   },
   {
    "code": 5,
    "id": "DELIVERED_NO_FINDING",
    "pays": false,
    "from": [
     "rejected_delivered",
     "expired_delivered",
     "completed"
    ],
    "premium": "pool"
   },
   {
    "code": 6,
    "id": "VOID",
    "pays": false,
    "from": [
     "lapsed_unfunded"
    ],
    "premium": "buyer"
   }
  ]
 },
 "revenueHooks": [
  {
   "hook": "grades_pay_to_key",
   "phase": 1,
   "lane": "a grade past the three free ones (the Jev grade of a hire, a listing or a card)",
   "gate": null
  },
  {
   "hook": "x402_wall",
   "phase": 2,
   "lane": "a paid call to a walled skill, settled by the facilitator to the vault",
   "gate": null
  },
  {
   "hook": "routing_fee",
   "phase": 2,
   "lane": "a gateway call past the free daily allowance (every hire the loop sends through /gw is one)",
   "gate": null
  },
  {
   "hook": "evaluator_fee",
   "phase": 3,
   "lane": "an auto-matched hire settled through the layer: paid when our decision stands",
   "gate": null
  },
  {
   "hook": "resale_fee",
   "phase": 3,
   "lane": "a catalogue buy: the seller's price plus the fee, taken at settlement on the settle line",
   "gate": null
  },
  {
   "hook": "bridge_fee",
   "phase": 3,
   "lane": "a transfer the layer plans between chains for a hire or a caller",
   "gate": null
  },
  {
   "hook": "pool_premium_share",
   "phase": 4,
   "lane": "the premium of a covered hire: the layer's share of the written split",
   "gate": "split"
  },
  {
   "hook": "grid_premium_share",
   "phase": 4,
   "lane": "the layer's leg of a GRID line's premium, paid in GRID on top of a GRID job (GRID jobs, GRID cover, made whole in GRID; opens when GRID can be deposited into pools)",
   "gate": "split"
  },
  {
   "hook": "partner_bond",
   "phase": 5,
   "lane": "an enterprise partner's bond and its members' hires",
   "gate": null
  }
 ]
} as const;
export type State = "Open" | "Delivered" | "Created" | "Funded" | "Submitted" | "Graded" | "Held" | "Opened" | "RejectPending" | "Disputed" | "Settled" | "Rejected" | "Expired" | "Cheat" | "Cancelled";
export type Lane = "handshake" | "hook" | "erc8183" | "erc8183-extra" | "memo-acp";
export type TransitionId = "dispatch_no_work" | "dispatch_delivered" | "pregrade" | "fund_offer" | "fund_delivered" | "create" | "terms" | "fund" | "reject_unfunded" | "lapse" | "expire_unfunded" | "submit_unfunded" | "submit" | "reject_undelivered" | "expire_undelivered" | "complete" | "reject_delivered" | "expire_delivered" | "cheat" | "cheat_after_reject" | "grade_auto" | "hold" | "graded_complete" | "graded_reject" | "graded_expire" | "graded_cheat" | "held_complete" | "held_reject" | "held_expire" | "held_cheat" | "open_v4" | "accept_v4" | "cancel_open_v4" | "expire_open_v4" | "propose_reject_v4" | "graded_propose_reject_v4" | "held_propose_reject_v4" | "finalize_reject_v4" | "dispute_v4" | "resolve_seller_v4" | "resolve_buyer_v4" | "stale_dispute_v4" | "auto_complete_v4" | "graded_auto_complete_v4" | "held_auto_complete_v4";
export type EndingId = "completed" | "cheated" | "rejected_delivered" | "expired_undelivered" | "expired_delivered" | "rejected_undelivered" | "lapsed_unfunded" | "open";
export type CoverEnding = "COMPLETED" | "REFUNDED" | "UNDELIVERED" | "DELIVERED_FINDING" | "DELIVERED_NO_FINDING" | "VOID";
export type RevenueHook = "grades_pay_to_key" | "x402_wall" | "routing_fee" | "evaluator_fee" | "resale_fee" | "bridge_fee" | "pool_premium_share" | "grid_premium_share" | "partner_bond";
// ── END GENERATED ──

// ── the machine ───────────────────────────────────────────────────────────────────────────────────────────────────
type Machine = typeof MACHINE;
type TransitionRow = Machine['transitions'][number];
export type Trigger = { type: 'event' | 'call' | 'offchain' | 'timeout'; name: string | null; actor: string };
export type Transition = { id: TransitionId; from: State; to: State; timeout: { after: string; default: boolean } | null; hook: { only?: readonly string[]; since?: string } | null; by: Partial<Record<Lane, Trigger>> };
/** the hook contract generation a hook-lane job runs on (Moonbeam's live hook is V3; Taifoon's lines are V4, V5 next) */
export type HookVersion = 'V1' | 'V2' | 'V3' | 'V4' | 'V5';
export type Ctx = { lane: Lane; hook?: HookVersion };

export const STATES: readonly State[] = MACHINE.states.map((s) => s.id);
export const TRANSITIONS = MACHINE.transitions as unknown as readonly Transition[];
export const LANES = MACHINE.lanes as unknown as readonly Lane[];
export const ENDINGS = MACHINE.endings;
const row = (s: State) => MACHINE.states.find((r) => r.id === s)!;
export const isState = (s: unknown): s is State => typeof s === 'string' && (STATES as readonly string[]).includes(s);
export const isTerminal = (s: State): boolean => row(s).terminal;
export const holdsFunds = (s: State): boolean => row(s).holdsFunds;

/** a lane and the lane it continues as (a handshake continues as a hook job once funded) */
export function lanesOf(lane: Lane): Lane[] {
  const next = (MACHINE.continues as Record<string, string>)[lane] as Lane | undefined;
  return next ? [lane, next] : [lane];
}
const RANK: Record<HookVersion, number> = { V1: 1, V2: 2, V3: 3, V4: 4, V5: 5 };
/** whether a transition runs where this job runs: V4 transitions need a V4+ hook, the V1 defect only a V1 hook */
export function runsOn(t: Transition, ctx: Ctx): boolean {
  if (!t.hook) return true;
  const v = ctx.hook ?? 'V5';
  if (t.hook.only) return t.hook.only.includes(v);
  return RANK[v] >= RANK[t.hook.since as HookVersion];
}
/** the trigger of a transition on this lane (or the lane it continues as), or null when the lane does not walk it */
export function triggerOf(t: Transition, lane: Lane): Trigger | null {
  for (const l of lanesOf(lane)) { const b = t.by[l]; if (b) return b; }
  return null;
}
/** every transition out of a state that this lane walks here */
export const exits = (from: State, ctx: Ctx): Transition[] => TRANSITIONS.filter((t) => t.from === from && triggerOf(t, ctx.lane) !== null && runsOn(t, ctx));
/** the states a lane can reach from the initial state, breadth first */
export function reachable(ctx: Ctx): State[] {
  const seen: State[] = [MACHINE.initial as State]; const q = [...seen];
  while (q.length) { const s = q.shift()!; for (const t of exits(s, ctx)) if (!seen.includes(t.to)) { seen.push(t.to); q.push(t.to); } }
  return seen;
}

// ── the clock: every timeout names the deadline it waits for ────────────────────────────────────────────────────────
/** the job's deadlines in unix seconds; a missing one never fires */
export type Clock = { expiredAt?: number; deadline?: number; reviewEnds?: number; disputeDeadline?: number; arbitrationDeadline?: number };
/** the clock fields a timeout's `after` names (transitions.json wording: "expiredAt | hook deadline", "submittedAt + reviewWindow …") */
export function clockKeys(after: string): (keyof Clock)[] {
  const k: (keyof Clock)[] = [];
  if (/expiredAt/.test(after)) k.push('expiredAt');
  if (/hook deadline/.test(after)) k.push('deadline');
  if (/reviewWindow/.test(after)) k.push('reviewEnds');
  if (/disputeDeadline/.test(after)) k.push('disputeDeadline');
  if (/arbitrationDeadline/.test(after)) k.push('arbitrationDeadline');
  return k;
}
/** when a timed transition becomes possible on this clock: the earliest deadline it names that is set, or null */
export function dueAt(t: Transition, clock: Clock): number | null {
  if (!t.timeout) return null;
  const at = clockKeys(t.timeout.after).map((k) => clock[k]).filter((x): x is number => typeof x === 'number');
  return at.length ? Math.min(...at) : null;
}

// ── next ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * What happened to a job:
 *   transition  a named transition (what a plan or a contract call says it does)
 *   event       an event a venue emitted, in transitions.json's vocabulary (JobFunded, RejectProposed …); an effect that
 *               decides no state (Refunded, EvaluatorFeePaid) leaves the state as it is
 *   state       a source that reports the state itself (memo-ACP's phase, the hook's State enum, a handshake state)
 *   tick        time passed: the default timeout transition whose deadline came first fires
 */
export type AssuranceEvent =
  | { kind: 'transition'; id: TransitionId }
  | { kind: 'event'; name: string; via?: TransitionId }
  | { kind: 'state'; to: State; via?: TransitionId }
  | { kind: 'tick'; now: number; clock: Clock };
export type Next =
  | { ok: true; state: State; transition: TransitionId | null; trigger: Trigger | null; effect?: string }
  | { ok: false; state: State; error: string };

export function next(state: State, ev: AssuranceEvent, ctx: Ctx): Next {
  if (!isState(state)) return { ok: false, state, error: `unknown state ${String(state)}` };
  if (ev.kind === 'transition') {
    const t = TRANSITIONS.find((x) => x.id === ev.id);
    if (!t) return { ok: false, state, error: `unknown transition ${ev.id}` };
    if (t.from !== state) return { ok: false, state, error: `${ev.id} leaves ${t.from}, the job is ${state}` };
    const trig = triggerOf(t, ctx.lane);
    if (!trig) return { ok: false, state, error: `${ev.id} is not a ${ctx.lane} transition` };
    if (!runsOn(t, ctx)) return { ok: false, state, error: `${ev.id} does not run on a ${ctx.hook ?? 'V5'} hook` };
    return { ok: true, state: t.to, transition: t.id, trigger: trig };
  }
  if (ev.kind === 'event' || ev.kind === 'state') {
    let to: State | null; let label: string;
    if (ev.kind === 'state') {
      if (!isState(ev.to)) return { ok: false, state, error: `unknown state ${String(ev.to)}` };
      to = ev.to; label = `state ${ev.to}`;
    } else {
      const ev2s = MACHINE.maps.event as Record<string, string | null>;
      if (!Object.prototype.hasOwnProperty.call(ev2s, ev.name)) return { ok: false, state, error: `${ev.name} is not an event of the machine` };
      to = ev2s[ev.name] as State | null; label = ev.name;
      if (to === null) return { ok: true, state, transition: null, trigger: null, effect: ev.name };
    }
    const cands = exits(state, ctx).filter((t) => t.to === to && (!ev.via || t.id === ev.via));
    if (cands.length) return { ok: true, state: to, transition: cands[0]!.id, trigger: triggerOf(cands[0]!, ctx.lane) };
    // several logs of one step (JobFunded + JobCovered, JobCompleted + PaymentReleased) repeat the state: no change
    if (to === state) return { ok: true, state, transition: null, trigger: null };
    if (isTerminal(state)) return { ok: false, state, error: `${state} is terminal; ${label} cannot follow it` };
    return { ok: false, state, error: `no ${ctx.lane} transition ${state} → ${to} (${label})` };
  }
  const due = exits(state, ctx)
    .filter((t) => t.timeout?.default)
    .map((t) => ({ t, at: dueAt(t, ev.clock) }))
    .filter((x): x is { t: Transition; at: number } => x.at !== null && x.at <= ev.now)
    .sort((a, b) => a.at - b.at);
  if (!due.length) return { ok: true, state, transition: null, trigger: null };
  const t = due[0]!.t;
  return { ok: true, state: t.to, transition: t.id, trigger: triggerOf(t, ctx.lane) };
}

/** source vocabularies → machine states (transitions.json maps) */
export const stateOf = {
  /** the hook's State enum: None Funded Submitted Completed Expired Rejected Cheated, then V4 Open RejectPending Disputed */
  hook: (n: number): State | null => ((MACHINE.maps.hookState as Record<string, string>)[String(n)] as State | undefined) ?? null,
  /** memo-ACP JobManager phase 0..6 */
  memoPhase: (n: number): State | null => ((MACHINE.maps.memoAcpPhase as Record<string, string>)[String(n)] as State | undefined) ?? null,
  /** a handshake state; OFFERED with a held delivery is Delivered */
  handshake: (s: string, delivered = false): State | null => {
    const v = ((MACHINE.maps.handshakeState as Record<string, string>)[s] as State | undefined) ?? null;
    return v === 'Open' && delivered ? 'Delivered' : v;
  },
};

export type PathStep = { from: State; to: State; transition: TransitionId };
/** fold events from a start state; stops at the first refusal and says where */
export function run(events: AssuranceEvent[], ctx: Ctx, start: State = MACHINE.initial as State):
  { ok: true; state: State; path: PathStep[] } | { ok: false; state: State; path: PathStep[]; at: number; error: string } {
  let s = start; const path: PathStep[] = [];
  for (let i = 0; i < events.length; i++) {
    const r = next(s, events[i]!, ctx);
    if (!r.ok) return { ok: false, state: s, path, at: i, error: r.error };
    if (r.transition) path.push({ from: s, to: r.state, transition: r.transition });
    s = r.state;
  }
  return { ok: true, state: s, path };
}

// ── who can end a held state, and when ──────────────────────────────────────────────────────────────────────────────
export type Exit = { transition: TransitionId; to: State; actor: string; trigger: Trigger['type']; after: string | null; isDefault: boolean };
/** every way out of a state on this lane: who acts, and the deadline a timed exit waits for */
export function whoCanEnd(state: State, ctx: Ctx): Exit[] {
  return exits(state, ctx).filter((t) => t.to !== state).map((t) => {
    const trig = triggerOf(t, ctx.lane)!;
    return { transition: t.id, to: t.to, actor: trig.actor, trigger: trig.type, after: t.timeout?.after ?? null, isDefault: !!t.timeout?.default };
  });
}
/** no lockout: a held state has an exit nobody can block (a timeout, or a call anyone may send) */
export function unblockable(state: State, ctx: Ctx): Exit | null {
  return whoCanEnd(state, ctx).find((e) => e.after !== null && (e.trigger === 'timeout' || /\banyone\b|\bnobody\b/.test(e.actor))) ?? null;
}

// ── the assured job, venue-neutral ──────────────────────────────────────────────────────────────────────────────────
export type Token = { symbol: string; decimals: number };
/** where the layer attaches assurance to a venue's job */
export type Attachment = 'hook' | 'external-cover' | 'none';
export type Compensation = { noShow: bigint; rejection: bigint };
/** the terms a buyer and seller agree before any money moves; every number comes from the Economy (jev-wilson) */
export type Terms = {
  token: Token; price: bigint; premium: bigint; backersLeg: bigint; layerLeg: bigint; jobFee: bigint;
  deposit: bigint; cover: bigint; compensation: Compensation; attachment: Attachment; lockSeconds: number;
};
export type AssuredJob = {
  venue: string; ctx: Ctx; chainId: number; jobId: string;
  buyer: string; seller: string; evaluator: string | null;
  terms: Terms | null; clock: Clock; state: State; path: PathStep[];
  /** the venue paid something (budget > 0): an unpaid job is excluded from every record */
  paid?: boolean;
  /** an arbitrator's finding against the delivery (a grade is not a finding) */
  finding?: string | null;
};

// ── endings ────────────────────────────────────────────────────────────────────────────────────────────────────────
const DELIVERED_STATES: readonly State[] = ['Submitted', 'Graded', 'Held', 'RejectPending', 'Disputed'] as State[];
/** the job reached the seller's delivery (a JobSubmitted, or a later state that needs one) */
export const deliveredOf = (job: Pick<AssuredJob, 'path' | 'state'>): boolean => DELIVERED_STATES.includes(job.state) || job.path.some((p) => DELIVERED_STATES.includes(p.to));
/** money was held at some point (the job was funded) */
export const fundedOf = (job: Pick<AssuredJob, 'path' | 'state'>): boolean => holdsFunds(job.state) || job.path.some((p) => holdsFunds(p.to) && p.to !== 'Opened');
export type Ending = { id: EndingId; state: State | null; verdict: string; countsInN: boolean; jevCase: boolean; excluded: string | null };

/** how a job ended and the verdict it writes into the seller's record (transitions.json endings + exclusions) */
export function endingOf(job: Pick<AssuredJob, 'path' | 'state' | 'ctx' | 'paid'>): Ending {
  const delivered = deliveredOf(job); const funded = fundedOf(job);
  let id: EndingId;
  switch (job.state) {
    case 'Settled': id = 'completed'; break;
    case 'Cheat': id = 'cheated'; break;
    case 'Rejected': id = delivered ? 'rejected_delivered' : 'rejected_undelivered'; break;
    case 'Expired': id = delivered ? 'expired_delivered' : 'expired_undelivered'; break;
    case 'Cancelled': id = 'lapsed_unfunded'; break;
    default: id = 'open';
  }
  const e = ENDINGS.find((x) => x.id === id)!;
  let excluded: string | null = e.verdict.startsWith('excluded:') ? e.verdict : null;
  const lane = job.ctx.lane;
  if (job.paid === false) excluded = 'excluded:unpaid';
  else if (!funded && (lane === 'memo-acp' || lane === 'erc8183-extra') && id === 'expired_undelivered') excluded = 'excluded:expired_unfunded';
  else if (!funded && (lane === 'memo-acp' || lane === 'erc8183-extra') && id === 'rejected_undelivered') excluded = 'excluded:rejected_unfunded';
  else if (!funded && lanesOf(lane).includes('hook') && job.path.some((p) => p.from === 'Opened') && id === 'expired_undelivered') excluded = 'excluded:expired_unfunded';
  return { id, state: e.state as State | null, verdict: excluded ?? e.verdict, countsInN: excluded ? false : e.countsInN, jevCase: e.jevCase, excluded };
}

/** what external cover does with an ending (transitions.json external_cover.endings): the policy's ending code */
export function coverEndingOf(ending: EndingId, o: { price: bigint; refunded: bigint; refundable: bigint; finding?: string | null; deliveredSomething?: boolean; sameParty?: boolean }):
  { id: CoverEnding; code: number; pays: boolean; premium: string } {
  const pick = (id: CoverEnding) => { const c = MACHINE.cover.endings.find((x) => x.id === id)!; return { id, code: c.code, pays: c.pays, premium: c.premium }; };
  if (o.sameParty || ending === 'lapsed_unfunded' || ending === 'open') return pick('VOID');
  if (o.refunded + o.refundable >= o.price && ending !== 'completed') return pick('REFUNDED');
  if (o.finding && ending !== 'expired_undelivered' && ending !== 'rejected_undelivered') return pick('DELIVERED_FINDING');
  if (ending === 'cheated') return pick('DELIVERED_FINDING');
  if (ending === 'expired_undelivered' || ending === 'rejected_undelivered') return pick('UNDELIVERED');
  if (ending === 'completed') return o.deliveredSomething === false ? pick('UNDELIVERED') : pick('COMPLETED');
  return pick('DELIVERED_NO_FINDING');
}

// ── the economy: a port, filled by jev-wilson ───────────────────────────────────────────────────────────────────────
/** the seller's settled record (correct and incorrect endings that count in n) */
export type SellerRecord = { correct: number; incorrect: number };
export type EconomyInput = { chainId: number; token: Token; price: bigint; record: SellerRecord | null; lockSeconds: number; cover?: bigint; attachment: Attachment };
/** where the money of one ending goes; the sum equals what the job held */
export type Legs = { buyer: bigint; seller: bigint; backers: bigint; layer: bigint; evaluator: bigint };
/** the money endings a quote prices (a pool's loss on a cheat is bounded by the cover, the deposit pays first) */
export type MoneyEnding = 'completed' | 'auto_completed' | 'rejected' | 'no_show' | 'expired_delivered' | 'unaccepted' | 'cheated';
export type EconomyQuote = {
  insurable: boolean; why: string[];
  premium: bigint; backersLeg: bigint; layerLeg: bigint; jobFee: bigint; deposit: bigint; cover: bigint;
  compensation: Compensation;
  /** per money ending, who receives what (the hook's own arithmetic, from the same module) */
  legs: Partial<Record<MoneyEnding, Legs>>;
};
/** jev-wilson's economy (quoteEconomy), or a stand-in in tests: the only place any of these numbers is computed */
export type Economy = (i: EconomyInput) => EconomyQuote;

// ── flows ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export type Refused = { ok: false; why: string[] };
const sum = (l: Legs) => l.buyer + l.seller + l.backers + l.layer + l.evaluator;

/** quote: the economy's terms, checked against the rules the contracts enforce; refusal over a term the chain would revert */
export function quote(i: EconomyInput, economy: Economy): { ok: true; terms: Terms; quote: EconomyQuote } | Refused {
  if (i.price <= 0n) return { ok: false, why: ['the price must be above zero'] };
  const q = economy(i);
  const why = [...q.why];
  if (!q.insurable) return { ok: false, why: why.length ? why : ['the seller is not insurable on this record'] };
  if (q.premium !== q.backersLeg + q.layerLeg) why.push(`the premium ${q.premium} is not the backers' leg ${q.backersLeg} plus the layer's leg ${q.layerLeg}`);
  if (q.layerLeg < q.jobFee) why.push(`the layer's leg ${q.layerLeg} is below the job fee ${q.jobFee}: the layer would work at a loss`);
  if (q.backersLeg < 0n) why.push('the backers\' leg is negative');
  if (i.attachment === 'hook' && q.deposit <= i.price) why.push(`the hook needs a deposit above the price (${q.deposit} ≤ ${i.price})`);
  if (q.compensation.noShow > q.deposit || q.compensation.rejection > q.deposit) why.push('a compensation is larger than the deposit it comes from');
  // external cover never pays more than the price; a hook line may cover a multiple of it (the economy's cover multiple)
  if (i.attachment === 'external-cover' && q.cover > i.price) why.push('external cover is larger than the price');
  for (const [end, l] of Object.entries(q.legs) as [MoneyEnding, Legs][]) {
    const held = heldFor(end, i.price, q);
    if (sum(l) !== held) why.push(`${end}: the legs pay ${sum(l)}, the job holds ${held}`);
    if (Object.values(l).some((x) => x < 0n)) why.push(`${end}: a negative leg`);
  }
  if (why.length) return { ok: false, why };
  return { ok: true, quote: q, terms: { token: i.token, price: i.price, premium: q.premium, backersLeg: q.backersLeg, layerLeg: q.layerLeg, jobFee: q.jobFee, deposit: q.deposit, cover: q.cover, compensation: q.compensation, attachment: i.attachment, lockSeconds: i.lockSeconds } };
}
/** what the job holds at an ending: the buyer's price, premium and fee, and the seller's deposit once it accepted.
 *  A cheat's pool payout comes from outside the job (the pool), so it is added to what the legs may pay. */
function heldFor(end: MoneyEnding, price: bigint, q: Pick<EconomyQuote, 'premium' | 'jobFee' | 'deposit' | 'cover'>): bigint {
  const buyer = price + q.premium + q.jobFee;
  if (end === 'unaccepted') return buyer;
  return buyer + q.deposit + (end === 'cheated' ? q.cover : 0n);
}

/** buy: an assured job at its first held state, with the terms committed (no money moves here: the plan does) */
export function buy(job: Omit<AssuredJob, 'state' | 'path' | 'terms'>, terms: Terms, opts: { open?: boolean } = {}): { ok: true; job: AssuredJob; transition: TransitionId } | Refused {
  if (job.buyer.toLowerCase() === job.seller.toLowerCase()) return { ok: false, why: ['the buyer is the seller'] };
  if (terms.attachment === 'none') return { ok: false, why: ['this venue has no assurance attachment'] };
  const lane = job.ctx.lane;
  const id: TransitionId = lanesOf(lane).includes('hook')
    ? (opts.open && runsOn(TRANSITIONS.find((t) => t.id === 'open_v4')!, job.ctx) ? 'open_v4' : 'fund_offer')
    : 'fund';
  const start: State = id === 'fund' ? 'Created' : 'Open';
  const r = next(start, { kind: 'transition', id }, { ...job.ctx, lane: lanesOf(lane).includes('hook') ? 'hook' : lane });
  if (!r.ok) return { ok: false, why: [r.error] };
  return { ok: true, transition: id, job: { ...job, terms, state: r.state, path: [{ from: start, to: r.state, transition: id }] } };
}

/** the money ending of a terminal job: which legs of the quote apply */
export function moneyEndingOf(job: Pick<AssuredJob, 'path' | 'state' | 'ctx'>): MoneyEnding | null {
  const last = job.path.at(-1)?.transition ?? null;
  const e = endingOf({ ...job, paid: true });
  if (e.id === 'expired_undelivered' && job.path.some((p) => p.from === 'Opened') && !fundedOf(job)) return 'unaccepted';
  if (!fundedOf(job)) return null;
  switch (e.id) {
    case 'completed': return last && /auto_complete/.test(last) ? 'auto_completed' : 'completed';
    case 'cheated': return 'cheated';
    case 'rejected_delivered': case 'rejected_undelivered': return 'rejected';
    case 'expired_delivered': return 'expired_delivered';
    case 'expired_undelivered': return 'no_show';
    default: return null;
  }
}

/** settle: who receives what at this job's ending, from the committed quote; refused while the job is still open */
export function settle(job: AssuredJob, q: EconomyQuote): { ok: true; ending: Ending; money: MoneyEnding; legs: Legs } | Refused {
  if (!isTerminal(job.state)) return { ok: false, why: [`the job is ${job.state}: not ended`, ...whoCanEnd(job.state, job.ctx).map((e) => `${e.transition}: ${e.actor}${e.after ? ` after ${e.after}` : ''}`)] };
  const money = moneyEndingOf(job);
  if (!money) return { ok: false, why: ['this ending moves no assured money (lapsed or unfunded)'] };
  const legs = q.legs[money];
  if (!legs) return { ok: false, why: [`the economy priced no ${money} ending`] };
  return { ok: true, ending: endingOf(job), money, legs };
}

/** claim: what each party may take out once the job settled (non-zero legs only) */
export function claim(job: AssuredJob, q: EconomyQuote): { ok: true; claims: { who: keyof Legs; amount: bigint }[] } | Refused {
  const s = settle(job, q);
  if (!s.ok) return s;
  return { ok: true, claims: (Object.entries(s.legs) as [keyof Legs, bigint][]).filter(([, v]) => v > 0n).map(([who, amount]) => ({ who, amount })) };
}

/** the revenue hooks (phase-map) a venue's assurance earns through, with their phase and gate */
export const revenueOf = (hooks: readonly RevenueHook[]) => MACHINE.revenueHooks.filter((r) => (hooks as readonly string[]).includes(r.hook));

// ── attest.ts (profile moonbeam): src/attest.ts, import lines removed by scripts/sync.mjs ──
/**
 * attest: the attested mark, the on-chain attestation and the stamp of one step (a grade, an assurance settle, a resale
 * step), as UNSIGNED calls aimed at a default network chosen by profile. _ATTEST_BY_DEFAULT_v1_
 *
 * ONE file with NO imports, pure and browser-safe, like assurance.ts: @taifoon/jev, @taifoon/assurance (and through its
 * sync, taifoon-sdk and moonbeam-sdk) carry a byte-identical copy and pin its hash. The addresses come from the address
 * registry (packages/addresses) through scripts/gen-attest.mjs; nothing below the generated block names an address.
 *
 *   mark          what is attested, offline: the step's kind, the subject ids (decision log + stamp registry) and the
 *                 digest = keccak256 of the canonical JSON body (or the digest the caller already has, e.g. Jev's).
 *   attestation   JevDecisionLog.record(subject, kind, digest, confidenceBps, model, uri) on every target network, after
 *                 JevAnswerLog.record(...) when the step carries Jev's answers.
 *   stamp         GradeStampRegistry.stamp(subject, digest, verdict, mode, model, uri) when the step has a verdict.
 *
 * Recording is ON by default (the owner's rule of 2026-10-14): profile taifoon → the Taifoon devnet 36927 and the Taifoon
 * mainnet 3692781 (GRID); profile moonbeam → Base 8453. Any network can be named instead; `networks: 'none'` opts out
 * (the mark is still returned). A contract the registry does not have on a target network is listed in `missing`, with
 * no call: nothing is faked. Nothing here signs or sends; the caller signs the calls.
 */

// ── GENERATED from packages/addresses/addresses.json by scripts/gen-attest.mjs: do not edit ──
/** The attestation contracts on every chain the address registry has one on (superseded deploys left out). */
export const ATTEST_TARGETS: Readonly<Record<number, { name: string; decisionLog: string | null; answerLog: string | null; stampRegistry: string | null }>> = {
  143: { name: 'Monad', decisionLog: '0x1aC6266b9926cB3E206D5dc0c9d1B7c873aa150a', answerLog: '0x29fEEc116e0CAbbaf38e9EBF2BBf65d82D672104', stampRegistry: null },
  5042: { name: 'Arc', decisionLog: '0x863db7dAc69CC614a98822082cbe884F1f3b55cA', answerLog: '0x45214361A8cADb8aEe6302cd5653E119E5a89839', stampRegistry: null },
  8453: { name: 'Base', decisionLog: '0x209490d6A0FFC5368A42b0c2208BDCda853f6a92', answerLog: '0x8e9B9cE86a2d55c10318607b0c815B7B8C66254d', stampRegistry: null },
  36927: { name: 'Taifoon devnet', decisionLog: '0x1D622511862DD7DEffB8fEeBc225E0FAdA1e9A05', answerLog: '0xD8c1d8188Fc8EE388792f6EB3B3dbd4f341Ba8e3', stampRegistry: '0xff5B4852AC7066D04FEd8de97bdA52401d03ad6E' },
  42161: { name: 'Arbitrum One', decisionLog: '0x1aC6266b9926cB3E206D5dc0c9d1B7c873aa150a', answerLog: '0x29fEEc116e0CAbbaf38e9EBF2BBf65d82D672104', stampRegistry: null },
  3692781: { name: 'Taifoon mainnet', decisionLog: null, answerLog: null, stampRegistry: null },
};
// ── END GENERATED ──

/** The default networks per profile. Taifoon: its devnet and its mainnet (GRID). Moonbeam: Base only. */
export const ATTEST_PROFILES = { taifoon: [36927, 3692781], moonbeam: [8453] } as const;
export type AttestProfile = keyof typeof ATTEST_PROFILES;

export type AttestHex = `0x${string}`;
export type AttestCall = { chainId: number; to: string; data: AttestHex; value: '0'; fn: 'JevDecisionLog.record' | 'JevAnswerLog.record' | 'GradeStampRegistry.stamp' };
export type AttestMissing = { chainId: number; network: string; contract: 'JevDecisionLog' | 'JevAnswerLog' | 'GradeStampRegistry'; why: string };
/** the REF verdict vocabulary of GradeStampRegistry: 1 delivered as specified · 2 with defects · 3 not delivered · 4 cannot determine */
export type StampVerdict = 1 | 2 | 3 | 4;
export type AttestInput = {
  /** the step: 'grade', 'assurance.settle', 'resale.<hop>' … (the decision log's kind is keccak256 of it) */
  kind: string;
  /** the job the step is about, on its own chain and contract */
  subject: { chainId: number; contract: string; jobId: string | number | bigint };
  /** the canonical body of the step; its keccak256 is the digest unless `digest` is given */
  body?: unknown | undefined;
  digest?: AttestHex | undefined;
  /** 0..10000; default 10000 (a deterministic step) */
  confidenceBps?: number | undefined;
  /** ≤ 64 bytes, e.g. 'jev-1.13.0' or 'det:assurance-settle-v1' */
  model: string;
  /** ≤ 512 bytes; default urn:taifoon:<kind>:<digest> */
  uri?: string | undefined;
  /** a stamp is built when there is a verdict; mode 1 deterministic (default) · 2 calibrated */
  verdict?: StampVerdict | null | undefined;
  mode?: 1 | 2 | undefined;
  /** Jev's answer record digests: adds JevAnswerLog.record */
  answers?: { useCase: string; inputDigest: AttestHex; answersDigest: AttestHex; uri?: string | undefined } | undefined;
};
export type AttestOptions = {
  /** picks the default networks; default 'taifoon' */
  profile?: AttestProfile | undefined;
  /** overrides the profile: chain ids, or 'none' to opt out of recording (the mark is still returned) */
  networks?: readonly number[] | 'none' | undefined;
  /** extra or replacement contracts per chain (e.g. a fork's deploy, or a network the registry does not list) */
  targets?: Readonly<Record<number, Partial<{ name: string; decisionLog: string | null; answerLog: string | null; stampRegistry: string | null }>>> | undefined;
};
export type Attested = {
  mark: { kind: string; kindId: AttestHex; subject: AttestHex; stampSubject: AttestHex; digest: AttestHex; confidenceBps: number; verdict: StampVerdict | null; model: string; uri: string };
  /** false only when the caller opted out */
  recorded: boolean;
  networks: number[];
  calls: AttestCall[];
  missing: AttestMissing[];
  /** ready: every target contract exists · partial: some are missing · missing: none exist · none: opted out */
  status: 'ready' | 'partial' | 'missing' | 'none';
};

// ── keccak256 (the same code as packages/addresses/keccak.mjs; test/attest.test.ts checks known vectors) ──
const KM = (1n << 64n) - 1n;
const KRC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const KR = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const krot = (v: bigint, n: number) => (n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & KM);
function kf(A: bigint[]) {
  const C: bigint[] = [0n, 0n, 0n, 0n, 0n]; const B: bigint[] = new Array<bigint>(25).fill(0n);
  const at = (a: bigint[], i: number) => a[i] as bigint;
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) C[x] = at(A, x) ^ at(A, x + 5) ^ at(A, x + 10) ^ at(A, x + 15) ^ at(A, x + 20);
    for (let x = 0; x < 5; x++) { const d = at(C, (x + 4) % 5) ^ krot(at(C, (x + 1) % 5), 1); for (let y = 0; y < 25; y += 5) A[x + y] = at(A, x + y) ^ d; }
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = krot(at(A, x + 5 * y), KR[x + 5 * y] as number);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) A[x + 5 * y] = at(B, x + 5 * y) ^ (~at(B, (x + 1) % 5 + 5 * y) & KM & at(B, (x + 2) % 5 + 5 * y));
    A[0] = at(A, 0) ^ (KRC[round] as bigint);
  }
}
/** UTF-8 bytes of a string (no TextEncoder: the file runs where no DOM or Node lib is typed) */
function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}
export function attestKeccak(input: Uint8Array | string): AttestHex {
  const bytes = typeof input === 'string' ? utf8(input) : input;
  const rate = 136; const A: bigint[] = new Array<bigint>(25).fill(0n);
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  padded.set(bytes); padded[bytes.length] = (padded[bytes.length] as number) ^ 0x01; padded[padded.length - 1] = (padded[padded.length - 1] as number) ^ 0x80;
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) { let w = 0n; for (let b = 7; b >= 0; b--) w = (w << 8n) | BigInt(padded[off + i * 8 + b] as number); A[i] = (A[i] as bigint) ^ w; }
    kf(A);
  }
  let out = '0x';
  for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) out += Number(((A[i] as bigint) >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, '0');
  return out as AttestHex;
}

// ── ABI encoding (only the types these three calls use) ──
const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const bytesOf = (h: string) => { const s = h.replace(/^0x/, ''); const o = new Uint8Array(s.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16); return o; };
const word = (n: bigint) => { if (n < 0n || n >= 1n << 256n) throw new Error(`attest: ${n} does not fit a uint256`); return n.toString(16).padStart(64, '0'); };
const isHex32 = (v: string) => /^0x[0-9a-fA-F]{64}$/.test(v);
const isAddr = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v);
type AbiArg = { t: 'bytes32' | 'address' | 'uint' | 'string'; v: string | bigint | number };
function encodeArgs(args: AbiArg[]): string {
  let head = ''; let tail = ''; const headLen = args.length * 32;
  for (const a of args) {
    if (a.t === 'string') {
      const b = utf8(String(a.v)); head += word(BigInt(headLen + tail.length / 2));
      tail += word(BigInt(b.length)) + hexOf(b).padEnd(Math.ceil(b.length / 32) * 64, '0');
    } else if (a.t === 'bytes32') { if (!isHex32(String(a.v))) throw new Error(`attest: ${a.v} is not a bytes32`); head += String(a.v).slice(2).toLowerCase(); }
    else if (a.t === 'address') { if (!isAddr(String(a.v))) throw new Error(`attest: ${a.v} is not an address`); head += String(a.v).slice(2).toLowerCase().padStart(64, '0'); }
    else head += word(BigInt(a.v));
  }
  return head + tail;
}
const selector = (sig: string) => attestKeccak(sig).slice(2, 10);
const call = (sig: string, args: AbiArg[]): AttestHex => `0x${selector(sig)}${encodeArgs(args)}`;

export const DECISION_LOG_RECORD_SIG = 'record(bytes32,bytes32,bytes32,uint16,string,string)';
export const ANSWER_LOG_RECORD_SIG = 'record(bytes32,bytes32,bytes32,bytes32,bytes32,string,string)';
export const STAMP_SIG = 'stamp(bytes32,bytes32,uint8,uint8,string,string)';

/** canonical JSON: sorted keys, bigint as a decimal string, no whitespace (the digest's preimage) */
export function attestCanonical(v: unknown): string {
  if (typeof v === 'bigint') return JSON.stringify(v.toString());
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(attestCanonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${attestCanonical(o[k])}`).join(',')}}`;
}
const jobRef = (id: string | number | bigint): AttestHex => (typeof id === 'string' && isHex32(id) ? (id as AttestHex) : (`0x${word(BigInt(id))}` as AttestHex));
/** JevDecisionLog.subjectOf(chainId, at, ref) = keccak256(abi.encode("taifoon.decision.subject.v1", chainId, at, ref)) */
export const decisionSubjectOf = (chainId: number, at: string, ref: string | number | bigint): AttestHex =>
  attestKeccak(bytesOf(encodeArgs([{ t: 'string', v: 'taifoon.decision.subject.v1' }, { t: 'uint', v: chainId }, { t: 'address', v: at }, { t: 'bytes32', v: jobRef(ref) }])));
/** GradeStampRegistry.subjectOf(chainId, jobContract, jobId) = keccak256(abi.encode("taifoon.stamp.subject.v1", …)) */
export const stampSubjectOf = (chainId: number, jobContract: string, jobId: string | number | bigint): AttestHex =>
  attestKeccak(bytesOf(encodeArgs([{ t: 'string', v: 'taifoon.stamp.subject.v1' }, { t: 'uint', v: chainId }, { t: 'address', v: jobContract }, { t: 'bytes32', v: jobRef(jobId) }])));

/** the stamp verdict of a settled ending, from the seller-record verdict the machine writes (endingOf): correct → 1;
 *  a Jev case (rejected or expired after delivery) → 4, it takes a grade to say more; incorrect → 3; excluded → no stamp */
export function stampVerdictOfEnding(e: { verdict: string; jevCase: boolean; excluded: string | null }): StampVerdict | null {
  if (e.excluded) return null;
  if (e.verdict === 'correct') return 1;
  if (e.jevCase || e.verdict === 'undecided') return 4;
  if (e.verdict === 'incorrect') return 3;
  return null;
}

/** the mark, the attestation calls and the stamp call of one step, on the profile's networks (or the ones named) */
export function attest(input: AttestInput, opts: AttestOptions = {}): Attested {
  const { subject } = input;
  if (!isAddr(subject.contract)) throw new Error(`attest: subject.contract ${subject.contract} is not an address`);
  if (!input.kind) throw new Error('attest: a kind names the step');
  const digest = input.digest ?? attestKeccak(attestCanonical(input.body ?? null));
  if (!isHex32(digest) || /^0x0{64}$/.test(digest)) throw new Error('attest: the digest must be a non-zero bytes32');
  const confidenceBps = input.confidenceBps ?? 10_000;
  if (!Number.isInteger(confidenceBps) || confidenceBps < 0 || confidenceBps > 10_000) throw new Error(`attest: confidenceBps ${confidenceBps} is not 0..10000`);
  const model = input.model; if (!model || utf8(model).length > 64) throw new Error('attest: model is 1..64 bytes');
  const uri = input.uri ?? `urn:taifoon:${input.kind}:${digest}`; if (utf8(uri).length > 512) throw new Error('attest: uri is ≤ 512 bytes');
  const verdict = input.verdict ?? null; const mode = input.mode ?? 1;
  if (verdict !== null && ![1, 2, 3, 4].includes(verdict)) throw new Error(`attest: verdict ${verdict} is not 1..4`);
  const kindId = attestKeccak(input.kind);
  const mark = { kind: input.kind, kindId, subject: decisionSubjectOf(subject.chainId, subject.contract, subject.jobId), stampSubject: stampSubjectOf(subject.chainId, subject.contract, subject.jobId), digest, confidenceBps, verdict, model, uri };
  if (opts.networks === 'none') return { mark, recorded: false, networks: [], calls: [], missing: [], status: 'none' };
  const networks = [...(opts.networks ?? ATTEST_PROFILES[opts.profile ?? 'taifoon'])];
  const calls: AttestCall[] = []; const missing: AttestMissing[] = [];
  for (const chainId of networks) {
    // the defaults as their own value: written inline before a spread of a fully typed target, tsc refuses them (TS2783)
    const unknownChain: (typeof ATTEST_TARGETS)[number] = { name: `chain ${chainId}`, decisionLog: null, answerLog: null, stampRegistry: null };
    const t = { ...unknownChain, ...ATTEST_TARGETS[chainId], ...opts.targets?.[chainId] };
    const gap = (contract: AttestMissing['contract']) => missing.push({ chainId, network: t.name, contract, why: `no ${contract} on ${t.name} (${chainId}) in the address registry` });
    // the answers first, then the decision that cites them (the order the layer's recorder sends)
    if (input.answers) {
      if (t.answerLog) calls.push({ chainId, to: t.answerLog, value: '0', fn: 'JevAnswerLog.record', data: call(ANSWER_LOG_RECORD_SIG, [{ t: 'bytes32', v: attestKeccak(input.answers.useCase) }, { t: 'bytes32', v: mark.subject }, { t: 'bytes32', v: input.answers.inputDigest }, { t: 'bytes32', v: input.answers.answersDigest }, { t: 'bytes32', v: digest }, { t: 'string', v: model }, { t: 'string', v: input.answers.uri ?? uri }]) });
      else gap('JevAnswerLog');
    }
    if (t.decisionLog) calls.push({ chainId, to: t.decisionLog, value: '0', fn: 'JevDecisionLog.record', data: call(DECISION_LOG_RECORD_SIG, [{ t: 'bytes32', v: mark.subject }, { t: 'bytes32', v: kindId }, { t: 'bytes32', v: digest }, { t: 'uint', v: confidenceBps }, { t: 'string', v: model }, { t: 'string', v: uri }]) });
    else gap('JevDecisionLog');
    if (verdict !== null) {
      if (t.stampRegistry) calls.push({ chainId, to: t.stampRegistry, value: '0', fn: 'GradeStampRegistry.stamp', data: call(STAMP_SIG, [{ t: 'bytes32', v: mark.stampSubject }, { t: 'bytes32', v: digest }, { t: 'uint', v: verdict }, { t: 'uint', v: mode }, { t: 'string', v: model }, { t: 'string', v: uri }]) });
      else gap('GradeStampRegistry');
    }
  }
  const status = missing.length === 0 ? 'ready' : calls.length === 0 ? 'missing' : 'partial';
  return { mark, recorded: true, networks, calls, missing, status };
}

// ── settle-attested.ts (profile moonbeam): src/settle-attested.ts, import lines removed by scripts/sync.mjs ──
// settleAttested: settle() plus the step's attested mark, its JevDecisionLog attestation and its stamp, by default (the
// owner's rule of 2026-10-14). Imports only the core and attest.ts; scripts/sync.mjs strips the imports in the one-file copy.

export type SettleAttestOptions = AttestOptions & {
  /** the contract the job lives on (the hook, the venue's escrow): with chainId and jobId it names the subject */
  contract: string;
  /** ≤ 64 bytes; default det:assurance-settle-v1 */
  model?: string | undefined;
  uri?: string | undefined;
};

/** the canonical body a settle attests: the job, its ending and the legs (bigint amounts as decimal strings) */
export const settleBodyOf = (job: AssuredJob, contract: string, s: { ending: Ending; money: MoneyEnding; legs: Legs }) => ({
  v: 'assurance.settle.v1', chainId: job.chainId, contract: contract.toLowerCase(), jobId: String(job.jobId), venue: job.venue,
  ending: s.ending.id, verdict: s.ending.verdict, money: s.money, legs: s.legs,
});

/** settle() and the attestation of its result; refused exactly when settle() refuses */
export function settleAttested(job: AssuredJob, q: EconomyQuote, opts: SettleAttestOptions):
  { ok: true; ending: Ending; money: MoneyEnding; legs: Legs; attest: Attested } | Refused {
  const s = settle(job, q);
  if (!s.ok) return s;
  const a = attest({
    kind: 'assurance.settle', subject: { chainId: job.chainId, contract: opts.contract, jobId: job.jobId },
    body: settleBodyOf(job, opts.contract, s), model: opts.model ?? 'det:assurance-settle-v1', uri: opts.uri,
    verdict: stampVerdictOfEnding(s.ending), mode: 1,
  }, opts);
  return { ...s, attest: a };
}

// ── venues (profile moonbeam): src/venues/, import lines removed by scripts/sync.mjs ──
// One venue = one adapter with the same shape: the venue's payment system mapped onto the machine. Pure data plus a
// reader from the venue's own vocabulary to machine events. No address: contracts are named by their entry in the
// address registry (packages/addresses/addresses.json: system, chain, name), which a caller resolves.

/** a contract by its address-registry entry */
export type Ref = { system: string; chain: number; name: string };
/** what Taifoon can put on a venue's job */
export type Attach =
  | 'hook-cover'      // the job is escrowed in our hook: deposit, premium, pool cover, the four endings enforced on chain
  | 'external-cover'  // a policy from ExternalCover on a job escrowed elsewhere: the pool pays the buyer's loss
  | 'evaluator-seat'  // our JudgeAdapter / Jev is the job's named evaluator: it completes or rejects, and earns the fee
  | 'grade'           // a Jev grade of the delivery, paid by the caller, recorded on request
  | 'proof';          // a V5 receipt proof of the venue's events (funding, delivery, refund) against the superroot
export type VenueId = 'taifoon-hook' | 'moonbeam' | 'virtuals-acp' | 'memo-acp' | 'bitagent' | 'erc8183' | 'x402' | 'olas-mech';
/** a trail as the venue (or the observatory's index of it) reports it: an event name, or a state carrier */
export type NativeStep = { name: string; phase?: number; hookState?: number; handshake?: string; delivered?: boolean };

export type VenueAdapter = {
  id: VenueId;
  name: string;
  status: 'live' | 'devnet' | 'observed' | 'prepared' | 'read-only';
  /** the machine lane and hook version a job here walks; null for a venue that is observed, not walked (Olas Mech) */
  ctx: Ctx | null;
  observedLane?: string;
  /** `line`: an asset line of the venue on that chain (ASSET_LINES), when the chain's row is one line, not the venue's default asset */
  chains: { chainId: number; escrow: Ref | null; status: 'live' | 'devnet' | 'prepared' | 'read-only'; line?: AssetLineId }[];
  /** the venue's payment system in plain words */
  payment: string;
  asset: string;
  /** where the buyer's money sits in each held state (every held state the lane reaches) */
  moneyAt: Partial<Record<State, string>>;
  refund: { rule: 'hook' | 'claim' | 'claim-if-deployed' | 'none'; how: string };
  attach: { kind: Attach; how: string }[];
  /** the phase-map revenue hooks this venue's assurance earns through */
  revenue: { hook: RevenueHook; how: string }[];
  /** the read the layer already runs for this venue: no second index */
  observe: { index: string; adapter: string; reads: string[] };
  /** external cover's own id for the venue, when it sells policies there */
  coverVenue: 'erc8183' | 'bitagent' | 'memo-acp' | 'olas-mech' | 'x402' | null;
  /** may the public build money calls through us here (Moonbeam: no, pilot only) */
  publicWrites: boolean;
  /** what an integration needs that does not exist yet, or waits on a decision */
  needs: string[];
};

/** _GRID_LINE_v1_: one asset per job (V4: no oracle on the money path). An asset line is one hook instance whose job asset is
 *  that asset, with pools in that asset; a pool covers only jobs in its own asset. Every line walks the hook lane. */
export type AssetLineId = 'grid';
export type AssetLine = {
  id: AssetLineId;
  /** what a person reads */ name: string;
  chainId: number;
  asset: { symbol: string; decimals: number; pegUsd: number | null };
  /** 'prepared': the terms and the quote exist; buying waits on `opens` */ status: 'live' | 'prepared';
  /** the one plain sentence shown instead of a buy action while the line is prepared */ opens: string | null;
  /** the promise, in plain words */ promise: string;
  /** what the line never does */ never: string;
  /** jev-wilson's calibration of the line (judge/wilson calibration/<id>.json) and the hook bounds its quotes pass */
  economy: { calibration: string; maxPremiumBps: number; minBackersAprBps: number };
  /** the phase-map revenue hook the layer's leg lands in */ revenue: RevenueHook;
  /** what the line needs that does not exist yet */ needs: string[];
};

/** the venue's trail as machine events: event names pass through; phases, hook states and handshake states become states */
export function eventsOf(trail: NativeStep[]): AssuranceEvent[] {
  const out: AssuranceEvent[] = [];
  for (const s of trail) {
    if (typeof s.phase === 'number') { const to = stateOf.memoPhase(s.phase); if (to) out.push({ kind: 'state', to }); continue; }
    if (typeof s.hookState === 'number') { const to = stateOf.hook(s.hookState); if (to) out.push({ kind: 'state', to }); continue; }
    if (s.handshake) { const to = stateOf.handshake(s.handshake, s.delivered); if (to) out.push({ kind: 'state', to }); continue; }
    out.push({ kind: 'event', name: s.name });
  }
  return out;
}
/** the revenue hooks of phase-map, by name (a typo fails the adapter test) */
export const knownHook = (h: string): boolean => MACHINE.revenueHooks.some((r) => r.hook === h);

// The first reseller: Moonbeam Protocol's ACP assurance on Base, GLMR only, mapped read only.

const MOONBEAM_HELD = 'GLMR in Moonbeam\'s hook: the buyer\'s price and premium, the seller\'s deposit; the cover reserved in the seller\'s GLMR CoveragePool';
export const moonbeamVenue: VenueAdapter = {
  id: 'moonbeam',
  name: 'Moonbeam ACP (reseller, GLMR)',
  status: 'read-only',
  ctx: { lane: 'hook', hook: 'V3' },
  chains: [
    { chainId: 8453, escrow: { system: 'moonbeam-acp', chain: 8453, name: 'AssuranceHook (proxy)' }, status: 'read-only' },
  ],
  payment: 'The buyer funds the job in GLMR on Base: price and premium into Moonbeam\'s hook, the seller\'s GLMR deposit beside it, the cover reserved in the seller\'s GLMR pool. Completion pays the seller price + deposit and the premium to the pool; expiry or a rejection returns the buyer\'s GLMR; an adjudicated cheat pays the buyer from the deposit, then the pool. Every amount is GLMR from the job\'s own numbers: no price feed on the money path.',
  asset: 'GLMR only',
  moneyAt: { Funded: MOONBEAM_HELD, Submitted: MOONBEAM_HELD, Graded: `${MOONBEAM_HELD}; the grade is off chain until a call sends it`, Held: `${MOONBEAM_HELD}; waits on the evaluator Moonbeam registers` },
  refund: { rule: 'hook', how: 'the hook returns the buyer\'s GLMR at expiry (anyone, after the deadline) and at a rejection (V3: immediate, the buyer\'s own call)' },
  attach: [
    { kind: 'hook-cover', how: 'Moonbeam\'s own hook and GLMR pools (its contracts, its governance)' },
    { kind: 'grade', how: 'a Jev grade of a Moonbeam job, paid by the caller (the hook stores an evidence digest; the task spec must be committed at funding for a grade to show spec met)' },
    { kind: 'proof', how: 'a V5 receipt proof of the hook\'s events on Base' },
  ],
  revenue: [
    { hook: 'grades_pay_to_key', how: 'the Jev grade of a Moonbeam job past the free ones, paid by the caller' },
  ],
  observe: { index: 'the coordination layer\'s index of hook jobs on Base (its /v1 job reads)', adapter: 'the job trail; the hook State enum through stateOf.hook', reads: ['JobFunded', 'JobCovered', 'Submitted', 'Completed', 'Rejected', 'Expired', 'Cheated', 'PremiumReceived', 'Encumbered'] },
  coverVenue: null,
  publicWrites: false,
  needs: [
    'The GLMR pools are not open. Moonbeam ACP is in a pilot with selected partners: builders@moonbeam.foundation',
    'a protocol fee on this line is set by Moonbeam governance; none today',
    'this hook has no named evaluator and no dispute window: those endings need a newer hook',
  ],
};

/** the venues of this profile (moonbeam) */
export const VENUES: Partial<Record<VenueId, VenueAdapter>> = Object.fromEntries([moonbeamVenue].map((v) => [v.id, v]));
