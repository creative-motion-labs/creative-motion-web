/**
 * Interactive Session Orchestrator (v0).
 *
 * Owns the continuous session timeline: block sequencing, transitions,
 * work/rest intervals, pause/resume, safety interruption, completion, and
 * result aggregation. It does not perform movement detection — it
 * consumes `SessionInputEvent`s produced by whatever tracker is active and
 * never decides whether a movement event is clinically valid; that
 * judgment belongs to the event's producer.
 *
 * Every method that depends on time takes an explicit `nowMs` parameter —
 * there is no internal `Date.now()`/`performance.now()` call anywhere in
 * this class, so every transition is fully deterministic and testable
 * without fake timers.
 */

import {
  createEmptyMovementBlockResult,
  type MovementBlock,
  type MovementBlockCompletionReason,
  type MovementBlockResult,
  type PatientFeedbackState,
  type SafetyHoldReason,
  type SafetyStatus,
  type SessionDefinition,
  type SessionInputEvent,
  type SessionOrchestratorSnapshot,
  type SessionPerformanceSummary,
  type SessionState,
  type TransitionState,
} from "./types";
import {
  extractPeakAngleSampleDegrees,
  extractReactionTimeSampleMs,
} from "./measured-sample-extraction";

const DEFAULT_RECALIBRATION_GRACE_SECONDS = 5;

// ── Pausable timer — internal helper, no wall-clock reads ────────────────

type PausableTimer = {
  accumulatedMs: number;
  /** null while paused/not running. */
  lastResumeMs: number | null;
};

function createPausableTimer(nowMs: number): PausableTimer {
  return { accumulatedMs: 0, lastResumeMs: nowMs };
}

function pausableTimerElapsedMs(timer: PausableTimer, nowMs: number): number {
  if (timer.lastResumeMs === null) return timer.accumulatedMs;
  return timer.accumulatedMs + Math.max(0, nowMs - timer.lastResumeMs);
}

function pausePausableTimer(timer: PausableTimer, nowMs: number): void {
  if (timer.lastResumeMs !== null) {
    timer.accumulatedMs += Math.max(0, nowMs - timer.lastResumeMs);
    timer.lastResumeMs = null;
  }
}

function resumePausableTimer(timer: PausableTimer, nowMs: number): void {
  if (timer.lastResumeMs === null) {
    timer.lastResumeMs = nowMs;
  }
}

const PAUSABLE_FROM_STATES: readonly SessionState[] = [
  "preparing",
  "calibrating",
  "active",
  "resting",
  "transitioning",
];

export class SessionOrchestrator {
  private readonly definition: SessionDefinition;

  private state: SessionState = "idle";
  private currentBlockIndex: number | null = null;
  private blockResults: MovementBlockResult[] = [];
  private currentBlockResult: MovementBlockResult | null = null;

  private sessionTimer: PausableTimer | null = null;
  private blockTimer: PausableTimer | null = null;
  private restTimer: PausableTimer | null = null;

  private pausedFromState: SessionState | null = null;
  private safetyHoldReason: SafetyHoldReason | null = null;
  private trackerLostAtMs: number | null = null;
  private compensationEventsThisBlock = 0;

  private feedback: PatientFeedbackState = { message: null, encouragement: null };

