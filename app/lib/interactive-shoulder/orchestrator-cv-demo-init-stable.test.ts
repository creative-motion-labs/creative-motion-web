/**
 * Run: npx tsx --test app/lib/interactive-shoulder/orchestrator-cv-demo-init-stable.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { SessionOrchestratorSnapshot } from "@/app/lib/session-orchestrator/types";
import {
  isOrchestratorCvSessionPausedForCountdown,
  shouldAdvanceOrchestratorCvOrchestratorTick,
  shouldRunOrchestratorCvRafOrchestration,
} from "./orchestrator-cv-raf-frame-policy";

function snap(overrides: Partial<SessionOrchestratorSnapshot> = {}): SessionOrchestratorSnapshot {
  return {
    sessionState: "paused",
    currentBlockIndex: 0,
    currentBlock: null,
    currentInstruction: null,
    blockElapsedSeconds: 0,
    sessionElapsedSeconds: 0,
    blockProgress: 0,
    sessionProgress: 0,
    restRemainingSeconds: null,
    transitionState: "none",
    isPaused: true,
    safetyStatus: "normal",
    safetyHoldReason: null,
    patientFeedbackState: { message: null, encouragement: null },
    accumulatedBlockResults: [],
    ...overrides,
  };
}

describe("orchestrator cv demo init stability", () => {
  it("skips RAF orchestration while countdown is active or orchestrator is paused", () => {
    const pausedSnap = snap({ sessionState: "paused", isPaused: true });
    assert.equal(
      isOrchestratorCvSessionPausedForCountdown({ countdownActive: true, snap: pausedSnap }),
      true,
    );
    assert.equal(
      shouldRunOrchestratorCvRafOrchestration({ countdownActive: false, snap: pausedSnap }),
      false,
    );
    assert.equal(
      shouldAdvanceOrchestratorCvOrchestratorTick({
        runtimeFaultActive: false,
        countdownActive: true,
        snap: snap({ sessionState: "active", isPaused: false }),
      }),
      false,
    );
    const activeSnap = snap({ sessionState: "active", isPaused: false });
    assert.equal(
      shouldRunOrchestratorCvRafOrchestration({ countdownActive: false, snap: activeSnap }),
      true,
    );
  });

  it("edge-triggers camera start and ignores stale async after detector remount", () => {
    const coreSource = readFileSync(
      join(process.cwd(), "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx"),
      "utf8",
    );
    assert.match(coreSource, /consentAcceptedForCameraRef/);
    assert.match(coreSource, /startSessionGenerationRef/);
    assert.match(coreSource, /shouldRunOrchestratorCvRafOrchestration/);
    assert.match(coreSource, /generation !== startSessionGenerationRef\.current/);
    assert.match(coreSource, /consentAcceptedForCameraRef\.current = false/);
    assert.match(coreSource, /startSessionGenerationRef\.current \+= 1/);
  });

  it("dedupes movement block activation during block transition", () => {
    const coreSource = readFileSync(
      join(process.cwd(), "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx"),
      "utf8",
    );
    assert.match(coreSource, /movementBlockActivatedRef/);
  });

  it("samples detector snapshots from a ref inside the RAF loop", () => {
    const coreSource = readFileSync(
      join(process.cwd(), "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx"),
      "utf8",
    );
    assert.match(coreSource, /ingestLiveDetectorSnapshotRef/);
    assert.match(coreSource, /commitPoseDetectorUiIfChangedRef/);
    assert.match(coreSource, /evaluatePoseDetectorUiCommit/);
  });
});
