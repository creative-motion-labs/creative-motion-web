/**
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/label-reader.test.ts
 */

import assert from "node:assert/strict";
import { describe, it, after } from "node:test";
import { unlink } from "node:fs/promises";
import {
  dedupeLatestLabelPerRepAndRater,
  readShoulderAbductionCaptureSessionLabels,
  readShoulderAbductionCaptureSessionLabelsForRater,
} from "@/app/lib/ml-research/shoulder-abduction-reach/label-reader";
import {
  appendShoulderAbductionReachLabelLocally,
  resolveDevSessionLabelsJsonlPath,
} from "@/app/lib/ml-research/shoulder-abduction-reach/local-label-writer";
import {
  ML_RESEARCH_DATASET_VERSION,
  ML_RESEARCH_LABEL_SCHEMA_VERSION,
  type ShoulderAbductionReachLabelConfidence,
  type ShoulderAbductionReachLabelRecord,
} from "@/app/lib/ml-research/shoulder-abduction-reach/label-schema";

const TEST_SESSION_ID = "test-fixture-label-reader-do-not-use";

function label(opts: {
  repetitionId: string;
  raterId: string;
  labeledAtMs: number;
  sourceLineIndex?: number;
  side?: "left" | "right";
  compensationLabel?: ShoulderAbductionReachLabelRecord["compensationLabel"];
  confidence?: ShoulderAbductionReachLabelConfidence;
}): ShoulderAbductionReachLabelRecord {
  return {
    labelSchemaVersion: ML_RESEARCH_LABEL_SCHEMA_VERSION,
    datasetVersion: ML_RESEARCH_DATASET_VERSION,
    devSessionId: TEST_SESSION_ID,
    sourceLineIndex: opts.sourceLineIndex ?? 0,
    repetitionId: opts.repetitionId,
    participantId: "dev-participant-fixture",
    side: opts.side ?? "right",
    raterId: opts.raterId,
    compensationLabel: opts.compensationLabel ?? "NO_COMPENSATION",
    exclusionFlag: null,
    raterConfidence: opts.confidence ?? "medium",
    note: "",
    labeledAtMs: opts.labeledAtMs,
  };
}

describe("dedupeLatestLabelPerRepAndRater (pure)", () => {
  it("keeps only the last label per (sourceLineIndex, raterId) pair", () => {
    const labels = [
      label({ repetitionId: "rep-1", raterId: "therapist-A", labeledAtMs: 1000, compensationLabel: "NO_COMPENSATION" }),
      label({ repetitionId: "rep-2", raterId: "therapist-A", labeledAtMs: 1000, compensationLabel: "MILD_COMPENSATION", sourceLineIndex: 1 }),
      // correction for line 0 by the SAME rater
      label({ repetitionId: "rep-1", raterId: "therapist-A", labeledAtMs: 2000, compensationLabel: "CLEAR_COMPENSATION" }),
    ];
    const result = dedupeLatestLabelPerRepAndRater(labels);
    assert.equal(result.length, 2);
    const rep1 = result.find((l) => l.sourceLineIndex === 0);
    assert.equal(rep1?.compensationLabel, "CLEAR_COMPENSATION");
  });

  it("does not collapse colliding repetitionIds across sides for the same rater", () => {
    const sharedRepetitionId = "shared-rep-id";
    const labels = [
      label({
        repetitionId: sharedRepetitionId,
        raterId: "therapist-A",
        labeledAtMs: 1000,
        sourceLineIndex: 0,
        side: "right",
        compensationLabel: "NO_COMPENSATION",
      }),
      label({
        repetitionId: sharedRepetitionId,
        raterId: "therapist-A",
        labeledAtMs: 1100,
        sourceLineIndex: 1,
        side: "left",
        compensationLabel: "MILD_COMPENSATION",
      }),
    ];
    const result = dedupeLatestLabelPerRepAndRater(labels);
    assert.equal(result.length, 2);
  });

  it("collapses whitespace-only raterId variants to one latest label for the same sourceLineIndex", () => {
    const labels = [
      label({
        repetitionId: "rep-1",
        raterId: " therapist-A ",
        labeledAtMs: 1000,
        compensationLabel: "NO_COMPENSATION",
      }),
      label({
        repetitionId: "rep-1",
        raterId: "therapist-A",
        labeledAtMs: 2000,
        compensationLabel: "CLEAR_COMPENSATION",
      }),
    ];
    const result = dedupeLatestLabelPerRepAndRater(labels);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.compensationLabel, "CLEAR_COMPENSATION");
  });

  it("preserves case-distinct raterIds as separate dedupe identities", () => {
    const labels = [
      label({ repetitionId: "rep-1", raterId: "Rater-A", labeledAtMs: 1000, compensationLabel: "NO_COMPENSATION" }),
      label({ repetitionId: "rep-1", raterId: "rater-a", labeledAtMs: 1500, compensationLabel: "MILD_COMPENSATION" }),
    ];
    const result = dedupeLatestLabelPerRepAndRater(labels);
    assert.equal(result.length, 2);
  });

  it("preserves BOTH raters' independent labels for the same repetition (does not collapse across raters)", () => {
    const labels = [
      label({ repetitionId: "rep-1", raterId: "therapist-A", labeledAtMs: 1000, compensationLabel: "NO_COMPENSATION" }),
      label({ repetitionId: "rep-1", raterId: "therapist-B", labeledAtMs: 1500, compensationLabel: "CLEAR_COMPENSATION" }),
    ];
    const result = dedupeLatestLabelPerRepAndRater(labels);
    assert.equal(result.length, 2, "one label per rater must survive, not one overall");
    const byRater = new Map(result.map((l) => [l.raterId, l]));
    assert.equal(byRater.get("therapist-A")?.compensationLabel, "NO_COMPENSATION");
    assert.equal(byRater.get("therapist-B")?.compensationLabel, "CLEAR_COMPENSATION");
  });

  it("returns an empty array for no labels", () => {
    assert.deepEqual(dedupeLatestLabelPerRepAndRater([]), []);
  });
});

