/**
 * Run: npx tsx --test app/lib/interactive-shoulder/resolve-interactive-shoulder-side.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ShoulderAbductionReachPoseDetector } from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";
import { toSessionDefinition } from "@/app/lib/rehab-programs/rehab-program-runtime-adapter";
import { STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1 } from "@/app/lib/rehab-programs/stroke-upper-limb-recovery-foundation";
import type { MovementBlock } from "@/app/lib/session-orchestrator/types";
import { resolveActiveMotionPattern } from "./motion-patterns/motion-pattern-registry";
import { SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION } from "./shoulder-abduction-reach-session-definition";
import {
  INTERACTIVE_SHOULDER_DEFAULT_SIDE,
  resolveBlockSideFromSessionDefinition,
  resolveClinicalPrescribedSideForRuntime,
  resolveInteractiveShoulderSide,
  resolveOrchestratorTherapeuticSide,
} from "./resolve-interactive-shoulder-side";
import { createInitialTargetLifecycle, tickTargetLifecycle } from "./target-lifecycle";
import { DEFAULT_SAFE_TARGET_BOUNDS, resolveSideBiasedBounds } from "./target-generator";
import { resolveTargetLevelPosition } from "./adaptive/target-level-geometry";

function movementBlock(overrides: Partial<MovementBlock> & Pick<MovementBlock, "blockId">): MovementBlock {
  return {
    movementId: "shoulder-abduction-reach",
    movementVersion: "v1",
    title: "Movement",
    instructions: "Reach comfortably.",
    completionMode: "duration",
    supportedPositions: ["seated", "standing"],
    ...overrides,
  };
}

describe("resolveOrchestratorTherapeuticSide", () => {
  const blocks = toSessionDefinition(STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1).blocks;

  it("returns null in strict clinical mode when prescribed side is missing or invalid", () => {
    assert.equal(
      resolveOrchestratorTherapeuticSide({
        prescribedSide: null,
        clinicalPrescribedSideRequired: true,
        blocks,
      }),
      null,
    );
    assert.equal(
      resolveOrchestratorTherapeuticSide({
        prescribedSide: "Left",
        clinicalPrescribedSideRequired: true,
        blocks,
      }),
      null,
    );
  });

  it("does not call legacy fallback in strict clinical mode", () => {
    const resolved = resolveOrchestratorTherapeuticSide({
      prescribedSide: "bilateral",
      clinicalPrescribedSideRequired: true,
      blocks,
    });
    assert.equal(resolved, null);
  });
});

describe("resolveClinicalPrescribedSideForRuntime", () => {
  it("accepts exact left and right only", () => {
    assert.deepEqual(resolveClinicalPrescribedSideForRuntime("left"), {
      ok: true,
      side: "left",
      source: "prescribed",
    });
    assert.deepEqual(resolveClinicalPrescribedSideForRuntime("right"), {
      ok: true,
      side: "right",
      source: "prescribed",
    });
  });

  it("rejects null, invalid, and mixed-case without RIGHT fallback", () => {
    assert.equal(resolveClinicalPrescribedSideForRuntime(null).ok, false);
    assert.equal(resolveClinicalPrescribedSideForRuntime("Left").ok, false);
    assert.equal(resolveClinicalPrescribedSideForRuntime("bilateral").ok, false);
  });
});

describe("resolveInteractiveShoulderSide", () => {
  it("uses prescribed left side when supplied, overriding block side", () => {
    const resolved = resolveInteractiveShoulderSide({
      prescribedSide: "left",
      blockSide: "right",
    });
    assert.equal(resolved.side, "left");
    assert.equal(resolved.source, "prescribed");
    assert.equal(resolved.usedFallback, false);
  });

  it("uses prescribed right side when supplied, overriding block side", () => {
    const resolved = resolveInteractiveShoulderSide({
      prescribedSide: "right",
      blockSide: "left",
    });
    assert.equal(resolved.side, "right");
    assert.equal(resolved.source, "prescribed");
    assert.equal(resolved.usedFallback, false);
  });

  it("uses block side when prescribed side is absent", () => {
    const blockSide = SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION.blocks[0]?.side;
    const resolved = resolveInteractiveShoulderSide({ blockSide });
    assert.equal(resolved.side, "right");
    assert.equal(resolved.source, "block");
    assert.equal(resolved.usedFallback, false);
  });

  it("uses explicit fallback only when neither prescribed nor unilateral block side exists", () => {
    const resolved = resolveInteractiveShoulderSide({
      prescribedSide: null,
      blockSide: undefined,
    });
    assert.equal(resolved.side, INTERACTIVE_SHOULDER_DEFAULT_SIDE);
    assert.equal(resolved.source, "fallback");
    assert.equal(resolved.usedFallback, true);
  });

  it("treats bilateral block side as non-unilateral and falls back to the named default", () => {
    const resolved = resolveInteractiveShoulderSide({
      blockSide: "bilateral",
    });
    assert.equal(resolved.side, INTERACTIVE_SHOULDER_DEFAULT_SIDE);
    assert.equal(resolved.source, "fallback");
    assert.equal(resolved.usedFallback, true);
  });

  it("feeds the same resolved side to detector construction and target lifecycle", () => {
    const resolved = resolveInteractiveShoulderSide({
      prescribedSide: "left",
      blockSide: "right",
    });

    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, resolved.side);
    assert.equal(detector.getSnapshot().primarySide, resolved.side);

    const spawned = tickTargetLifecycle(createInitialTargetLifecycle(), {
      wrist: null,
      nowMs: 1_000,
      side: resolved.side,
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
      random: () => 0.5,
    });
    assert.ok(spawned.state.currentTarget);
    assert.equal(resolved.side, "left");
    void spawned;
  });
});

describe("resolveBlockSideFromSessionDefinition", () => {
  it("scans beyond block 0 and returns the first valid unilateral side", () => {
    const blocks: MovementBlock[] = [
      movementBlock({
        blockId: "warm-up",
        blockType: "instructional",
        movementId: "instructional:warm-up",
      }),
      movementBlock({
        blockId: "reach-the-light",
        blockType: "movement-target",
        side: "left",
      }),
      movementBlock({
        blockId: "d1-diagonal",
        blockType: "movement-pattern",
        side: "right",
      }),
    ];

    assert.equal(resolveBlockSideFromSessionDefinition(blocks), "left");

    const resolved = resolveInteractiveShoulderSide({
      blockSide: resolveBlockSideFromSessionDefinition(blocks),
    });
    assert.equal(resolved.side, "left");
    assert.equal(resolved.source, "block");
    assert.equal(resolved.usedFallback, false);
  });

  it("skips undefined, bilateral, and invalid sides until a valid unilateral side is found", () => {
    const blocks: MovementBlock[] = [
      movementBlock({
        blockId: "warm-up",
        blockType: "instructional",
        movementId: "instructional:warm-up",
      }),
      movementBlock({
        blockId: "ambiguous",
        blockType: "movement-target",
        side: "bilateral",
      }),
      movementBlock({
        blockId: "reach-the-light",
        blockType: "movement-target",
        side: "left",
      }),
    ];

    assert.equal(resolveBlockSideFromSessionDefinition(blocks), "left");
  });

  it("returns null when no block carries a valid unilateral side", () => {
    const blocks: MovementBlock[] = [
      movementBlock({
        blockId: "warm-up",
        blockType: "instructional",
        movementId: "instructional:warm-up",
      }),
      movementBlock({
        blockId: "cool-down",
        blockType: "instructional",
        movementId: "instructional:cool-down",
      }),
    ];

    assert.equal(resolveBlockSideFromSessionDefinition(blocks), null);
  });
});

describe("catalog session laterality (Part A — fallback only)", () => {
  it("does not invent side on converted Stroke catalog blocks and still falls back without prescription", () => {
    const definition = toSessionDefinition(STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1);

    for (const block of definition.blocks) {
      assert.equal(block.side, undefined);
    }

    assert.equal(resolveBlockSideFromSessionDefinition(definition.blocks), null);

    const resolved = resolveInteractiveShoulderSide({
      blockSide: resolveBlockSideFromSessionDefinition(definition.blocks),
    });
    assert.equal(resolved.side, INTERACTIVE_SHOULDER_DEFAULT_SIDE);
    assert.equal(resolved.source, "fallback");
    assert.equal(resolved.usedFallback, true);
  });
});

describe("runtime propagation from scanned session side", () => {
  it("propagates a later-block side to detector, target bias, adaptive placement, and motion pattern resolution", () => {
    const blocks: MovementBlock[] = [
      movementBlock({
        blockId: "warm-up",
        blockType: "instructional",
        movementId: "instructional:warm-up",
      }),
      movementBlock({
        blockId: "reach-the-light",
        blockType: "movement-target",
        side: "left",
      }),
    ];

    const resolved = resolveInteractiveShoulderSide({
      blockSide: resolveBlockSideFromSessionDefinition(blocks),
    });
    assert.equal(resolved.side, "left");

    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, resolved.side);
    assert.equal(detector.getSnapshot().primarySide, "left");

    const biased = resolveSideBiasedBounds(DEFAULT_SAFE_TARGET_BOUNDS, resolved.side);
    assert.ok(biased.maxX <= DEFAULT_SAFE_TARGET_BOUNDS.maxX);

    const placement = resolveTargetLevelPosition({
      affectedSide: resolved.side,
      shoulderAnchorNormalized: { x: 0.35, y: 0.35 },
      reachRadiusNormalized: 0.2,
      levelDegrees: 90,
      minimumLevelDegrees: 30,
      maximumLevelDegrees: 120,
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
      applySideBias: true,
    });
    assert.equal(placement.available, true);
    if (placement.available) {
      assert.ok(placement.position.x < 0.5);
    }

    const pattern = resolveActiveMotionPattern("d1-inspired-diagonal-reach", resolved.side);
    assert.ok(pattern);
    assert.equal(pattern?.side, "left");
  });
});
