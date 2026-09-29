/**
 * @moonbeam-foundation/sdk
 *
 * Assurance for agent work. Wrap a job in a price, a judge and a deadline, and
 * settle it against proof rather than against a status report.
 *
 * The core is pure: `settle()` takes terms and a verdict and returns every
 * actor's net position. No clock, no chain, no I/O — so the economic
 * invariants (value is conserved, cheating pays the victim, doubt is capped by
 * bonded capital) are properties you can test rather than claims you have to
 * trust.
 *
 * Nothing here is an offer or a promise of yield, and every figure in the
 * docs and tests is illustrative.
 */

export {
  parseUnits,
  formatUnits,
  applyBps,
  min,
  clampToZero,
  sum,
  USDC_DECIMALS,
  ZERO,
} from './core/money.js';
export type { Money, Bps } from './core/money.js';

export type {
  Role,
  Participant,
  Obligation,
  ActorSpec,
  JobTerms,
  Verdict,
  DoubtPosition,
  ChallengePosition,
  SettlementInput,
  Ledger,
  Settlement,
} from './core/types.js';

/**
 * `Participant` names everyone who can act on a job; `Role` names only those
 * who hold a position in the settlement ledger. The arbitrator is the
 * difference: it resolves states nobody else can but takes no share of escrow.
 * These are exported because `recourseFor`, `waitingOn` and `Recourse.blockedOn`
 * all speak `Participant` — a caller could not previously name the type of an
 * argument they were required to pass.
 */
export { ARBITRATOR, holdsPosition } from './core/types.js';

export {
  settle,
  lockedValue,
  maxDoubtPayout,
  poolLossPerFailure,
  ledgerTotal,
  conservesValue,
} from './core/settle.js';

export { ACTORS, actorsBy } from './core/actors.js';

export {
  runSeason,
  breakEvenFailureRate,
  impliedFailureRate,
  clearingFeeIsCoherent,
} from './core/pool.js';
export type { SeasonInput, SeasonResult } from './core/pool.js';

export { localClock, chainClock, attestedClock, isFresh, expiryOf } from './core/clock.js';
export type { Clock, ClockSource, Seconds, FinalityAttestation, Expiry } from './core/clock.js';

// ── ACP decoding and the job state machine ──
export {
  decodeAcpLog,
  decodeAcpLogs,
  attributeDispute,
  ACP_TOPIC0,
  ACP_SIGNATURES,
  VIRTUALS_ACP_ADDRESS,
  VIRTUALS_ACP_CHAIN_ID,
} from './acp/events.js';
export type { RawLog, AcpEvent, CloseReason } from './acp/events.js';

export { foldTask, foldTasks, groupByJob, findSelfGraded, independentShare, phaseOf } from './acp/lifecycle.js';
export type { TaskState, EscrowStatus, WorkStatus, VerificationClass } from './acp/lifecycle.js';

// ── The transition table: what may follow what, and what may coexist ──
export {
  ESCROW_RANK,
  WORK_RANK,
  ESCROW_TERMINALS,
  WORK_TERMINALS,
  isEscrowTerminal,
  isWorkTerminal,
  escrowConflicts,
  workConflicts,
  resolveEscrow,
  resolveWork,
  resolveGrade,
} from './acp/transitions.js';
export type { Phase, Resolution } from './acp/transitions.js';

export { toOutcome, isSettled } from './acp/outcome.js';
export type { AcpOutcome, SettledOutcome, PendingOutcome, OutcomeBasis, PendingReason } from './acp/outcome.js';

export { availableActions, recourseFor, livenessOf, waitingOn, isParty } from './acp/recourse.js';
export type { Action, ActionId, Recourse, LivenessReport } from './acp/recourse.js';

// ── Decode coverage: proof that nothing in live traffic is being missed ──
export { measureCoverage, assertFullCoverage } from './acp/coverage.js';
export type { CoverageReport } from './acp/coverage.js';

// ── The watch list, for a proof layer indexing the same events ──
export { WATCHED_EVENTS, LEDGERS, watchedTopics, terminalTopics, watchManifest } from './acp/registry.js';
export type { WatchedEvent, LedgerId, LedgerSpec } from './acp/registry.js';

export { prepareSettlement } from './acp/pipeline.js';
export type { Prepared, PrepareOptions } from './acp/pipeline.js';

export { sameAddress, ZERO_ADDRESS } from './acp/hex.js';
export type { Hex, Address, Hex32 } from './acp/hex.js';

// ── Per-actor arithmetic ──
export {
  positionUnder,
  positionsByVerdict,
  worstCase,
  bestCase,
  coverGap,
  recoveryFor,
  capitalRequired,
  canAccept,
  proofRequiredFor,
  bondAtRisk,
  poolExposure,
  solventUnder,
  doubtQuote,
  sizeWithinCap,
  challengeQuote,
  worthChallenging,
} from './actors/index.js';
export type { Decision, Exposure, DoubtQuote, ChallengeQuote } from './actors/index.js';

// ── Per-worker records: the unit that actually carries information ──
export {
  trackRecordFor,
  trackRecords,
  concentrationOf,
  MIN_JOBS_FOR_A_RECORD,
  DOMINANCE_THRESHOLD,
  WILSON_Z,
  wilsonScore,
} from './actors/track-record.js';
export type { TrackRecord, ConcentrationReport } from './actors/track-record.js';

// ── Connectors: IO at the edge, injectable, never inside settlement ──
export { ok, err, valueOr, meansAbsent, describeError } from './connect/result.js';
export type { Result, LookupError } from './connect/result.js';

