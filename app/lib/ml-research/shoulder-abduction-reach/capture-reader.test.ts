/**
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/capture-reader.test.ts
 *
 * Integration-style: writes real fixture files under the actual
 * dev-data/rasq-ml/shoulder-abduction/ directory (via the existing writer,
 * same as a real capture would), reads them back through the labeling
 * reader, and deletes the fixture file afterward. Uses an unmistakable test
 * session id so it can never collide with a real capture session.
 */

import assert from "node:assert/strict";
import { describe, it, after } from "node:test";
import { unlink } from "node:fs/promises";
import {
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
  type ShoulderAbductionReachRepCaptureRecord,
} from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";
import { appendShoulderAbductionReachRepRecordLocally, resolveDevSessionJsonlPath } from "@/app/lib/ml-research/shoulder-abduction-reach/local-jsonl-writer";
import {
  computeReviewCautionFlag,
  listShoulderAbductionCaptureSessions,
  lookupParticipantIdForRepetition,
  resolveCaptureIdentityForLabel,
  readShoulderAbductionCaptureSessionForLabeling,
} from "@/app/lib/ml-research/shoulder-abduction-reach/capture-reader";

const TEST_SESSION_ID = "test-fixture-capture-reader-do-not-use";

function fixtureRecord(
  repetitionIndex: number,
  side: "left" | "right",
): ShoulderAbductionReachRepCaptureRecord {
  return {
    context: {
      captureSchemaVersion: ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
      featureSchemaVersion: ML_RESEARCH_FEATURE_SCHEMA_VERSION,
      participantId: "test-participant-should-not-leak",
      devSessionId: TEST_SESSION_ID,
      repetitionIndex,
      repetitionId: `${TEST_SESSION_ID}-rep-${repetitionIndex}`,
      side,
      movementType: "shoulder_abduction_reach",
      startedAtMs: 1000,
      endedAtMs: 2000,
      simulationCondition: "simulated_trunk_lean",
    },
    frames: [
      { relativeTimestampMs: 0, frameIndex: 0, joints: {} },
      { relativeTimestampMs: 500, frameIndex: 1, joints: {} },
    ],
    derivedFeatures: {
      peakNormalizedTrunkDriftRatio: 0.42,
      peakShoulderAngleDegrees: 150,
      movementDurationMs: 1000,
      peakAngularVelocityDegPerSec: 2000,
      trackingQuality: { framesTotal: 2, framesWithUsableAngle: 2, usableFrameRatio: 1, minCoreJointVisibility: 0.9 },
    },
  };
}

after(async () => {
  await unlink(resolveDevSessionJsonlPath(TEST_SESSION_ID)).catch(() => {});
});

