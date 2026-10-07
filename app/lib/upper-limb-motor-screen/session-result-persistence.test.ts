/**
 * Run:
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/lib/upper-limb-motor-screen/session-result-persistence.test.ts"
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildUpperLimbMotorScreenSessionResultInsert,
  toUpperLimbMotorScreenSessionResultPublic,
  validateFinalizeAccess,
} from "./session-result-persistence";
import { UPPER_LIMB_MOTOR_SCREEN_SCHEMA_VERSION } from "./schema-version";
import type { UpperLimbMotorScreenSessionResult } from "./types";
import type { UpperLimbMotorScreenSessionResultsRow } from "@/app/lib/supabase/database.types";

const RESULT: UpperLimbMotorScreenSessionResult = {
  id: "session-result-1",
  assignmentId: "assignment-1",
  status: "computed",
  taskCompletion: [{ taskId: "lateralReach", testedSide: "right", completionState: "completed" }],
  attempts: [],
  technicalTrackingQuality: {
    overallQuality: "good",
    protectivePauseCount: 1,
    protectivePauseDurationMsTotal: 500,
    longestPauseGapMs: 0,
  },
  interruptions: { clinicalStopEvents: [], protectivePauseEvents: [] },
  observedMovementFeatures: { trunkCompensationObserved: null, asymmetryNotes: [] },
};

function baseRow(overrides: Partial<UpperLimbMotorScreenSessionResultsRow> = {}): UpperLimbMotorScreenSessionResultsRow {
  return {
    id: RESULT.id,
    assignment_id: RESULT.assignmentId,
    provider_id: "provider-1",
    patient_id: "patient-1",
    status: "computed",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result_payload: RESULT as any,
    overall_quality: "good",
    protective_pause_count: 1,
    protective_pause_duration_ms_total: 500,
    schema_version: UPPER_LIMB_MOTOR_SCREEN_SCHEMA_VERSION,
    created_at: "2026-08-17T10:00:00.000Z",
    updated_at: "2026-08-17T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildUpperLimbMotorScreenSessionResultInsert", () => {
  it("builds a row matching 019's typed-projection columns", () => {
    const row = buildUpperLimbMotorScreenSessionResultInsert({
      providerId: "provider-1",
      patientId: "patient-1",
      result: RESULT,
    });

    assert.equal(row.id, RESULT.id);
    assert.equal(row.assignment_id, RESULT.assignmentId);
    assert.equal(row.provider_id, "provider-1");
    assert.equal(row.patient_id, "patient-1");
    assert.equal(row.status, "computed");
    assert.equal(row.overall_quality, "good");
    assert.equal(row.protective_pause_count, 1);
    assert.equal(row.protective_pause_duration_ms_total, 500);
    assert.deepEqual(row.result_payload, RESULT);
    assert.equal(row.schema_version, UPPER_LIMB_MOTOR_SCREEN_SCHEMA_VERSION);
  });

  it("always builds status: computed — never accepts a caller-supplied status", () => {
    const row = buildUpperLimbMotorScreenSessionResultInsert({
      providerId: "provider-1",
      patientId: "patient-1",
      result: { ...RESULT, status: "computed" },
    });
    assert.equal(row.status, "computed");
  });

  it("typed projections mirror result_payload.technicalTrackingQuality exactly (019's payload CHECKs)", () => {
    const row = buildUpperLimbMotorScreenSessionResultInsert({
      providerId: "provider-1",
      patientId: "patient-1",
      result: RESULT,
    });
    assert.equal(row.overall_quality, row.result_payload.technicalTrackingQuality.overallQuality);
    assert.equal(
      row.protective_pause_count,
      row.result_payload.technicalTrackingQuality.protectivePauseCount,
    );
    assert.equal(
      row.protective_pause_duration_ms_total,
      row.result_payload.technicalTrackingQuality.protectivePauseDurationMsTotal,
    );
  });
});

describe("toUpperLimbMotorScreenSessionResultPublic", () => {
  it("maps a DB row back to the public response shape", () => {
    const publicRow = toUpperLimbMotorScreenSessionResultPublic(baseRow());
    assert.deepEqual(publicRow.sessionResult, RESULT);
    assert.equal(publicRow.assignmentId, RESULT.assignmentId);
    assert.equal(publicRow.patientId, "patient-1");
    assert.equal(publicRow.providerId, "provider-1");
  });
});

describe("validateFinalizeAccess", () => {
  it("rejects a missing row", () => {
    assert.deepEqual(validateFinalizeAccess(null, "provider-1"), {
      ok: false,
      httpStatus: 404,
      message: "Session result not found.",
    });
  });

  it("rejects a cross-provider row (never distinguished from missing)", () => {
    const result = validateFinalizeAccess(baseRow(), "provider-2");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.httpStatus, 404);
      assert.equal(result.message, "Session result not found.");
    }
  });

  it("rejects an already-finalized row with 409", () => {
    const result = validateFinalizeAccess(baseRow({ status: "finalized" }), "provider-1");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.httpStatus, 409);
  });

  it("allows a computed row owned by the provider", () => {
    const result = validateFinalizeAccess(baseRow(), "provider-1");
    assert.equal(result.ok, true);
  });
});
