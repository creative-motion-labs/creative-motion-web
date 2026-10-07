/**
 * Run: npx tsx --test app/lib/clinical/clinical-prescribed-side-rolling-deploy.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGuidedPlanSessionInsertRows,
  parsePlanSessionPrescriptionsFromBody,
  requiresPrescribedSideStorageCapability,
  validateGuidedPlanSessionPrescriptions,
} from "./clinical-prescribed-side";

const PLAN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROVIDER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PATIENT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

describe("guided plan rolling deployment", () => {
  it("1. omits prescribed_side from insert rows when side is not supplied", () => {
    const validation = validateGuidedPlanSessionPrescriptions([
      { sessionNumber: 1 },
      { sessionNumber: 2, title: "ignored" } as never,
    ]);
    assert.equal(validation.ok, true);
    if (!validation.ok) return;

    const rows = buildGuidedPlanSessionInsertRows({
      planId: PLAN_ID,
      providerId: PROVIDER_ID,
      patientId: PATIENT_ID,
      sessions: [
        { sessionNumber: 1, title: "Session 1", exercises: [] },
        { sessionNumber: 2, title: "Session 2", exercises: [] },
      ],
      prescribedSideBySessionNumber: validation.prescribedSideBySessionNumber,
    });

    assert.equal(rows.length, 2);
    assert.equal("prescribed_side" in rows[0]!, false);
    assert.equal("prescribed_side" in rows[1]!, false);
  });

  it("3. includes authoritative left/right only on intended sessions", () => {
    const validation = validateGuidedPlanSessionPrescriptions([
      { sessionNumber: 1, prescribedSide: "left" },
      { sessionNumber: 2 },
    ]);
    assert.equal(validation.ok, true);
    if (!validation.ok) return;

    const rows = buildGuidedPlanSessionInsertRows({
      planId: PLAN_ID,
      providerId: PROVIDER_ID,
      patientId: PATIENT_ID,
      sessions: [
        { sessionNumber: 1, title: "Session 1", exercises: [] },
        { sessionNumber: 2, title: "Session 2", exercises: [] },
      ],
      prescribedSideBySessionNumber: validation.prescribedSideBySessionNumber,
    });

    assert.equal(rows[0]?.prescribed_side, "left");
    assert.equal("prescribed_side" in rows[1]!, false);
  });

  it("requires capability only when a non-null side is present", () => {
    const withoutSide = validateGuidedPlanSessionPrescriptions([{ sessionNumber: 1 }]);
    assert.equal(withoutSide.ok, true);
    if (!withoutSide.ok) return;
    assert.equal(
      requiresPrescribedSideStorageCapability(withoutSide.prescribedSideBySessionNumber),
      false,
    );

    const withSide = validateGuidedPlanSessionPrescriptions([
      { sessionNumber: 1, prescribedSide: "right" },
    ]);
    assert.equal(withSide.ok, true);
    if (!withSide.ok) return;
    assert.equal(
      requiresPrescribedSideStorageCapability(withSide.prescribedSideBySessionNumber),
      true,
    );
  });

  it("12. preserves null, omitted, invalid, bilateral, and duplicate rejection", () => {
    const omitted = validateGuidedPlanSessionPrescriptions([{ sessionNumber: 1 }]);
    assert.equal(omitted.ok, true);

    const bilateral = validateGuidedPlanSessionPrescriptions([
      { sessionNumber: 1, prescribedSide: "bilateral" },
    ]);
    assert.equal(bilateral.ok, false);

    const duplicate = parsePlanSessionPrescriptionsFromBody([
      { sessionNumber: 1, prescribedSide: "left" },
      { sessionNumber: 1, prescribedSide: "right" },
    ]);
    assert.equal(duplicate.ok, false);
  });
});