  constructor(definition: SessionDefinition) {
    this.definition = definition;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  start(nowMs: number): void {
    if (this.state !== "idle") return;
    this.state = "preparing";
    this.sessionTimer = createPausableTimer(nowMs);
    this.feedback = { message: "Get ready.", encouragement: null };
  }

  beginCalibration(nowMs: number): void {
    if (this.state !== "preparing") return;
    this.state = "calibrating";
    this.feedback = { message: "Hold still while we calibrate.", encouragement: null };
  }

  /**
   * Calibration completion starts the first movement block directly. The
   * "ready" state is defined in the type system (a future explicit
   * confirm-to-begin UX could insert it as an observable step) but is not
   * independently reached in this version's automatic flow — see the
   * implementation report's known limitations.
   */
  completeCalibration(nowMs: number): void {
    if (this.state !== "calibrating") return;
    this.beginNextBlockOrFinish(nowMs);
  }

  private beginNextBlockOrFinish(nowMs: number): void {
    const nextIndex = this.currentBlockIndex === null ? 0 : this.currentBlockIndex + 1;
    if (nextIndex >= this.definition.blocks.length) {
      this.finishSession(nowMs, "completed");
      return;
    }
    this.currentBlockIndex = nextIndex;
    const block = this.definition.blocks[nextIndex];
    this.currentBlockResult = createEmptyMovementBlockResult(block, nowMs);
    this.compensationEventsThisBlock = 0;
    this.blockTimer = createPausableTimer(nowMs);
    this.restTimer = null;
    this.state = "active";
    this.feedback = { message: block.instructions, encouragement: null };
  }

  /** For "clinicianDefined" and "manualCompletion" modes — not auto-inferred from time or events. */
  completeBlockManually(nowMs: number): void {
    if (this.state !== "active" || !this.currentBlockResult) return;
    const block = this.currentBlock();
    if (!block) return;
    if (block.completionMode === "clinicianDefined") {
      this.completeCurrentBlock(nowMs, "clinicianDefined");
    } else if (block.completionMode === "manualCompletion") {
      this.completeCurrentBlock(nowMs, "manualCompletion");
    }
  }

  private completeCurrentBlock(nowMs: number, reason: MovementBlockCompletionReason): void {
    if (!this.currentBlockResult) return;
    // Freeze this block's timer — its active measurement window has ended;
    // blockElapsedSeconds must not keep growing through rest/transition.
    if (this.blockTimer) pausePausableTimer(this.blockTimer, nowMs);

    this.currentBlockResult.completedAtMs = nowMs;
    this.currentBlockResult.completionReason = reason;
    this.currentBlockResult.interaction.participationDurationSeconds = this.blockElapsedSeconds(nowMs);
    this.blockResults.push(this.currentBlockResult);
    this.currentBlockResult = null;

    const block = this.currentBlock();
    if (block && block.restAfterSeconds !== undefined && block.restAfterSeconds > 0) {
      this.state = "resting";
      this.restTimer = createPausableTimer(nowMs);
      this.feedback = { message: "Take a short rest.", encouragement: "Nice work." };
    } else {
      // No rest configured for this block — advance immediately rather than
      // parking in "transitioning" for an external tick() to notice.
      // "transitioning" is reserved for a future deliberate pause between
      // blocks (e.g. a Session Environment transition animation); it is
      // not reached as an externally observable state in this version.
      this.beginNextBlockOrFinish(nowMs);
    }
  }

  private finishSession(nowMs: number, finalState: "completed" | "stopped"): void {
    if (this.currentBlockResult) {
      if (this.blockTimer) pausePausableTimer(this.blockTimer, nowMs);
      this.currentBlockResult.completedAtMs = nowMs;
      this.currentBlockResult.completionReason =
        this.currentBlockResult.completionReason ?? (finalState === "stopped" ? "safetyStop" : null);
      this.currentBlockResult.interaction.participationDurationSeconds = this.blockElapsedSeconds(nowMs);
      this.blockResults.push(this.currentBlockResult);
      this.currentBlockResult = null;
    }
    this.pauseActiveTimers(nowMs);
    this.state = finalState;
    this.feedback = {
      message: finalState === "completed" ? "Session complete." : "Session ended.",
      encouragement: finalState === "completed" ? "Great session." : null,
    };
  }

  // ── Time-based progression — call periodically ──────────────────────

  tick(nowMs: number): void {
    if (this.state === "active") {
      const block = this.currentBlock();
      if (!block) return;

      if (this.evaluateTrackerLossHold(block, nowMs)) return;

      const elapsedS = this.blockElapsedSeconds(nowMs);

      if (
        block.safetyRules?.blockTimeoutSeconds !== undefined &&
        elapsedS >= block.safetyRules.blockTimeoutSeconds
      ) {
        this.completeCurrentBlock(nowMs, "blockTimeout");
        return;
      }
      if (
        block.completionMode === "duration" &&
        block.targetDurationSeconds !== undefined &&
        elapsedS >= block.targetDurationSeconds
      ) {
        this.completeCurrentBlock(nowMs, "duration");
        return;
      }
    } else if (this.state === "resting") {
      const block = this.currentBlock();
      if (block && block.restAfterSeconds !== undefined && this.restRemainingSecondsRaw(nowMs) <= 0) {
        // Rest has elapsed — advance directly to the next block (or
        // completion) within this same tick() call. See the note in
        // completeCurrentBlock(): "transitioning" is reserved for a future
        // deliberate pause, not reached as an externally observable state
        // in this version.
        this.beginNextBlockOrFinish(nowMs);
        return;
      }
      return;
    } else if (this.state === "transitioning") {
      // Unreachable in this version (see above) — kept so a future change
      // that does park in "transitioning" still advances correctly on the
      // next tick() without needing this branch added back.
      this.beginNextBlockOrFinish(nowMs);
      return;
    }

    if (
      this.definition.sessionTimeoutSeconds !== undefined &&
      this.sessionTimer &&
      !["completed", "stopped", "error", "idle"].includes(this.state)
    ) {
      const sessionElapsedS = pausableTimerElapsedMs(this.sessionTimer, nowMs) / 1_000;
      if (sessionElapsedS >= this.definition.sessionTimeoutSeconds) {
        this.finishSession(nowMs, "stopped");
      }
    }
  }

  // ── Input events — from whatever tracker is active ──────────────────

  reportInputEvent(event: SessionInputEvent, nowMs: number): void {
    switch (event.type) {
      case "trackerLost": {
        if (this.trackerLostAtMs === null) this.trackerLostAtMs = nowMs;
        const block = this.currentBlock();
        if (block) this.evaluateTrackerLossHold(block, nowMs);
        return;
      }
      case "trackerReady":
        this.handleTrackerReady(nowMs);
        return;
      case "compensationDetected":
        this.handleCompensationDetected(nowMs);
        return;
      case "compensationCleared":
        if (this.state === "safetyHold" && this.safetyHoldReason === "compensation") {
          this.resumeFromSafetyHold(nowMs);
        }
        return;
      case "patientPainReported":
        this.enterSafetyHold(nowMs, "painReported");
        return;
      case "safetyStopRequested":
        this.finishSession(nowMs, "stopped");
        return;
      case "movementInterrupted":
        if (this.state === "active") {
          this.completeCurrentBlock(nowMs, "movementInterrupted");
        }
        return;
      default:
        break;
    }

    if (this.state !== "active" || !this.currentBlockResult) return;
    const block = this.currentBlock();
    if (!block) return;

    switch (event.type) {
      case "validRepetition": {
        this.currentBlockResult.measured.validRepetitions += 1;
        const peakAngleDegrees = extractPeakAngleSampleDegrees(event.metrics);
        if (peakAngleDegrees !== null) {
          this.currentBlockResult.measured.rangeValuesDegrees.push(peakAngleDegrees);
        }
        if (
          block.completionMode === "validRepetitions" &&
          block.prescribedRepetitions !== undefined &&
          this.currentBlockResult.measured.validRepetitions >= block.prescribedRepetitions
        ) {
          this.completeCurrentBlock(nowMs, "validRepetitions");
        }
        return;
      }
      case "invalidRepetition":
        this.currentBlockResult.measured.invalidRepetitions += 1;
        return;
      case "targetContact": {
        this.currentBlockResult.interaction.targetsContacted += 1;
        const reactionTimeMs = extractReactionTimeSampleMs(event.reactionTimeMs);
        if (reactionTimeMs !== null) {
          this.currentBlockResult.interaction.timingSamplesMs.push(reactionTimeMs);
        }
        return;
      }
      case "patternCompleted":
        this.currentBlockResult.interaction.patternsCompleted += 1;
        return;
      case "holdCompleted": {
        this.currentBlockResult.measured.holdDurationSeconds = event.durationSeconds;
        if (
          block.completionMode === "holdDuration" &&
          block.prescribedHoldSeconds !== undefined &&
          event.durationSeconds >= block.prescribedHoldSeconds
        ) {
          this.completeCurrentBlock(nowMs, "holdDuration");
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * Checks whether the currently-lost tracker has exceeded this block's
   * configured grace period and, if so, enters safetyHold. Returns true if
   * a hold was (already, or just now) entered — callers use this to skip
   * further time-based progression for the frame. A block with no
   * `trackerLossGraceSeconds` set holds immediately (grace = 0), matching
   * the pre-configuration default behavior.
   */
  private evaluateTrackerLossHold(block: MovementBlock, nowMs: number): boolean {
    // Instructional blocks (warm-up / cool-down) advance by duration only.
    // Brief tracking loss must not enter safetyHold and block completion.
    if (block.blockType === "instructional") return false;

    if (this.trackerLostAtMs === null) return false;
    if (this.state === "safetyHold" && this.safetyHoldReason === "trackerLost") return true;
    if (this.state !== "active") return false;

    const graceMs = (block.safetyRules?.trackerLossGraceSeconds ?? 0) * 1_000;
    const lostForMs = nowMs - this.trackerLostAtMs;
    if (lostForMs >= graceMs) {
      this.enterSafetyHold(nowMs, "trackerLost");
      return true;
    }
    return false;
  }

  private handleTrackerReady(nowMs: number): void {
    if (this.state !== "safetyHold" || this.safetyHoldReason !== "trackerLost") {
      // Tracker recovered before this block's grace period elapsed — never
      // entered a hold, nothing else to unwind.
      this.trackerLostAtMs = null;
      return;
    }
    const lostForMs = this.trackerLostAtMs !== null ? nowMs - this.trackerLostAtMs : 0;
    const graceMs = (this.definition.recalibrationGraceSeconds ?? DEFAULT_RECALIBRATION_GRACE_SECONDS) * 1_000;
    this.trackerLostAtMs = null;
    if (lostForMs > graceMs) {
      this.pausedFromState = null;
      this.state = "calibrating";
      this.safetyHoldReason = null;
      this.resumeActiveTimers(nowMs);
      this.feedback = { message: "Tracking was lost for a while — let's recalibrate before continuing.", encouragement: null };
    } else {
      this.resumeFromSafetyHold(nowMs);
    }
  }

  private handleCompensationDetected(nowMs: number): void {
    if (this.currentBlockResult) {
      this.currentBlockResult.interpreted.compensationEvents += 1;
      this.compensationEventsThisBlock += 1;
    }
    const max = this.currentBlock()?.safetyRules?.maxCompensationEventsBeforePause;
    if (max !== undefined && this.compensationEventsThisBlock >= max && this.state === "active") {
      this.enterSafetyHold(nowMs, "compensation");
    }
  }

  private enterSafetyHold(nowMs: number, reason: SafetyHoldReason): void {
    if (this.state === "stopped" || this.state === "completed" || this.state === "error") return;
    if (this.state === "safetyHold") {
      // A pain report always takes precedence over a lesser reason already on hold.
      if (reason === "painReported") this.safetyHoldReason = reason;
      return;
    }
    this.pauseActiveTimers(nowMs);
    this.pausedFromState = this.state;
    this.state = "safetyHold";
    this.safetyHoldReason = reason;
    this.feedback = {
      message:
        reason === "painReported"
          ? "Session paused — pain reported. Resume only when ready to continue."
          : "Tracking issue detected — please wait.",
      encouragement: null,
    };
  }

  /** Shared restoration logic for both patient-initiated resume() and auto-triggered resumeFromSafetyHold(). */
  private unwindToPreviousState(nowMs: number): void {
    const back = this.pausedFromState ?? "active";
    this.state = back;
    this.safetyHoldReason = null;
    this.pausedFromState = null;
    this.resumeActiveTimers(nowMs);
    const block = this.currentBlock();
    this.feedback = { message: block?.instructions ?? null, encouragement: null };
  }

  /** Auto-triggered path — e.g. compensationCleared or a brief trackerReady within grace. */
  private resumeFromSafetyHold(nowMs: number): void {
    if (this.state !== "safetyHold") return;
    this.unwindToPreviousState(nowMs);
  }

  // ── Patient-initiated pause/resume, distinct from safetyHold ────────

  pause(nowMs: number): void {
    if (!PAUSABLE_FROM_STATES.includes(this.state)) return;
    this.pauseActiveTimers(nowMs);
    this.pausedFromState = this.state;
    this.state = "paused";
    this.feedback = { message: "Paused.", encouragement: null };
  }

  /**
   * The single public "make the session progress again" entry point —
   * handles both a patient-initiated pause and any safetyHold (including
   * a pain-reported one, which never auto-clears from an event and
   * requires exactly this explicit call).
   */
  resume(nowMs: number): void {
    if (this.state !== "paused" && this.state !== "safetyHold") return;
    this.unwindToPreviousState(nowMs);
  }

  requestSafetyStop(nowMs: number): void {
    this.finishSession(nowMs, "stopped");
  }

  private pauseActiveTimers(nowMs: number): void {
    if (this.sessionTimer) pausePausableTimer(this.sessionTimer, nowMs);
    if (this.blockTimer) pausePausableTimer(this.blockTimer, nowMs);
    if (this.restTimer) pausePausableTimer(this.restTimer, nowMs);
  }

  private resumeActiveTimers(nowMs: number): void {
    if (this.sessionTimer) resumePausableTimer(this.sessionTimer, nowMs);
    if (this.blockTimer) resumePausableTimer(this.blockTimer, nowMs);
    if (this.restTimer) resumePausableTimer(this.restTimer, nowMs);
  }

  // ── Read-only helpers ────────────────────────────────────────────────

  private currentBlock(): MovementBlock | null {
    if (this.currentBlockIndex === null) return null;
    return this.definition.blocks[this.currentBlockIndex] ?? null;
  }

  private blockElapsedSeconds(nowMs: number): number {
    return this.blockTimer ? pausableTimerElapsedMs(this.blockTimer, nowMs) / 1_000 : 0;
  }

  private restRemainingSecondsRaw(nowMs: number): number {
    const block = this.currentBlock();
    if (!this.restTimer || !block || block.restAfterSeconds === undefined) return 0;
    const elapsedS = pausableTimerElapsedMs(this.restTimer, nowMs) / 1_000;
    return block.restAfterSeconds - elapsedS;
  }

  /**
   * Reflects whatever has accumulated in the current block so far —
   * keyed off `currentBlockResult` existing, not the literal current
   * state. Progress must not regress just because the session is
   * currently "paused" or on "safetyHold": both freeze the underlying
   * timers/counters (they don't reset them), so the fraction already
   * earned stays earned.
   */
  private computeBlockProgress(block: MovementBlock | null, blockElapsedS: number): number {
    if (!block) return 0;
    if (this.state === "resting" || this.state === "transitioning") return 1;
    if (!this.currentBlockResult) return 0;
    if (block.completionMode === "duration" && block.targetDurationSeconds) {
      return Math.min(1, blockElapsedS / block.targetDurationSeconds);
    }
    if (block.completionMode === "validRepetitions" && block.prescribedRepetitions) {
      const done = this.currentBlockResult.measured.validRepetitions;
      return Math.min(1, done / block.prescribedRepetitions);
    }
    if (block.completionMode === "holdDuration" && block.prescribedHoldSeconds) {
      const held = this.currentBlockResult.measured.holdDurationSeconds ?? 0;
      return Math.min(1, held / block.prescribedHoldSeconds);
    }
    // clinicianDefined / manualCompletion have no intrinsic progress metric in this version.
    return 0;
  }

  private computeSessionProgress(block: MovementBlock | null, blockElapsedS: number): number {
    const total = this.definition.blocks.length;
    if (total === 0) return 0;
    if (this.state === "completed") return 1;
    const completedCount = this.blockResults.length;
    const currentFraction = this.currentBlockResult ? this.computeBlockProgress(block, blockElapsedS) : 0;
    return Math.min(1, (completedCount + currentFraction) / total);
  }

  private computeTransitionState(): TransitionState {
    if (this.state === "transitioning") return "enteringBlock";
    return "none";
  }

  private computeSafetyStatus(): SafetyStatus {
    if (this.state === "safetyHold") return "hold";
    if (this.state === "stopped") return "stopped";
    return "normal";
  }

  getSnapshot(nowMs: number): SessionOrchestratorSnapshot {
    const block = this.currentBlock();
    const sessionElapsedS = this.sessionTimer ? pausableTimerElapsedMs(this.sessionTimer, nowMs) / 1_000 : 0;
    const blockElapsedS = this.blockElapsedSeconds(nowMs);
    const restRemaining = this.state === "resting" ? Math.max(0, this.restRemainingSecondsRaw(nowMs)) : null;

    return {
      sessionState: this.state,
      currentBlockIndex: this.currentBlockIndex,
      currentBlock: block,
      currentInstruction: this.feedback.message,
      blockElapsedSeconds: blockElapsedS,
      sessionElapsedSeconds: sessionElapsedS,
      blockProgress: this.computeBlockProgress(block, blockElapsedS),
      sessionProgress: this.computeSessionProgress(block, blockElapsedS),
      restRemainingSeconds: restRemaining,
      transitionState: this.computeTransitionState(),
      isPaused: this.state === "paused",
      safetyStatus: this.computeSafetyStatus(),
      safetyHoldReason: this.safetyHoldReason,
      patientFeedbackState: this.feedback,
      accumulatedBlockResults: this.currentBlockResult
        ? [...this.blockResults, this.currentBlockResult]
        : [...this.blockResults],
    };
  }

  getSessionPerformanceSummary(nowMs: number): SessionPerformanceSummary {
    const sessionElapsedS = this.sessionTimer ? pausableTimerElapsedMs(this.sessionTimer, nowMs) / 1_000 : 0;
    return {
      sessionState: this.state,
      totalElapsedSeconds: sessionElapsedS,
      blocksCompleted: this.blockResults.length,
      blocksTotal: this.definition.blocks.length,
      blockResults: [...this.blockResults],
    };
  }
}
