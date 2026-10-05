/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-pnf-runtime-trace.test.ts
 *
 * Traces the production /demo orchestrator path (side resolution → block transition → wrist mirror).
 * Fixture-based; does not substitute for live-camera QA on a device.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE } from "@/app/lib/interactive-shoulder/motion-patterns/d1-inspired-diagonal-reach-pattern";
import {
  projectPointOntoPath,
  samplePathAtProgress,
} from "@/app/lib/interactive-shoulder/motion-patterns/bezier-path";
import { resolveActiveMotionPattern } from "@/app/lib/interactive-shoulder/motion-patterns/motion-pattern-registry";
import { resetRunnerStatesForBlockTransition } from "@/app/lib/interactive-shoulder/orchestrator-cv-block-dispatch";
import { toMirroredPreviewPoint } from "@/app/lib/interactive-shoulder/presentation-mirror";
import { resolveOrchestratorTherapeuticSide } from "@/app/lib/interactive-shoulder/resolve-interactive-shoulder-side";
import {
  RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE,
} from "./rasq-demo-d1-diagonal-reach-pattern";
import {
  RASQ_DEMO_PNF_D1_BLOCK_ID,
  RASQ_TWO_MINUTE_DEMO_SESSION,
} from "./demo-session-definition";
import {
  previewWristFromFacingCameraLandmarks,
  PNF_DEMO_START_LANDMARKS,
} from "./demo-pnf-presentation-fixtures";
import {
  PUBLIC_DEMO_PNF_PRESENTATION_SIDE,
  resolvePublicDemoPnfMotionPatternSide,
} from "./public-demo-pnf-path-resolution";

describe("/demo PNF runtime trace (production pipeline, fixture verification)", () => {
  const pnfBlock = RASQ_TWO_MINUTE_DEMO_SESSION.blocks.find(
    (b) => b.blockId === RASQ_DEMO_PNF_D1_BLOCK_ID,
  )!;

  it("resolves orchestrator therapeutic side right from demo blocks (not left)", () => {
    const resolved = resolveOrchestratorTherapeuticSide({
      prescribedSide: undefined,
      clinicalPrescribedSideRequired: false,
      blocks: RASQ_TWO_MINUTE_DEMO_SESSION.blocks,
    });
    assert.ok(resolved);
    assert.equal(resolved.side, "right");
    assert.equal(resolved.source, "block");
    assert.equal(resolved.usedFallback, false);
  });

  it("uses activeTherapeuticSide for block transition, not currentBlock.side override", () => {
    const corePath = join(
      process.cwd(),
      "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx",
    );
    const source = readFileSync(corePath, "utf8");
    assert.match(source, /side: activeTherapeuticSide/);
    assert.doesNotMatch(
      source,
      /currentBlock\.side === "left" \|\| currentBlock\.side === "right"/,
    );
  });

  it("production block transition: demo profile + side right → illustration-aligned path", () => {
    const transition = resetRunnerStatesForBlockTransition({
      block: pnfBlock,
      side: "right",
      motionPatternPresentationSide: resolvePublicDemoPnfMotionPatternSide({
        publicDemoActive: true,
        block: pnfBlock,
      }),
    });
    assert.equal(transition.fault, null);
    assert.ok(transition.activeMotionPattern);
    const wrist = previewWristFromFacingCameraLandmarks("right", PNF_DEMO_START_LANDMARKS);
    const projection = projectPointOntoPath(transition.activeMotionPattern!.sampledPath, wrist);
    assert.ok(projection.progress <= 0.22);
  });

  it("production wrist path: measured primary wrist → toMirroredPreviewPoint (OrchestratorCvSessionCore RAF)", () => {
    const measured = { x: 0.22, y: 0.68 };
    const preview = toMirroredPreviewPoint(measured);
    assert.deepEqual(preview, { x: 1 - measured.x, y: measured.y });
    const roundTripMeasured = { x: 1 - preview!.x, y: preview!.y };
    assert.deepEqual(toMirroredPreviewPoint(roundTripMeasured), preview);
  });

  it("hypothesis control: resolving demo profile with left x-mirrors path anchors (not used on /demo)", () => {
    const asRight = resolveActiveMotionPattern(RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE, "right")!;
    const asLeft = resolveActiveMotionPattern(RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE, "left")!;
    const rightStart = samplePathAtProgress(asRight.sampledPath, 0);
    const leftStart = samplePathAtProgress(asLeft.sampledPath, 0);
    assert.notEqual(rightStart.x, leftStart.x);
    assert.equal(rightStart.y, leftStart.y);
    assert.equal(leftStart.x, 1 - rightStart.x);
  });

  it("misconfiguration control: clinical profile on right-arm demo pose reads as reversed vs demo profile", () => {
    const demo = resolveActiveMotionPattern(RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE, "right")!;
    const clinical = resolveActiveMotionPattern(D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE, "right")!;
    const wrist = previewWristFromFacingCameraLandmarks("right", PNF_DEMO_START_LANDMARKS);
    const onDemo = projectPointOntoPath(demo.sampledPath, wrist);
    const onClinical = projectPointOntoPath(clinical.sampledPath, wrist);
    assert.ok(onDemo.progress <= 0.22);
    assert.ok(onClinical.progress > onDemo.progress);
  });

  it("public demo pins motion pattern presentation side to right-arm art", () => {
    assert.equal(
      resolvePublicDemoPnfMotionPatternSide({ publicDemoActive: true, block: pnfBlock }),
      PUBLIC_DEMO_PNF_PRESENTATION_SIDE,
    );
    const transition = resetRunnerStatesForBlockTransition({
      block: pnfBlock,
      side: "left",
      motionPatternPresentationSide: PUBLIC_DEMO_PNF_PRESENTATION_SIDE,
    });
    const pinned = transition.activeMotionPattern!;
    const asRight = resolveActiveMotionPattern(RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE, "right")!;
    assert.equal(
      projectPointOntoPath(pinned.sampledPath, { x: 0.7, y: 0.7 }).progress,
      projectPointOntoPath(asRight.sampledPath, { x: 0.7, y: 0.7 }).progress,
    );
  });
});
