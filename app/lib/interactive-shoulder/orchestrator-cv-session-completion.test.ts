/**
 * Run: npx tsx --test app/lib/interactive-shoulder/orchestrator-cv-session-completion.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SessionOrchestrator } from "@/app/lib/session-orchestrator/session-orchestrator";
import { toSessionDefinition } from "@/app/lib/rehab-programs/rehab-program-runtime-adapter";
import { STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1 } from "@/app/lib/rehab-programs/stroke-upper-limb-recovery-foundation";
import { shouldFireSessionCompleteCallback } from "./orchestrator-cv-session-completion";

describe("orchestrator-cv-session-completion", () => {
  it("fires only when sessionState is completed and has not fired yet", () => {
    assert.equal(shouldFireSessionCompleteCallback("completed", false), true);
    assert.equal(shouldFireSessionCompleteCallback("completed", true), false);
    assert.equal(shouldFireSessionCompleteCallback("active", false), false);
    assert.equal(shouldFireSessionCompleteCallback("paused", false), false);
  });

  it("block completion alone does not represent full-session completion", () => {
    const definition = toSessionDefinition(STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1);
    const orchestrator = new SessionOrchestrator(definition);
    let nowMs = 1_000_000;

    orchestrator.start(nowMs);
    orchestrator.beginCalibration(nowMs);
    orchestrator.completeCalibration(nowMs);

    const firstBlockDurationMs = (definition.blocks[0]?.targetDurationSeconds ?? 0) * 1_000;
    nowMs += firstBlockDurationMs;
    orchestrator.tick(nowMs);

    const snap = orchestrator.getSnapshot(nowMs);
    assert.equal(snap.sessionState, "active");
    assert.equal(shouldFireSessionCompleteCallback(snap.sessionState, false), false);
    assert.ok(snap.currentBlock);
    assert.notEqual(snap.currentBlock?.blockId, definition.blocks.at(-1)?.blockId);
  });

  it("full-session completion is eligible exactly once after all blocks finish", () => {
    const definition = toSessionDefinition(STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1);
    const orchestrator = new SessionOrchestrator(definition);
    let nowMs = 1_000_000;

    orchestrator.start(nowMs);
    orchestrator.beginCalibration(nowMs);
    orchestrator.completeCalibration(nowMs);

    for (const block of definition.blocks) {
      nowMs += (block.targetDurationSeconds ?? 0) * 1_000;
      orchestrator.tick(nowMs);
    }

    const snap = orchestrator.getSnapshot(nowMs);
    assert.equal(snap.sessionState, "completed");
    assert.equal(shouldFireSessionCompleteCallback(snap.sessionState, false), true);
    assert.equal(shouldFireSessionCompleteCallback(snap.sessionState, true), false);
  });

  it("OrchestratorCvSessionCore wires onSessionComplete once per completed session, forwarding the real final snapshot (O2)", () => {
    const corePath = join(
      process.cwd(),
      "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx",
    );
    const source = readFileSync(corePath, "utf8");
    assert.match(source, /sessionCompleteFiredRef/);
    assert.match(source, /shouldFireSessionCompleteCallback/);
    assert.match(source, /snap\.sessionState === "completed"/);
    // O2: the callback forwards the same local `snap` this tick already
    // computed — sessionState/sessionElapsedSeconds/accumulatedBlockResults,
    // never a fabricated or recomputed value.
    assert.match(source, /onSessionComplete\?\.\(\{/);
    assert.match(source, /sessionState:\s*snap\.sessionState/);
    assert.match(source, /sessionElapsedSeconds:\s*snap\.sessionElapsedSeconds/);
    assert.match(source, /accumulatedBlockResults:\s*snap\.accumulatedBlockResults/);
  });
});
