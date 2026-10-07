/**
 * Interactive Session Orchestrator — contract types (v0).
 *
 * Generic and movement-content-agnostic by design. Nothing in this file
 * imports or references any CV detector, the shoulder-rehabilitation
 * module, or PatientCvCapture — a MovementBlock is described entirely by
 * data, and the Orchestrator drives it without knowing which (if any) live
 * tracker is behind it. Adapting a real detector's concrete output into the
 * generic SessionInputEvent vocabulary below is explicitly out of scope
 * here — that adapter is PR3's job.
 *
 * Deliberately excludes the complete enterprise information model —
 * only the fields required to run one continuous Neuro Upper-Limb session
 * safely are included. See the corrected-hierarchy plan for what is
 * intentionally deferred (ExerciseVariant, feedback presentation config
 * beyond a lookup key, etc.).
 */

// ── Session state ────────────────────────────────────────────────────────

export type SessionState =
  | "idle"
  | "preparing"
  | "calibrating"
  | "ready"
  | "active"
  | "resting"
  | "transitioning"
  | "paused"
  | "safetyHold"
  | "completed"
  | "stopped"
  | "error";

export type SafetyHoldReason = "trackerLost" | "compensation" | "painReported" | "manual";

// ── Movement Block contract ─────────────────────────────────────────────

export type MovementBlockCompletionMode =
  | "duration"
  | "validRepetitions"
  | "holdDuration"
  | "clinicianDefined"
  | "manualCompletion";

export type MovementBlockPosition = "seated" | "standing" | "configurable";

export type MovementBlockSide = "left" | "right" | "bilateral";

/**
 * Which Block Runner drives this block's tick-by-tick interaction.
 * Additive — optional so existing block definitions remain valid without it.
 * Distinct from `feedbackProfile`: this selects behavior (which runner),
 * `feedbackProfile` selects copy/feedback policy. The two happen to be
 * combined into one string today in existing session definitions; this
 * field lets them separate without a breaking change.
 */
export type SessionBlockType = "movement-target" | "movement-pattern" | "instructional";

export type MovementBlockSafetyRules = {
  /** Consecutive/accumulated compensation events before this block auto-enters safetyHold. Undefined = no auto-pause on compensation. */
  maxCompensationEventsBeforePause?: number;
  /** Hard safety cap distinct from targetDurationSeconds — ends the block even if its primary completion mode never fires. */
  blockTimeoutSeconds?: number;
  /**
   * How long the tracker may remain lost before this block auto-enters
   * safetyHold, in seconds. 0 (the default when unset) means immediate —
   * tracker loss is a block-configurable safety rule, not a single global
   * behavior; a block with a brief expected occlusion could set this
   * higher, though no such case exists yet.
   */
  trackerLossGraceSeconds?: number;
};

/**
 * The unit the Orchestrator sequences. Fields are intentionally generic —
 * `movementId`/`movementVersion` are foreign keys into the exercise
 * library (still `exercise-library-v1.ts` today), not a movement
 * definition duplicated here.
 */
export type MovementBlock = {
  blockId: string;
  movementId: string;
  movementVersion: string;
  title: string;
  instructions: string;
  targetDurationSeconds?: number;
  restAfterSeconds?: number;
  completionMode: MovementBlockCompletionMode;
  prescribedRepetitions?: number;
  prescribedHoldSeconds?: number;
  supportedPositions: readonly MovementBlockPosition[];
  side?: MovementBlockSide;
  intensityLevel?: 1 | 2 | 3;
  /** Which Block Runner handles this block's interaction. See SessionBlockType. */
  blockType?: SessionBlockType;
  /** Key into a future Feedback Layer / Target Sequence registry (PR3). Not resolved here. */
  feedbackProfile?: string;
  /** Key describing how to transition out of this block (e.g. "standard", "safety-priority"). Not resolved here. */
  transitionProfile?: string;
  safetyRules?: MovementBlockSafetyRules;
};

export type SessionDefinition = {
  sessionId: string;
  title: string;
  blocks: readonly MovementBlock[];
  /** Hard cap on the whole session, distinct from any one block's timeout. Undefined = no session-level timeout. */
  sessionTimeoutSeconds?: number;
  /** Consecutive trackerLost frames grace period before requiring recalibration on resume, in seconds. */
  recalibrationGraceSeconds?: number;
};

// ── Input events ─────────────────────────────────────────────────────────

/**
 * Generic vocabulary for future live detectors. The Orchestrator consumes
 * these without knowing the detector implementation — it does not decide
 * whether a movement event is clinically valid; that judgment belongs to
 * whatever produced the event.
 */