export {
  verifyAttestation,
  isSignedByTrusted,
  clockFromAttestation,
  parseAttestation,
} from './connect/attestation.js';
export type { Ecrecover, AttestationSource, Verification } from './connect/attestation.js';

export { createAttestationSource, createProofSource, formatEventRef } from './connect/http.js';
export type { Fetch, HttpSourceOptions, EventRef, ProofSource } from './connect/http.js';

export { splitRange, fetchLogRange, MAX_BLOCK_SPAN } from './connect/logs.js';
export type { LogQuery, LogSource, FetchLogsOptions } from './connect/logs.js';

// ── Transaction building: builds calls, never signs or sends ──
export {
  createAssuranceClient,
  assertSupportedChain,
  asProofBlob,
  UnsupportedChainError,
  SELECTOR,
  SUPPORTED_CHAIN_IDS,
} from './client/index.js';
export type {
  CallRequest,
  ChainConfig,
  AssuranceClient,
  EscrowCalls,
  EvaluatorCalls,
  ProofBlob,
} from './client/index.js';

// ── Safe onboarding: the checks that run before capital is committed ──
export {
  readinessForClient,
  readinessForProvider,
  readinessForEvaluator,
  readinessForBacker,
  readinessForDoubter,
  readinessForChallenger,
  blockers,
  summarise,
  OBSERVED_NON_DELIVERY_RANGE,
  OBSERVED_REJECTION_RANGE,
  OBSERVED_PROVIDER_CONCENTRATION,
} from './onboarding/index.js';
export type {
  Severity,
  Finding,
  Readiness,
  ClientIntent,
  ProviderIntent,
  EvaluatorIntent,
  BackerIntent,
  DoubterIntent,
  ChallengerIntent,
} from './onboarding/index.js';

// ── Negotiation: how terms are reached before settlement prices them ──
export {
  open,
  bid,
  checkBid,
  accept,
  bestBid,
  expire,
  coverSplit,
  lockedByBuyer,
} from './negotiate/index.js';
export type {
  Intent,
  Bid,
  CoverQuote,
  Negotiation,
  NegotiationPhase,
  Refusal,
  RefusalCode,
} from './negotiate/index.js';

export type { AssuranceAdapter, CoveragePolicy } from './adapters/port.js';
export {
  acpAdapter,
  isInsurable,
  DEFAULT_ACP_POLICY,
} from './adapters/acp.js';
export type { AcpJob, AcpEvaluation, AcpPhase } from './adapters/acp.js';
export * as erc8183 from './erc8183/index.js';

// ── ERC-8004: who the parties are ──────────────────────────────────────────
// The job standard says what happened; this one says who did it. Identity,
// reputation and validation registries, decoded from their own topic hashes.
export * as erc8004 from './erc8004/index.js';

// A grade, stamped on chain, that anyone recomputes: the GradeStampRegistry (immutable, append-only)
// and ERC-8004 reputation feedback. Pure encoders; nothing here signs.
export {
  STAMP_VERDICTS,
  STAMP_VERDICT_CODE,
  STAMP_MODE,
  GRADE_STAMP_REGISTRY,
  ERC8004_REPUTATION_REGISTRY,
  canonicalGrade,
  gradeDigest,
  subjectOf,
  encodeStamp,
  encodeErc8004Feedback,
  verifyStamp,
} from './adapters/stamp.js';
export type { Grade, StampVerdict, StampMode, UnsignedCall } from './adapters/stamp.js';

// ── The launcher: one insured job, phase by phase, for every party ──
export {
  PHASES, LAUNCH_ROLES, PHASE_MEANING, ROLE_STEPS, launchFor,
  ENDINGS, endingFromTrail, compare, GRADE_BAR, ENDING_EFFECT, caseFor, summarise as summariseCases,
} from './launcher/index.js';
export type { Phase as LaunchPhase, LaunchRole, LaunchIntent, LaunchPlan, TrailEvent, Ending as TrailEnding, Decision as TrailDecision, GradeAnswer, Comparison, CaseKind, LaunchCase } from './launcher/index.js';

// ── Onboard: how a Base agent becomes hireable, with the judge standing guard ──
// The full module is at './onboard'; the root re-exports the shapes and the pure rules only,
// so a consumer that never fetches pays for nothing it does not use.
export {
  BASE_JOB_CONTRACT, BASE_USDC, BASE_ASSURANCE_HOOK, BASE_POOL_FACTORY, ERC8004_IDENTITY_REGISTRY,
  JEV_OPTIONS, DEFAULT_GUARD, DEPOSIT_FACTOR, JEV_BAR, QUOTA_FREE, QUOTA_BURST_PER_MINUTE, QUOTA_BLOCK, RECORD_MIN_N, RECORD_MAX_WIDTH,
  depositFor, checkDeposit, wilson, isCalibrated, admit, blocksFor, priceOfBlocks, attestationState, decisionEnding, endingOf as onboardEndingOf, ENDING_MONEY,
  hireable, fundCalls, submitCalls, settleCalls, jobIdOf, correlatorOf, keccak256, keccakHex, selector, SIGNATURES,
  discover, attest, quote, judge, record, assess, OnboardError,
} from './onboard/index.js';
export type {
  BaseAgentCandidate, Attestation, HireTerms, UnsignedCall as OnboardUnsignedCall, Delivery, JevGuard, JevDecision, JevOption, Ending as OnboardEnding, Settlement as OnboardSettlement, SellerRecord, Hireable, OnboardTransport, QuotaStanding,
} from './onboard/index.js';
