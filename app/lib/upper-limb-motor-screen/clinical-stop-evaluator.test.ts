/**
 * Run: npx tsx --test app/lib/upper-limb-motor-screen/clinical-stop-evaluator.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as ClinicalStopEvaluatorModule from "@/app/lib/upper-limb-motor-screen/clinical-stop-evaluator";
import { evaluateClinicalStop } from "@/app/lib/upper-limb-motor-screen/clinical-stop-evaluator";
import { CLINICAL_STOP_REASONS } from "@/app/lib/upper-limb-motor-screen/types";

const FIXED_NOW = () => "2026-07-30T12:00:00.000Z";

describe("evaluateClinicalStop — reasons produce reviewRequired true", () => {
  for (const reason of CLINICAL_STOP_REASONS) {
    it(`sets reviewRequired true for reason "${reason}"`, () => {
      const result = evaluateClinicalStop({ reason, recordedBy: "clinician", now: FIXED_NOW });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.event.reviewRequired, true);
        assert.equal(result.event.reason, reason);
      }
    });
  }

  it("rejects an unrecognized reason", () => {
    const result = evaluateClinicalStop({
      reason: "patient_looked_uncomfortable",
      recordedBy: "clinician",
      now: FIXED_NOW,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_reason");
  });
});

describe("evaluateClinicalStop — only an allowed human actor can record a stop", () => {
  it("accepts patient, clinician, and caregiver as recordedBy", () => {
    for (const recordedBy of ["patient", "clinician", "caregiver"] as const) {
      const result = evaluateClinicalStop({
        reason: "patient_requested_stop",
        recordedBy,
        now: FIXED_NOW,
      });
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.event.recordedBy, recordedBy);
    }
  });

  it("rejects 'system' as recordedBy", () => {
    const result = evaluateClinicalStop({
      reason: "patient_requested_stop",
      recordedBy: "system",
      now: FIXED_NOW,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_recorded_by");
  });

  it("rejects 'cv_detector' as recordedBy", () => {
    const result = evaluateClinicalStop({
      reason: "patient_requested_stop",
      recordedBy: "cv_detector",
      now: FIXED_NOW,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_recorded_by");
  });
});

describe("evaluateClinicalStop — cannot be produced from raw CV tracking loss", () => {
  it("has no reason value representing tracking loss, occlusion, or camera signal", () => {
    const trackingLossShapedReasons = [
      "tracking_loss",
      "landmark_lost",
      "pose_lost",
      "insufficient_tracking_quality",
      "significant_occlusion",
    ];
    for (const reason of trackingLossShapedReasons) {
      assert.equal(
        (CLINICAL_STOP_REASONS as readonly string[]).includes(reason),
        false,
        `${reason} must never be a valid clinical-stop reason`,
      );
    }
  });

  it("rejects an attempt to report a stop using a tracking-loss-shaped reason", () => {
    const result = evaluateClinicalStop({
      reason: "tracking_loss",
      recordedBy: "clinician",
      now: FIXED_NOW,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_reason");
  });

  it("exposes no function that clears or resolves a clinical stop", () => {
    const exportNames = Object.keys(ClinicalStopEvaluatorModule).map((name) => name.toLowerCase());
    assert.equal(exportNames.some((name) => name.includes("clear") || name.includes("resolve")), false);
  });
});

describe("evaluateClinicalStop — recordedAt", () => {
  it("stamps recordedAt from the injected clock", () => {
    const result = evaluateClinicalStop({
      reason: "chest_pain",
      recordedBy: "clinician",
      now: FIXED_NOW,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.event.recordedAt, "2026-07-30T12:00:00.000Z");
  });

  it("defaults to a real timestamp when no clock is injected", () => {
    const before = Date.now();
    const result = evaluateClinicalStop({ reason: "chest_pain", recordedBy: "clinician" });
    const after = Date.now();
    assert.equal(result.ok, true);
    if (result.ok) {
      const recordedAtMs = new Date(result.event.recordedAt).getTime();
      assert.ok(recordedAtMs >= before && recordedAtMs <= after);
    }
  });
});