export type SessionInputEvent =
  | { type: "trackerReady"; capturedAtMs: number }
  | { type: "trackerLost"; capturedAtMs: number }
  | { type: "calibrationStarted"; capturedAtMs: number }
  | { type: "calibrationCompleted"; capturedAtMs: number }
  | { type: "validRepetition"; capturedAtMs: number; metrics?: Record<string, unknown> }
  | { type: "invalidRepetition"; capturedAtMs: number; reason?: string }
  | { type: "targetContact"; capturedAtMs: number; reactionTimeMs?: number }
  | { type: "patternCompleted"; patternId: string; capturedAtMs: number }
  | { type: "holdStarted"; capturedAtMs: number }
  | { type: "holdCompleted"; capturedAtMs: number; durationSeconds: number }
  | { type: "compensationDetected"; capturedAtMs: number; signal?: string }
  | { type: "compensationCleared"; capturedAtMs: number }
  | { type: "movementInterrupted"; capturedAtMs: number; reason?: string }
  | { type: "patientPainReported"; capturedAtMs: number; severity?: number }
  | { type: "safetyStopRequested"; capturedAtMs: number };

// ── Result separation — interaction / measured / interpreted ───────────

export type InteractionPerformance = {
  targetsContacted: number;
  patternsCompleted: number;
  timingSamplesMs: number[];
  responseConsistency: number | null;
  participationDurationSeconds: number;
};

export type MeasuredMovementPerformance = {
  validRepetitions: number;
  invalidRepetitions: number;
  rangeValuesDegrees: number[];
  holdDurationSeconds: number | null;
  movementSpeed: number | null;
  returnControl: number | null;
  trackingConfidence: number | null;
};

export type InterpretedObservations = {
  compensationEvents: number;
  asymmetryObservations: string[];
  fatigueTrend: "stable" | "declining" | "unknown";
  reducedControl: boolean;
  trackingLimitations: string[];
};

export type MovementBlockCompletionReason =
  | "duration"
  | "validRepetitions"
  | "holdDuration"
  | "clinicianDefined"
  | "manualCompletion"
  | "blockTimeout"
  | "movementInterrupted"
  | "safetyStop";

export type MovementBlockResult = {
  blockId: string;
  movementId: string;
  startedAtMs: number;
  completedAtMs: number | null;
  completionReason: MovementBlockCompletionReason | null;
  interaction: InteractionPerformance;
  measured: MeasuredMovementPerformance;
  interpreted: InterpretedObservations;
  /**
   * Echoed from the originating MovementBlock's own `blockType`/`title` —
   * not a new measurement, not derived, not inferred. Optional so a row
   * persisted before this field existed still deserializes safely; a
   * reader must treat its absence as "unknown," never guess a category
   * from other fields. Exists so a report can tell a target block from a
   * pattern block from an instructional block without parsing blockId.
   */
  blockType?: SessionBlockType;
  title?: string;
};

export function createEmptyMovementBlockResult(block: MovementBlock, startedAtMs: number): MovementBlockResult {
  return {
    blockId: block.blockId,
    movementId: block.movementId,
    startedAtMs,
    completedAtMs: null,
    completionReason: null,
    blockType: block.blockType,
    title: block.title,
    interaction: {
      targetsContacted: 0,
      patternsCompleted: 0,
      timingSamplesMs: [],
      responseConsistency: null,
      participationDurationSeconds: 0,
    },
    measured: {
      validRepetitions: 0,
      invalidRepetitions: 0,
      rangeValuesDegrees: [],
      holdDurationSeconds: null,
      movementSpeed: null,
      returnControl: null,
      trackingConfidence: null,
    },
    interpreted: {
      compensationEvents: 0,
      asymmetryObservations: [],
      fatigueTrend: "unknown",
      reducedControl: false,
      trackingLimitations: [],
    },
  };
}

export type SessionPerformanceSummary = {
  sessionState: SessionState;
  totalElapsedSeconds: number;
  blocksCompleted: number;
  blocksTotal: number;
  blockResults: readonly MovementBlockResult[];
};

// ── Output state ─────────────────────────────────────────────────────────

export type PatientFeedbackState = {
  message: string | null;
  encouragement: string | null;
};

export type TransitionState = "none" | "enteringBlock" | "leavingBlock";
export type SafetyStatus = "normal" | "hold" | "stopped";

export type SessionOrchestratorSnapshot = {
  sessionState: SessionState;
  currentBlockIndex: number | null;
  currentBlock: MovementBlock | null;
  currentInstruction: string | null;
  blockElapsedSeconds: number;
  sessionElapsedSeconds: number;
  blockProgress: number;
  sessionProgress: number;
  restRemainingSeconds: number | null;
  transitionState: TransitionState;
  isPaused: boolean;
  safetyStatus: SafetyStatus;
  safetyHoldReason: SafetyHoldReason | null;
  patientFeedbackState: PatientFeedbackState;
  accumulatedBlockResults: readonly MovementBlockResult[];
};
