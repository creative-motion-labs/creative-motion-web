/**
 * Run: npx tsx --test app/lib/interactive-shoulder/orchestrator-cv-detector-lifecycle.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import { toSessionDefinition } from "@/app/lib/rehab-programs/rehab-program-runtime-adapter";
import { STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1 } from "@/app/lib/rehab-programs/stroke-upper-limb-recovery-foundation";
import {
  disposeOrchestratorCvDetector,
  mountOrchestratorCvDetector,
  shouldStartOrchestratorCvCamera,
  type OrchestratorCvDetectorFactory,
} from "./orchestrator-cv-detector-lifecycle";
import {
  INTERACTIVE_SHOULDER_DEFAULT_SIDE,
  resolveOrchestratorTherapeuticSide,
} from "./resolve-interactive-shoulder-side";

type MockDetector = {
  side: ShoulderAbductionReachSide;
  stopped: boolean;
  stop(): void;
  start(): Promise<void>;
};

const STROKE_BLOCKS = toSessionDefinition(STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1).blocks;

function createMockFactory(): {
  factory: OrchestratorCvDetectorFactory<MockDetector, unknown, unknown>;
  calls: Array<{ side: ShoulderAbductionReachSide }>;
  instances: MockDetector[];
} {
  const calls: Array<{ side: ShoulderAbductionReachSide }> = [];
  const instances: MockDetector[] = [];
  const factory: OrchestratorCvDetectorFactory<MockDetector, unknown, unknown> = (_callbacks, side) => {
    calls.push({ side });
    const instance: MockDetector = {
      side,
      stopped: false,
      stop() {
        this.stopped = true;
      },
      async start() {},
    };
    instances.push(instance);
    return instance;
  };
  return { factory, calls, instances };
}

function simulateDetectorEffect(
  resolvedSide: ReturnType<typeof resolveOrchestratorTherapeuticSide>,
  factory: OrchestratorCvDetectorFactory<MockDetector, unknown, unknown>,
) {
  const detector = mountOrchestratorCvDetector(resolvedSide, factory, {
    onSnapshot: () => {},
    onMeasuredEvent: () => {},
  });
  return {
    detector,
    cleanup: () => disposeOrchestratorCvDetector(detector),
  };
}

describe("resolveOrchestratorTherapeuticSide", () => {
  it("strict clinical mode returns null for missing prescribed side", () => {
    assert.equal(
      resolveOrchestratorTherapeuticSide({
        prescribedSide: null,
        clinicalPrescribedSideRequired: true,
        blocks: STROKE_BLOCKS,
      }),
      null,
    );
  });

  it("strict clinical mode returns null for invalid prescribed values", () => {
    for (const value of ["bilateral", "Left", "RIGHT", "north", ""]) {
      assert.equal(
        resolveOrchestratorTherapeuticSide({
          prescribedSide: value,
          clinicalPrescribedSideRequired: true,
          blocks: STROKE_BLOCKS,
        }),
        null,
      );
    }
  });

  it("strict clinical mode resolves left and right exactly", () => {
    const left = resolveOrchestratorTherapeuticSide({
      prescribedSide: "left",
      clinicalPrescribedSideRequired: true,
      blocks: STROKE_BLOCKS,
    });
    const right = resolveOrchestratorTherapeuticSide({
      prescribedSide: "right",
      clinicalPrescribedSideRequired: true,
      blocks: STROKE_BLOCKS,
    });
    assert.equal(left?.side, "left");
    assert.equal(right?.side, "right");
  });

  it("legacy non-clinical mode keeps documented fallback", () => {
    const resolved = resolveOrchestratorTherapeuticSide({
      prescribedSide: null,
      clinicalPrescribedSideRequired: false,
      blocks: STROKE_BLOCKS,
    });
    assert.equal(resolved?.side, INTERACTIVE_SHOULDER_DEFAULT_SIDE);
    assert.equal(resolved?.usedFallback, true);
  });
});

describe("orchestrator cv detector lifecycle (strict clinical boundary)", () => {
  it("1. strict clinical null side never invokes detector factory", () => {
    const { factory, calls } = createMockFactory();
    const resolved = resolveOrchestratorTherapeuticSide({
      prescribedSide: null,
      clinicalPrescribedSideRequired: true,
      blocks: STROKE_BLOCKS,
    });
    const { detector, cleanup } = simulateDetectorEffect(resolved, factory);
    assert.equal(detector, null);
    assert.equal(calls.length, 0);
    cleanup();
    assert.equal(calls.length, 0);
  });

  it("2. strict clinical invalid sides never invoke detector factory", () => {
    for (const value of ["bilateral", "Left", "RIGHT", "north", ""]) {
      const { factory, calls } = createMockFactory();
      const resolved = resolveOrchestratorTherapeuticSide({
        prescribedSide: value,
        clinicalPrescribedSideRequired: true,
        blocks: STROKE_BLOCKS,
      });
      const { detector, cleanup } = simulateDetectorEffect(resolved, factory);
      assert.equal(detector, null);
      assert.equal(calls.length, 0);
      cleanup();
    }
  });

  it("3. strict clinical left creates detector once with LEFT", () => {
    const { factory, calls, instances } = createMockFactory();
    const resolved = resolveOrchestratorTherapeuticSide({
      prescribedSide: "left",
      clinicalPrescribedSideRequired: true,
      blocks: STROKE_BLOCKS,
    });
    const { detector } = simulateDetectorEffect(resolved, factory);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.side, "left");
    assert.equal(detector?.side, "left");
    assert.equal(instances.length, 1);
  });

  it("4. strict clinical right creates detector once with RIGHT", () => {
    const { factory, calls } = createMockFactory();
    const resolved = resolveOrchestratorTherapeuticSide({
      prescribedSide: "right",
      clinicalPrescribedSideRequired: true,
      blocks: STROKE_BLOCKS,
    });
    const { detector } = simulateDetectorEffect(resolved, factory);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.side, "right");
    assert.equal(detector?.side, "right");
  });

  it("5. valid LEFT to blocked transition disposes LEFT and creates no RIGHT detector", () => {
    const { factory, calls, instances } = createMockFactory();
    const leftResolved = resolveOrchestratorTherapeuticSide({
      prescribedSide: "left",
      clinicalPrescribedSideRequired: true,
      blocks: STROKE_BLOCKS,
    });
    const leftMount = simulateDetectorEffect(leftResolved, factory);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.side, "left");

    leftMount.cleanup();
    assert.equal(instances[0]?.stopped, true);

    const blockedResolved = resolveOrchestratorTherapeuticSide({
      prescribedSide: null,
      clinicalPrescribedSideRequired: true,
      blocks: STROKE_BLOCKS,
    });
    const blockedMount = simulateDetectorEffect(blockedResolved, factory);
    assert.equal(blockedMount.detector, null);
    assert.equal(calls.length, 1);
    assert.deepEqual(
      calls.map((call) => call.side),
      ["left"],
    );
  });

  it("6. blocked to valid RIGHT creates only RIGHT detector", () => {
    const { factory, calls } = createMockFactory();
    const blockedResolved = resolveOrchestratorTherapeuticSide({
      prescribedSide: "bilateral",
      clinicalPrescribedSideRequired: true,
      blocks: STROKE_BLOCKS,
    });
    const blockedMount = simulateDetectorEffect(blockedResolved, factory);
    assert.equal(blockedMount.detector, null);
    blockedMount.cleanup();

    const rightResolved = resolveOrchestratorTherapeuticSide({
      prescribedSide: "right",
      clinicalPrescribedSideRequired: true,
      blocks: STROKE_BLOCKS,
    });
    const rightMount = simulateDetectorEffect(rightResolved, factory);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.side, "right");
    assert.equal(rightMount.detector?.side, "right");
  });

  it("7. legacy non-clinical mode still uses fallback when side is absent", () => {
    const { factory, calls } = createMockFactory();
    const resolved = resolveOrchestratorTherapeuticSide({
      prescribedSide: null,
      clinicalPrescribedSideRequired: false,
      blocks: STROKE_BLOCKS,
    });
    simulateDetectorEffect(resolved, factory);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.side, INTERACTIVE_SHOULDER_DEFAULT_SIDE);
  });

  it("8. camera/start cannot proceed while clinical side is blocked", () => {
    const blockedResolved = resolveOrchestratorTherapeuticSide({
      prescribedSide: null,
      clinicalPrescribedSideRequired: true,
      blocks: STROKE_BLOCKS,
    });
    assert.equal(
      shouldStartOrchestratorCvCamera({
        consentAccepted: true,
        profileAvailable: true,
        resolvedTherapeuticSide: blockedResolved,
      }),
      false,
    );

    const validResolved = resolveOrchestratorTherapeuticSide({
      prescribedSide: "right",
      clinicalPrescribedSideRequired: true,
      blocks: STROKE_BLOCKS,
    });
    assert.equal(
      shouldStartOrchestratorCvCamera({
        consentAccepted: true,
        profileAvailable: true,
        resolvedTherapeuticSide: validResolved,
      }),
      true,
    );
    assert.equal(
      shouldStartOrchestratorCvCamera({
        consentAccepted: false,
        profileAvailable: true,
        resolvedTherapeuticSide: validResolved,
      }),
      false,
    );
  });
});
