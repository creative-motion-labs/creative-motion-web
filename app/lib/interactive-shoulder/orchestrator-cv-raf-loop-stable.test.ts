/**
 * Run: npx tsx --test app/lib/interactive-shoulder/orchestrator-cv-raf-loop-stable.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  orchestratorHudSummaryMetricsEqual,
  shouldCommitOrchestratorHudSnapshot,
  targetLifecycleHudEquals,
} from "./orchestrator-cv-raf-loop-guards";
import { createInitialTargetLifecycle } from "./target-lifecycle";
import type { SessionOrchestratorSnapshot } from "@/app/lib/session-orchestrator/types";

function minimalSnapshot(
  overrides: Partial<SessionOrchestratorSnapshot> = {},
): SessionOrchestratorSnapshot {
  return {
    sessionState: "active",
    currentBlockIndex: 0,
    currentBlock: null,
    currentInstruction: null,
    blockElapsedSeconds: 0,
    sessionElapsedSeconds: 0,
    blockProgress: 0,
    sessionProgress: 0,
    restRemainingSeconds: null,
    transitionState: "none",
    isPaused: false,
    safetyStatus: "normal",
    safetyHoldReason: null,
    patientFeedbackState: { message: null, encouragement: null },
    accumulatedBlockResults: [],
    ...overrides,
  };
}

describe("orchestrator cv raf loop guards", () => {
  it("skips redundant orchestrator HUD snapshot commits", () => {
    const first = minimalSnapshot({ blockElapsedSeconds: 1 });
    assert.equal(shouldCommitOrchestratorHudSnapshot(null, first), true);
    assert.equal(shouldCommitOrchestratorHudSnapshot(first, first), false);
    assert.equal(
      shouldCommitOrchestratorHudSnapshot(first, minimalSnapshot({ blockElapsedSeconds: 2 })),
      true,
    );
    assert.equal(
      shouldCommitOrchestratorHudSnapshot(
        minimalSnapshot({ blockElapsedSeconds: 1.2 }),
        minimalSnapshot({ blockElapsedSeconds: 1.8 }),
      ),
      false,
      "sub-second elapsed churn must not commit HUD state",
    );
  });

  it("detects unchanged target lifecycle HUD slices", () => {
    const a = createInitialTargetLifecycle();
    const b = { ...a, interaction: { ...a.interaction } };
    assert.equal(targetLifecycleHudEquals(a, b), true);
  });

  it("detects summary metric equality", () => {
    assert.equal(
      orchestratorHudSummaryMetricsEqual(
        { targets: 1, patterns: 0, reps: 0, durationSeconds: 10 },
        { targets: 1, patterns: 0, reps: 0, durationSeconds: 10 },
      ),
      true,
    );
    assert.equal(
      orchestratorHudSummaryMetricsEqual(
        { targets: 1, patterns: 0, reps: 0, durationSeconds: 10 },
        { targets: 2, patterns: 0, reps: 0, durationSeconds: 10 },
      ),
      false,
    );
  });

  it("mounts the RAF loop once and reads demo hooks through refs", () => {
    const corePath = join(
      process.cwd(),
      "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx",
    );
    const source = readFileSync(corePath, "utf8");
    const rafEffectStart = source.indexOf("rafLoopMountCountRef.current += 1");
    assert.ok(rafEffectStart > 0, "RAF loop dev mount counter");
    const rafTail = source.slice(rafEffectStart);
    const depsMatch = rafTail.match(/return \(\) => cancelAnimationFrame\(rafRef\.current\);\s*\}, (\[[^\]]*\])\);/);
    assert.ok(depsMatch, "RAF loop dependency array");
    assert.equal(depsMatch![1], "[]");
    assert.match(source, /onTargetReachConfirmedRef/);
    assert.match(source, /showBlockSummaryRef/);
    assert.match(source, /playOrchestratorUiSoundRef/);
    assert.match(source, /shouldCommitOrchestratorHudSnapshot/);
    assert.match(source, /consentAcceptedForCameraRef/);
    assert.doesNotMatch(source, /resolvedTherapeuticSide,\s*\n\s*therapeuticSideKey\]/);
  });

  it("demo orchestrator session memoizes unstable preview companion props", () => {
    const sessionSource = readFileSync(
      join(process.cwd(), "app/components/rasq-demo/RasqDemoOrchestratorSession.tsx"),
      "utf8",
    );
    assert.match(sessionSource, /useMemo\([\s\S]*RasqDemoUpperLimbMuscleFocusPanel/);
    assert.match(sessionSource, /useMemo\([\s\S]*RasqDemoReachTargetPerformanceHud/);
  });
});