describe("capture-reader (integration)", () => {
  it("lists the fixture session after writing two reps to it", async () => {
    await appendShoulderAbductionReachRepRecordLocally(fixtureRecord(1, "right"));
    await appendShoulderAbductionReachRepRecordLocally(fixtureRecord(1, "left"));

    const sessions = await listShoulderAbductionCaptureSessions();
    const fixture = sessions.find((s) => s.devSessionId === TEST_SESSION_ID);
    assert.ok(fixture, "fixture session should be listed");
    assert.equal(fixture!.repCount, 2);
  });

  it("assigns a unique sourceLineIndex per line, even though repetitionId collides across sides", async () => {
    const reps = await readShoulderAbductionCaptureSessionForLabeling(TEST_SESSION_ID);
    assert.equal(reps.length, 2);
    assert.equal(reps[0].sourceLineIndex, 0);
    assert.equal(reps[1].sourceLineIndex, 1);
    // Both reps do share a repetitionId (right-rep-1 and left-rep-1) — sourceLineIndex is
    // what disambiguates them; this is the known upstream collision this reader works around.
    assert.equal(reps[0].repetitionId, reps[1].repetitionId);
    assert.notEqual(reps[0].side, reps[1].side);
  });

  it("redacts simulationCondition, derivedFeatures, and participantId entirely", async () => {
    const reps = await readShoulderAbductionCaptureSessionForLabeling(TEST_SESSION_ID);
    for (const rep of reps) {
      const asRecord = rep as unknown as Record<string, unknown>;
      assert.equal("simulationCondition" in asRecord, false);
      assert.equal("derivedFeatures" in asRecord, false);
      assert.equal("participantId" in asRecord, false);
      const serialized = JSON.stringify(rep);
      assert.doesNotMatch(serialized, /simulationCondition|simulated_trunk_lean|participantId|test-participant-should-not-leak/);
    }
  });

  it("never exposes the rule-based compensation flag or any compensation/drift-shaped key (it was never in the capture schema to begin with)", async () => {
    const reps = await readShoulderAbductionCaptureSessionForLabeling(TEST_SESSION_ID);
    const serialized = JSON.stringify(reps).toLowerCase();
    for (const forbidden of ["compensationflagged", "trunkdrift", "peaknormalizedtrunkdriftratio", "peakshoulderangledegrees"]) {
      assert.doesNotMatch(serialized, new RegExp(forbidden));
    }
  });

  it("still exposes frames (needed for skeleton replay) and tracking quality", async () => {
    const reps = await readShoulderAbductionCaptureSessionForLabeling(TEST_SESSION_ID);
    assert.equal(reps[0].frames.length, 2);
    assert.equal(reps[0].trackingQuality.usableFrameRatio, 1);
    assert.equal(reps[0].frameCount, 2);
    assert.equal(reps[0].movementDurationMs, 1000);
  });

  it("returns an empty array for a session that does not exist", async () => {
    const reps = await readShoulderAbductionCaptureSessionForLabeling("no-such-session-xyz");
    assert.deepEqual(reps, []);
  });

  it("computes reviewCaution from technical metadata only, never movement content", async () => {
    const reps = await readShoulderAbductionCaptureSessionForLabeling(TEST_SESSION_ID);
    // The 2-frame fixture is well under the 20-frame caution threshold.
    assert.equal(reps[0].reviewCaution, true);
  });

  it("looks up participantId only when sourceLineIndex, repetitionId, and side all match the capture line", async () => {
    const reps = await readShoulderAbductionCaptureSessionForLabeling(TEST_SESSION_ID);
    const rightRep = reps.find((rep) => rep.side === "right");
    assert.ok(rightRep);
    const participantId = await lookupParticipantIdForRepetition(
      TEST_SESSION_ID,
      rightRep!.sourceLineIndex,
      rightRep!.repetitionId,
      rightRep!.side,
    );
    assert.equal(participantId, "test-participant-should-not-leak");
  });

  it("returns null when repetitionId does not match the selected capture line", async () => {
    const reps = await readShoulderAbductionCaptureSessionForLabeling(TEST_SESSION_ID);
    const rightRep = reps.find((rep) => rep.side === "right");
    assert.ok(rightRep);
    assert.equal(
      await lookupParticipantIdForRepetition(
        TEST_SESSION_ID,
        rightRep!.sourceLineIndex,
        "forged-repetition-id",
        rightRep!.side,
      ),
      null,
    );
  });

  it("returns null when side does not match the selected capture line", async () => {
    const reps = await readShoulderAbductionCaptureSessionForLabeling(TEST_SESSION_ID);
    const rightRep = reps.find((rep) => rep.side === "right");
    assert.ok(rightRep);
    assert.equal(
      await lookupParticipantIdForRepetition(
        TEST_SESSION_ID,
        rightRep!.sourceLineIndex,
        rightRep!.repetitionId,
        "left",
      ),
      null,
    );
  });

  it("returns null for an out-of-range or missing sourceLineIndex", async () => {
    assert.equal(
      await lookupParticipantIdForRepetition(TEST_SESSION_ID, 999, "any-id", "right"),
      null,
    );
    assert.equal(await lookupParticipantIdForRepetition("no-such-session-xyz", 0, "any-id", "right"), null);
  });
});

describe("resolveCaptureIdentityForLabel (integration)", () => {
  it("resolves when sourceLineIndex, repetitionId, and side all match", async () => {
    const reps = await readShoulderAbductionCaptureSessionForLabeling(TEST_SESSION_ID);
    const leftRep = reps.find((rep) => rep.side === "left");
    assert.ok(leftRep);
    const resolved = await resolveCaptureIdentityForLabel({
      devSessionId: TEST_SESSION_ID,
      sourceLineIndex: leftRep!.sourceLineIndex,
      repetitionId: leftRep!.repetitionId,
      side: leftRep!.side,
    });
    assert.ok(resolved);
    assert.equal(resolved!.participantId, "test-participant-should-not-leak");
    assert.equal(resolved!.devSessionId, TEST_SESSION_ID);
    assert.equal(resolved!.side, "left");
  });

  it("rejects valid line index with identifiers belonging to a different record", async () => {
    const reps = await readShoulderAbductionCaptureSessionForLabeling(TEST_SESSION_ID);
    const rightRep = reps.find((rep) => rep.side === "right");
    const leftRep = reps.find((rep) => rep.side === "left");
    assert.ok(rightRep && leftRep);
    assert.equal(
      await resolveCaptureIdentityForLabel({
        devSessionId: TEST_SESSION_ID,
        sourceLineIndex: rightRep!.sourceLineIndex,
        repetitionId: leftRep!.repetitionId,
        side: leftRep!.side,
      }),
      null,
    );
  });

  it("returns null for a missing session", async () => {
    assert.equal(
      await resolveCaptureIdentityForLabel({
        devSessionId: "no-such-session-xyz",
        sourceLineIndex: 0,
        repetitionId: "any",
        side: "right",
      }),
      null,
    );
  });
});

describe("computeReviewCautionFlag (pure)", () => {
  it("flags a rep with fewer than 20 frames", () => {
    assert.equal(computeReviewCautionFlag(10, 1), true);
  });

  it("flags a rep with a usable ratio below 1.0 even with plenty of frames", () => {
    assert.equal(computeReviewCautionFlag(50, 0.8), true);
  });

  it("does not flag a rep with enough frames and full usable tracking", () => {
    assert.equal(computeReviewCautionFlag(50, 1.0), false);
  });

  it("treats a null usable ratio as not itself disqualifying (frame count still governs)", () => {
    assert.equal(computeReviewCautionFlag(50, null), false);
    assert.equal(computeReviewCautionFlag(5, null), true);
  });
});