after(async () => {
  await unlink(resolveDevSessionLabelsJsonlPath(TEST_SESSION_ID)).catch(() => {});
});

describe("label writer + reader (integration)", () => {
  it("appends and reads back a label", async () => {
    const { filePath } = await appendShoulderAbductionReachLabelLocally(
      label({ repetitionId: "rep-1", raterId: "therapist-A", labeledAtMs: 1000, compensationLabel: "NO_COMPENSATION" }),
    );
    assert.match(filePath, /test-fixture-label-reader-do-not-use\.labels\.jsonl$/);

    const labels = await readShoulderAbductionCaptureSessionLabels(TEST_SESSION_ID);
    const mine = labels.find((l) => l.repetitionId === "rep-1" && l.raterId === "therapist-A");
    assert.ok(mine);
    assert.equal(mine.compensationLabel, "NO_COMPENSATION");
  });

  it("resolves a re-submitted label (append-only) to the latest value on read", async () => {
    await appendShoulderAbductionReachLabelLocally(
      label({ repetitionId: "rep-1", raterId: "therapist-A", labeledAtMs: 2000, compensationLabel: "CLEAR_COMPENSATION" }),
    );

    const labels = await readShoulderAbductionCaptureSessionLabels(TEST_SESSION_ID);
    const mine = labels.filter((l) => l.repetitionId === "rep-1" && l.raterId === "therapist-A");
    assert.equal(mine.length, 1, "still one label for this (rep, rater) pair, latest wins");
    assert.equal(mine[0].compensationLabel, "CLEAR_COMPENSATION");
  });

  it("Rater A cannot read Rater B's label — readShoulderAbductionCaptureSessionLabelsForRater is scoped per rater", async () => {
    await appendShoulderAbductionReachLabelLocally(
      label({ repetitionId: "rep-2", raterId: "therapist-B", labeledAtMs: 3000, compensationLabel: "MILD_COMPENSATION" }),
    );

    const aLabels = await readShoulderAbductionCaptureSessionLabelsForRater(TEST_SESSION_ID, "therapist-A");
    assert.ok(aLabels.every((l) => l.raterId === "therapist-A"), "rater A's view must never include rater B's labels");
    assert.equal(
      aLabels.some((l) => l.repetitionId === "rep-2"),
      false,
      "rep-2 was only ever labeled by therapist-B",
    );

    const bLabels = await readShoulderAbductionCaptureSessionLabelsForRater(TEST_SESSION_ID, "therapist-B");
    assert.ok(bLabels.every((l) => l.raterId === "therapist-B"));
    assert.ok(bLabels.some((l) => l.repetitionId === "rep-2"));
  });

  it("returns an empty array for a session with no labels yet", async () => {
    const labels = await readShoulderAbductionCaptureSessionLabels("no-such-labels-session-xyz");
    assert.deepEqual(labels, []);
    const forRater = await readShoulderAbductionCaptureSessionLabelsForRater("no-such-labels-session-xyz", "therapist-A");
    assert.deepEqual(forRater, []);
  });

  it("labels are written to a file separate from the capture data (dev-data/rasq-ml/shoulder-abduction-labels/)", () => {
    const filePath = resolveDevSessionLabelsJsonlPath(TEST_SESSION_ID);
    assert.match(filePath, /shoulder-abduction-labels[\\/]/);
    assert.doesNotMatch(filePath, /[\\/]shoulder-abduction[\\/]/);
  });
});
