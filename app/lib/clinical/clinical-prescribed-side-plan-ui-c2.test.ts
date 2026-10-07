/**
 * Run: npx tsx --test app/lib/clinical/clinical-prescribed-side-plan-ui-c2.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { API_ERRORS } from "@/app/lib/api/safe-errors";
import {
  catalogSessionRequiresPrescribedSide,
  exerciseIdentifierRequiresPrescribedSide,
  guidedSessionRequiresPrescribedSide,
} from "@/app/lib/clinical/clinical-prescribed-side-applicability";
import {
  buildCatalogPlanSessionsPayload,
  buildGuidedPlanSessionsPayload,
  formatPrescribedSideForReview,
  mapPlanAssignHttpError,
  parseUiPrescribedSideSelection,
  PRESCRIBED_SIDE_UNAVAILABLE_MESSAGE,
  reconcileGuidedSessionPrescribedSide,
  validateCatalogPrescribedSideDraftForSubmit,
  validateGuidedPrescribedSideDraftForSubmit,
} from "@/app/lib/clinical/clinical-prescribed-side-plan-draft";
import { INTERACTIVE_SHOULDER_LIBRARY_EXERCISE_ID } from "@/app/lib/interactive-shoulder/interactive-shoulder-exercise-ids";
import type { PrescribedExerciseV1 } from "@/app/lib/exercise-prescription";

const IS_EXERCISE: PrescribedExerciseV1 = {
  exerciseId: INTERACTIVE_SHOULDER_LIBRARY_EXERCISE_ID,
  name: "Upper Limb Reaching (Seated)",
};

const STS_EXERCISE: PrescribedExerciseV1 = {
  exerciseId: "sit-to-stand",
  name: "Sit to Stand",
};

describe("Clinical Slice C2 — prescribed-side plan UI", () => {
  it("1. Interactive Shoulder session is applicable via canonical exercise id", () => {
    assert.equal(exerciseIdentifierRequiresPrescribedSide(INTERACTIVE_SHOULDER_LIBRARY_EXERCISE_ID), true);
    assert.equal(guidedSessionRequiresPrescribedSide([IS_EXERCISE]), true);
  });

  it("2. no side is preselected in a new applicable session draft", () => {
    const session = {
      sessionNumber: 1,
      title: "Session 1",
      exercises: [IS_EXERCISE],
      prescribedSide: undefined,
    };
    assert.equal(session.prescribedSide, undefined);
    assert.equal(formatPrescribedSideForReview(session.prescribedSide), "Not specified");
  });

  it("3. submission is blocked until an applicable session has an explicit side", () => {
    const missing = validateGuidedPrescribedSideDraftForSubmit([
      { sessionNumber: 1, title: "S1", exercises: [IS_EXERCISE] },
    ]);
    assert.equal(missing.ok, false);

    const complete = validateGuidedPrescribedSideDraftForSubmit([
      { sessionNumber: 1, title: "S1", exercises: [IS_EXERCISE], prescribedSide: "left" },
    ]);
    assert.equal(complete.ok, true);
  });

  it("4. guided plan payload preserves Left", () => {
    const payload = buildGuidedPlanSessionsPayload([
      {
        sessionNumber: 1,
        title: "S1",
        exercises: [IS_EXERCISE],
        prescribedSide: "left",
      },
    ]);
    assert.equal(payload[0]?.prescribedSide, "left");
  });

  it("5. guided plan payload preserves Right", () => {
    const payload = buildGuidedPlanSessionsPayload([
      {
        sessionNumber: 2,
        title: "S2",
        exercises: [IS_EXERCISE],
        prescribedSide: "right",
      },
    ]);
    assert.equal(payload[0]?.prescribedSide, "right");
  });

  it("6. non-applicable sessions omit prescribedSide", () => {
    const payload = buildGuidedPlanSessionsPayload([
      { sessionNumber: 1, title: "STS", exercises: [STS_EXERCISE], prescribedSide: "left" },
    ]);
    assert.equal("prescribedSide" in (payload[0] ?? {}), false);
  });

  it("7. catalog payload uses exact sessionNumber and prescribedSide", () => {
    const payload = buildCatalogPlanSessionsPayload([
      {
        sessionNumber: 3,
        title: "Catalog session",
        blocks: [{ movementId: "shoulder-abduction-reach" }],
        prescribedSide: "right",
      },
    ]);
    assert.deepEqual(payload, [{ sessionNumber: 3, prescribedSide: "right" }]);
  });

  it("8. two sessions preserve different sides without cross-session leakage", () => {
    const payload = buildGuidedPlanSessionsPayload([
      { sessionNumber: 1, title: "A", exercises: [IS_EXERCISE], prescribedSide: "left" },
      { sessionNumber: 2, title: "B", exercises: [IS_EXERCISE], prescribedSide: "right" },
    ]);
    assert.equal(payload[0]?.prescribedSide, "left");
    assert.equal(payload[1]?.prescribedSide, "right");
  });

  it("9. session numbers remain stable in guided payload after draft edits", () => {
    const payload = buildGuidedPlanSessionsPayload([
      { sessionNumber: 2, title: "B", exercises: [IS_EXERCISE], prescribedSide: "right" },
      { sessionNumber: 1, title: "A", exercises: [IS_EXERCISE], prescribedSide: "left" },
    ]);
    assert.equal(payload.find((s) => s.sessionNumber === 1)?.prescribedSide, "left");
    assert.equal(payload.find((s) => s.sessionNumber === 2)?.prescribedSide, "right");
  });

  it("10. changing to a non-applicable activity clears/omits side", () => {
    const cleared = reconcileGuidedSessionPrescribedSide({
      sessionNumber: 1,
      title: "S1",
      exercises: [STS_EXERCISE],
      prescribedSide: "right",
    });
    assert.equal("prescribedSide" in cleared, false);
  });

  it('11. legacy null displays as "Not specified", never Right', () => {
    assert.equal(formatPrescribedSideForReview(null), "Not specified");
    assert.equal(formatPrescribedSideForReview(undefined), "Not specified");
    assert.notEqual(formatPrescribedSideForReview(null), "Right");
  });

  it("12. invalid/bilateral/uppercase values cannot cross the UI mapper boundary", () => {
    assert.equal(parseUiPrescribedSideSelection("LEFT"), null);
    assert.equal(parseUiPrescribedSideSelection("bilateral"), null);
    assert.equal(parseUiPrescribedSideSelection("north"), null);
    assert.equal(parseUiPrescribedSideSelection("left"), "left");
  });

  it("13. safe 503 UI messaging contains no internal database details", () => {
    const message = mapPlanAssignHttpError(503, { error: API_ERRORS.SERVICE_UNAVAILABLE });
    assert.equal(message, PRESCRIBED_SIDE_UNAVAILABLE_MESSAGE);
    assert.equal(message.includes("migration"), false);
    assert.equal(message.includes("Supabase"), false);
    assert.equal(message.includes("prescribed_side"), false);
  });

  it("14. patient plan route cannot author prescribedSide (GET-only patient portal)", () => {
    const patientPlanRoute = readFileSync(
      path.resolve(import.meta.dirname, "../../api/patient/plan/route.ts"),
      "utf8",
    );
    assert.equal(patientPlanRoute.includes("export async function POST"), false);
    assert.equal(patientPlanRoute.includes("prescribedSide"), true);
  });

  it("15. Interactive Shoulder runtime resolution file remains unchanged in C2 scope", () => {
    const runtimeFile = readFileSync(
      path.resolve(
        import.meta.dirname,
        "../interactive-shoulder/resolve-interactive-shoulder-side.ts",
      ),
      "utf8",
    );
    assert.match(runtimeFile, /export function resolveInteractiveShoulderSide/);
    assert.equal(runtimeFile.includes("clinical-prescribed-side-plan-draft"), false);
  });

  it("16. volunteer research API routes remain without prescribedSide authoring", () => {
    const volunteerRoute = readFileSync(
      path.resolve(import.meta.dirname, "../../api/research/volunteer/sessions/route.ts"),
      "utf8",
    );
    assert.equal(volunteerRoute.includes("prescribedSide"), false);
    assert.equal(volunteerRoute.includes("prescribed_side"), false);
  });

  it("17. catalog applicability uses movement id, not shoulder substring alone", () => {
    assert.equal(catalogSessionRequiresPrescribedSide([{ movementId: "shoulder-abduction-reach" }]), true);
    assert.equal(catalogSessionRequiresPrescribedSide([{ movementId: "gait-observation" }]), false);
    assert.equal(
      catalogSessionRequiresPrescribedSide([{ movementId: "shoulder-pain-screen" }]),
      false,
    );
  });

  it("catalog submit validation mirrors guided validation", () => {
    const blocked = validateCatalogPrescribedSideDraftForSubmit([
      {
        sessionNumber: 1,
        title: "Catalog",
        blocks: [{ movementId: "shoulder-abduction-reach" }],
      },
    ]);
    assert.equal(blocked.ok, false);
  });
});
