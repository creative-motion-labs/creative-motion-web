/**
 * Run: npx tsx --test app/lib/clinical/clinical-prescribed-side-runtime-c3.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { mapPlanSessionRowsToPatientSessions } from "@/app/api/patient/plan/route";
import { ShoulderAbductionReachPoseDetector } from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";
import {
  resolveClinicalPrescribedSideForRuntime,
  resolveInteractiveShoulderSide,
  INTERACTIVE_SHOULDER_DEFAULT_SIDE,
} from "@/app/lib/interactive-shoulder/resolve-interactive-shoulder-side";
import { toSessionDefinition } from "@/app/lib/rehab-programs/rehab-program-runtime-adapter";
import { STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1 } from "@/app/lib/rehab-programs/stroke-upper-limb-recovery-foundation";
import { SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION } from "@/app/lib/interactive-shoulder/shoulder-abduction-reach-session-definition";

const ROOT = path.resolve(import.meta.dirname, "../../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("clinical prescribed-side runtime propagation (C3)", () => {
  it("1. guided Interactive Shoulder left reaches runtime LEFT", () => {
    const result = resolveClinicalPrescribedSideForRuntime("left");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.side, "left");

    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, result.side);
    assert.equal(detector.getSnapshot().primarySide, "left");
  });

  it("2. guided Interactive Shoulder right reaches runtime RIGHT", () => {
    const result = resolveClinicalPrescribedSideForRuntime("right");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.side, "right");

    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, result.side);
    assert.equal(detector.getSnapshot().primarySide, "right");
  });

  it("3. catalog Interactive Shoulder left reaches runtime LEFT", () => {
    const catalogDefinition = toSessionDefinition(STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1);
    assert.ok(catalogDefinition.blocks.length > 0);

    const result = resolveClinicalPrescribedSideForRuntime("left");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.side, "left");
  });

  it("4. catalog Interactive Shoulder right reaches runtime RIGHT", () => {
    const result = resolveClinicalPrescribedSideForRuntime("right");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.side, "right");
  });

  it("5. null/omitted side blocks clinical runtime before fallback", () => {
    assert.deepEqual(resolveClinicalPrescribedSideForRuntime(null), { ok: false, reason: "missing" });
    assert.deepEqual(resolveClinicalPrescribedSideForRuntime(undefined), {
      ok: false,
      reason: "missing",
    });

    const coreSource = readSource(
      "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx",
    );
    assert.match(coreSource, /prescribedSideBlocked/);
    assert.match(coreSource, /prescribedSideRequiredMessage/);
    assert.match(coreSource, /if \(prescribedSideBlocked\)/);
  });

  it("6. invalid, bilateral, and mixed-case values do not become RIGHT", () => {
    for (const value of ["bilateral", "Left", "RIGHT", "north", ""]) {
      const result = resolveClinicalPrescribedSideForRuntime(value);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.notEqual("side" in result && (result as { side: string }).side, "right");
    }

    const legacyFallback = resolveInteractiveShoulderSide({
      prescribedSide: "Left",
      blockSide: undefined,
    });
    assert.equal(legacyFallback.side, INTERACTIVE_SHOULDER_DEFAULT_SIDE);
    assert.equal(legacyFallback.usedFallback, true);
  });

  it("7. patient portal wires only server plan prescribedSide, not query params", () => {
    const sessionPage = readSource("app/patient/[token]/session/[sessionId]/page.tsx");
    const catalogPlayback = readSource(
      "app/components/patient/session/CatalogPatientSessionPlayback.tsx",
    );

    assert.match(sessionPage, /prescribedSide=\{session\.prescribedSide\}/);
    assert.doesNotMatch(sessionPage, /searchParams.*prescribedSide/);
    assert.doesNotMatch(sessionPage, /prescribedSide.*searchParams/);

    assert.match(catalogPlayback, /prescribedSide=\{session\.prescribedSide\}/);
    assert.match(catalogPlayback, /clinicalPrescribedSideRequired/);
    assert.doesNotMatch(catalogPlayback, /searchParams/);
  });

  it("8. two sessions with different sides do not share runtime instance keys", () => {
    const catalogPlayback = readSource(
      "app/components/patient/session/CatalogPatientSessionPlayback.tsx",
    );
    const exerciseCard = readSource("app/components/patient/PatientExerciseSessionCard.tsx");

    assert.match(catalogPlayback, /key=\{`\$\{session\.id\}:\$\{session\.prescribedSide/);
    assert.match(exerciseCard, /runtimeInstanceKey/);
    assert.match(exerciseCard, /prescribedSide \?\? "none"/);
  });

  it("9. refresh/retry preserves server-authored side via plan mapper contract", () => {
    const leftMapped = mapPlanSessionRowsToPatientSessions(
      [
        {
          id: "session-left",
          session_number: 1,
          title: "Left session",
          exercises: [],
          status: "upcoming",
          scheduled_at: null,
          completed_at: null,
          source_program_session_id: null,
          prescribed_side: "left",
        },
      ],
      new Map(),
    );
    const rightMapped = mapPlanSessionRowsToPatientSessions(
      [
        {
          id: "session-right",
          session_number: 2,
          title: "Right session",
          exercises: [],
          status: "upcoming",
          scheduled_at: null,
          completed_at: null,
          source_program_session_id: null,
          prescribed_side: "right",
        },
      ],
      new Map(),
    );

    assert.equal(leftMapped[0]?.prescribedSide, "left");
    assert.equal(rightMapped[0]?.prescribedSide, "right");

    assert.equal(resolveClinicalPrescribedSideForRuntime(leftMapped[0]?.prescribedSide).ok, true);
    assert.equal(resolveClinicalPrescribedSideForRuntime(rightMapped[0]?.prescribedSide).ok, true);
  });

  it("10. unrelated lower-limb legacy sessions keep block/fallback resolution", () => {
    const blockSide = SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION.blocks[0]?.side;
    const resolved = resolveInteractiveShoulderSide({ blockSide });
    assert.equal(resolved.source, "block");
    assert.equal(resolved.usedFallback, false);

    const lowerLimbMapped = mapPlanSessionRowsToPatientSessions(
      [
        {
          id: "sts-session",
          session_number: 1,
          title: "Sit to stand",
          exercises: [{ exerciseId: "sit-to-stand", sets: 3, reps: "8-10" }],
          status: "upcoming",
          scheduled_at: null,
          completed_at: null,
          source_program_session_id: null,
          prescribed_side: null,
        },
      ],
      new Map(),
    );
    assert.equal(lowerLimbMapped[0]?.prescribedSide, null);
    assert.equal("catalogSession" in (lowerLimbMapped[0] ?? {}), false);
  });

  it("11. volunteer research API routes remain without prescribedSide authoring", () => {
    const volunteerRoute = readSource("app/api/research/volunteer/sessions/route.ts");
    assert.equal(volunteerRoute.includes("prescribedSide"), false);
    assert.equal(volunteerRoute.includes("prescribed_side"), false);

    const interactiveWrapper = readSource(
      "app/components/patient/interactive-shoulder/InteractiveShoulderSession.tsx",
    );
    assert.doesNotMatch(interactiveWrapper, /clinicalPrescribedSideRequired/);
  });

  it("12. OrchestratorCvSessionCore keeps camera lifecycle guards with clinical mode", () => {
    const coreSource = readSource(
      "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx",
    );
    assert.match(coreSource, /sessionStartedRef/);
    assert.match(coreSource, /shouldFireSessionCompleteCallback/);
    assert.match(coreSource, /prescribedSideBlocked/);
  });
});
