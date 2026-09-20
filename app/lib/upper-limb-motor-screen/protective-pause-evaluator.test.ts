/**
 * Run: npx tsx --test app/lib/upper-limb-motor-screen/protective-pause-evaluator.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateProtectivePause,
  isConfiguredLimitProtectivePause,
  isTrackingOrEnvironmentProtectivePause,
} from "@/app/lib/upper-limb-motor-screen/protective-pause-evaluator";
import { isCompletionStateConsistentWithEvents } from "@/app/lib/upper-limb-motor-screen/types";

const TRACKING_REASON = {
  category: "tracking_or_environment",
  detail: "wrist_landmark_lost",
} as const;

const CONFIGURED_LIMIT_REASON = {
  category: "configured_limit",
  detail: "configured_limit_exceeded",
} as const;

describe("evaluateProtectivePause — configured_limit_exceeded remains a protective pause", () => {
  it("produces a ProtectivePauseEvent, not a clinical stop, for configured_limit_exceeded", () => {
    const result = evaluateProtectivePause({
      reason: CONFIGURED_LIMIT_REASON,
      startedAtMs: 1000,
      endedAtMs: 2000,
      outcome: "session_ended_while_paused",
      readinessConfirmedAt: null,
      resumedBy: null,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.event.reason.category, "configured_limit");
      assert.equal(isConfiguredLimitProtectivePause(result.event), true);
      assert.equal(isTrackingOrEnvironmentProtectivePause(result.event), false);
      // Structurally a ProtectivePauseEvent — no reviewRequired/recordedBy fields exist on this shape.
      assert.equal("reviewRequired" in result.event, false);
      assert.equal("recordedBy" in result.event, false);
    }
  });

  it("categorizes tracking_or_environment and configured_limit distinguishably", () => {
    const trackingResult = evaluateProtectivePause({
      reason: TRACKING_REASON,
      startedAtMs: 0,
      endedAtMs: 500,
      outcome: "session_ended_while_paused",
      readinessConfirmedAt: null,
      resumedBy: null,
    });
    assert.equal(trackingResult.ok, true);
    if (trackingResult.ok) {
      assert.equal(isTrackingOrEnvironmentProtectivePause(trackingResult.event), true);
      assert.equal(isConfiguredLimitProtectivePause(trackingResult.event), false);
    }
  });
});

describe("evaluateProtectivePause — resume requires readiness confirmation and a human actor", () => {
  it("rejects a resume outcome without readinessConfirmedAt", () => {
    const result = evaluateProtectivePause({
      reason: TRACKING_REASON,
      startedAtMs: 0,
      endedAtMs: 500,
      outcome: "resumed",
      readinessConfirmedAt: null,
      resumedBy: "clinician",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "readiness_confirmation_required_for_resume");
  });

  it("rejects a resume outcome without resumedBy", () => {
    const result = evaluateProtectivePause({
      reason: TRACKING_REASON,
      startedAtMs: 0,
      endedAtMs: 500,
      outcome: "resumed",
      readinessConfirmedAt: "2026-07-30T12:00:00.000Z",
      resumedBy: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "resumed_by_required_for_resume");
  });

  it("rejects 'system' as resumedBy even with readiness confirmed", () => {
    const result = evaluateProtectivePause({
      reason: TRACKING_REASON,
      startedAtMs: 0,
      endedAtMs: 500,
      outcome: "resumed",
      readinessConfirmedAt: "2026-07-30T12:00:00.000Z",
      resumedBy: "system",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_resumed_by");
  });

  it("accepts a resume with both readiness confirmation and a valid human actor", () => {
    for (const resumedBy of ["patient", "clinician", "supervisor"] as const) {
      const result = evaluateProtectivePause({
        reason: TRACKING_REASON,
        startedAtMs: 0,
        endedAtMs: 500,
        outcome: "resumed",
        readinessConfirmedAt: "2026-07-30T12:00:00.000Z",
        resumedBy,
      });
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.event.resumedBy, resumedBy);
    }
  });

  it("does not require readiness confirmation for a non-resume outcome", () => {
    const escalated = evaluateProtectivePause({
      reason: CONFIGURED_LIMIT_REASON,
      startedAtMs: 0,
      endedAtMs: 500,
      outcome: "escalated_to_clinical_stop",
      readinessConfirmedAt: null,
      resumedBy: null,
    });
    assert.equal(escalated.ok, true);

    const sessionEnded = evaluateProtectivePause({
      reason: TRACKING_REASON,
      startedAtMs: 0,
      endedAtMs: 500,
      outcome: "session_ended_while_paused",
      readinessConfirmedAt: null,
      resumedBy: null,
    });
    assert.equal(sessionEnded.ok, true);
  });
});

describe("evaluateProtectivePause — escalation never itself creates a clinical stop", () => {
  it("produces only a ProtectivePauseEvent with outcome escalated_to_clinical_stop, no ClinicalStopEvent fields", () => {
    const result = evaluateProtectivePause({
      reason: CONFIGURED_LIMIT_REASON,
      startedAtMs: 0,
      endedAtMs: 500,
      outcome: "escalated_to_clinical_stop",
      readinessConfirmedAt: null,
      resumedBy: null,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.event.outcome, "escalated_to_clinical_stop");
      assert.equal("reviewRequired" in result.event, false);
    }
  });
});

describe("protective pauses do not directly determine attempt completion state", () => {
  it("a resolved protective pause alone is consistent with any completion state, including not_assessable", () => {
    const result = evaluateProtectivePause({
      reason: TRACKING_REASON,
      startedAtMs: 0,
      endedAtMs: 500,
      outcome: "session_ended_while_paused",
      readinessConfirmedAt: null,
      resumedBy: null,
    });
    assert.equal(result.ok, true);

    // No completion-state field exists on ProtectivePauseEvent or on the evaluator's
    // input/output — the pause carries no ability to set completion state at all.
    if (result.ok) {
      assert.equal("completionState" in result.event, false);
    }

    assert.equal(
      isCompletionStateConsistentWithEvents({
        completionState: "completed",
        hasClinicalStop: false,
        hasRuntimeInterruption: false,
      }),
      true,
    );
    assert.equal(
      isCompletionStateConsistentWithEvents({
        completionState: "not_assessable",
        hasClinicalStop: false,
        hasRuntimeInterruption: false,
      }),
      true,
    );
  });
});

describe("evaluateProtectivePause — invalid reason", () => {
  it("rejects a reason with an unknown category", () => {
    const result = evaluateProtectivePause({
      reason: { category: "clinical", detail: "chest_pain" },
      startedAtMs: 0,
      endedAtMs: 500,
      outcome: "session_ended_while_paused",
      readinessConfirmedAt: null,
      resumedBy: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_reason");
  });

  it("rejects a configured_limit reason with a mismatched detail", () => {
    const result = evaluateProtectivePause({
      reason: { category: "configured_limit", detail: "insufficient_tracking_quality" },
      startedAtMs: 0,
      endedAtMs: 500,
      outcome: "session_ended_while_paused",
      readinessConfirmedAt: null,
      resumedBy: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_reason");
  });
});

describe("evaluateProtectivePause — invalid outcome", () => {
  it("rejects an outcome value outside the approved set", () => {
    const result = evaluateProtectivePause({
      reason: TRACKING_REASON,
      startedAtMs: 0,
      endedAtMs: 500,
      outcome: "cancelled",
      readinessConfirmedAt: null,
      resumedBy: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_outcome");
  });

  it("rejects a missing outcome", () => {
    const result = evaluateProtectivePause({
      reason: TRACKING_REASON,
      startedAtMs: 0,
      endedAtMs: 500,
      outcome: undefined,
      readinessConfirmedAt: null,
      resumedBy: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_outcome");
  });
});
