/**
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/label-schema.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPersistedShoulderAbductionReachLabelRecord,
  isValidShoulderAbductionReachLabelRecord,
  isValidShoulderAbductionReachLabelSubmission,
  ML_RESEARCH_DATASET_VERSION,
  ML_RESEARCH_LABEL_SCHEMA_VERSION,
  ML_RESEARCH_RATER_ID_MAX_LENGTH,
  normalizeResearchRaterId,
  projectShoulderAbductionReachLabelForRater,
  type ShoulderAbductionReachLabelRecord,
  type ShoulderAbductionReachLabelSubmission,
} from "@/app/lib/ml-research/shoulder-abduction-reach/label-schema";

function validSubmission(): ShoulderAbductionReachLabelSubmission {
  return {
    devSessionId: "dev-session-test",
    repetitionId: "dev-session-test-right-rep-1",
    sourceLineIndex: 0,
    side: "right",
    raterId: "therapist-A",
    compensationLabel: "NO_COMPENSATION",
    exclusionFlag: null,
    raterConfidence: "high",
    note: "",
  };
}

function validRecord(): ShoulderAbductionReachLabelRecord {
  return {
    ...validSubmission(),
    labelSchemaVersion: ML_RESEARCH_LABEL_SCHEMA_VERSION,
    datasetVersion: ML_RESEARCH_DATASET_VERSION,
    participantId: "dev-participant-001",
    labeledAtMs: 1_700_000_000_000,
  };
}

function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const clone = { ...obj };
  delete clone[key];
  return clone;
}

describe("normalizeResearchRaterId", () => {
  it("trim leading and trailing whitespace deterministically", () => {
    assert.equal(normalizeResearchRaterId("  therapist-A  "), "therapist-A");
  });

  it("preserves intentional case and internal spacing differences", () => {
    assert.equal(normalizeResearchRaterId("Aisha-Rater-01"), "Aisha-Rater-01");
    assert.notEqual(normalizeResearchRaterId("Aisha-Rater-01"), normalizeResearchRaterId("aisha-rater-01"));
  });

  it("rejects empty and whitespace-only values", () => {
    assert.equal(normalizeResearchRaterId(""), null);
    assert.equal(normalizeResearchRaterId("   "), null);
  });

  it("rejects unreasonably long values", () => {
    assert.equal(normalizeResearchRaterId("a".repeat(ML_RESEARCH_RATER_ID_MAX_LENGTH + 1)), null);
    assert.equal(normalizeResearchRaterId("a".repeat(ML_RESEARCH_RATER_ID_MAX_LENGTH)), "a".repeat(ML_RESEARCH_RATER_ID_MAX_LENGTH));
  });

  it("rejects control-character payloads", () => {
    assert.equal(normalizeResearchRaterId("rater\x00id"), null);
    assert.equal(normalizeResearchRaterId("rater\nid"), null);
  });
});

describe("buildPersistedShoulderAbductionReachLabelRecord", () => {
  it("uses the server-supplied labeledAtMs instead of any client submission time", () => {
    const forgedClientMs = 1;
    const serverMs = 1_700_000_000_000;
    const record = buildPersistedShoulderAbductionReachLabelRecord(
      {
        devSessionId: "dev-session-test",
        repetitionId: "dev-session-test-right-rep-1",
        sourceLineIndex: 0,
        side: "right",
        participantId: "dev-participant-001",
      },
      "therapist-A",
      {
        compensationLabel: "NO_COMPENSATION",
        exclusionFlag: null,
        raterConfidence: "high",
        note: "",
      },
      serverMs,
    );
    assert.equal(record.labeledAtMs, serverMs);
    assert.notEqual(record.labeledAtMs, forgedClientMs);
  });
});

describe("isValidShoulderAbductionReachLabelSubmission", () => {
  it("accepts a well-formed compensation-label submission", () => {
    assert.equal(isValidShoulderAbductionReachLabelSubmission(validSubmission()), true);
  });

  it("accepts a well-formed exclusion-flag submission", () => {
    assert.equal(
      isValidShoulderAbductionReachLabelSubmission({
        ...validSubmission(),
        compensationLabel: null,
        exclusionFlag: "WRONG_MOVEMENT_PLANE",
      }),
      true,
    );
  });

  it("rejects both compensationLabel and exclusionFlag set (double-label)", () => {
    assert.equal(
      isValidShoulderAbductionReachLabelSubmission({
        ...validSubmission(),
        compensationLabel: "NO_COMPENSATION",
        exclusionFlag: "NOT_REVIEWABLE",
      }),
      false,
    );
  });

  it("rejects neither compensationLabel nor exclusionFlag set (empty label)", () => {
    assert.equal(
      isValidShoulderAbductionReachLabelSubmission({
        ...validSubmission(),
        compensationLabel: null,
        exclusionFlag: null,
      }),
      false,
    );
  });

  it("rejects an invalid compensationLabel string", () => {
    assert.equal(
      isValidShoulderAbductionReachLabelSubmission({ ...validSubmission(), compensationLabel: "SOME_COMPENSATION" }),
      false,
    );
  });

  it("rejects an invalid exclusionFlag string", () => {
    assert.equal(
      isValidShoulderAbductionReachLabelSubmission({
        ...validSubmission(),
        compensationLabel: null,
        exclusionFlag: "WRONG_SIDE",
      }),
      false,
    );
  });

  for (const label of ["NO_COMPENSATION", "MILD_COMPENSATION", "CLEAR_COMPENSATION"] as const) {
    it(`accepts compensationLabel=${label}`, () => {
      assert.equal(
        isValidShoulderAbductionReachLabelSubmission({ ...validSubmission(), compensationLabel: label }),
        true,
      );
    });
  }

  for (const flag of ["WRONG_MOVEMENT_PLANE", "INCOMPLETE_REPETITION", "NOT_REVIEWABLE"] as const) {
    it(`accepts exclusionFlag=${flag}`, () => {
      assert.equal(
        isValidShoulderAbductionReachLabelSubmission({
          ...validSubmission(),
          compensationLabel: null,
          exclusionFlag: flag,
        }),
        true,
      );
    });
  }

  it("rejects a missing/empty raterId", () => {
    assert.equal(isValidShoulderAbductionReachLabelSubmission({ ...validSubmission(), raterId: "" }), false);
    assert.equal(isValidShoulderAbductionReachLabelSubmission({ ...validSubmission(), raterId: "   " }), false);
    assert.equal(isValidShoulderAbductionReachLabelSubmission(omit(validSubmission(), "raterId")), false);
  });

  it("accepts a raterId with leading/trailing whitespace that normalizes cleanly", () => {
    assert.equal(isValidShoulderAbductionReachLabelSubmission({ ...validSubmission(), raterId: "  therapist-A  " }), true);
  });

  it("rejects an overlong raterId", () => {
    assert.equal(
      isValidShoulderAbductionReachLabelSubmission({ ...validSubmission(), raterId: "a".repeat(ML_RESEARCH_RATER_ID_MAX_LENGTH + 1) }),
      false,
    );
  });

  it("rejects a raterId containing control characters", () => {
    assert.equal(isValidShoulderAbductionReachLabelSubmission({ ...validSubmission(), raterId: "rater\x7fid" }), false);
  });

  it("rejects a missing raterConfidence", () => {
    assert.equal(
      isValidShoulderAbductionReachLabelSubmission({ ...validSubmission(), raterConfidence: "certain" }),
      false,
    );
    assert.equal(isValidShoulderAbductionReachLabelSubmission(omit(validSubmission(), "raterConfidence")), false);
  });

  it("accepts every valid raterConfidence level", () => {
    for (const level of ["low", "medium", "high"] as const) {
      assert.equal(isValidShoulderAbductionReachLabelSubmission({ ...validSubmission(), raterConfidence: level }), true);
    }
  });

  it("rejects an invalid side", () => {
    assert.equal(isValidShoulderAbductionReachLabelSubmission({ ...validSubmission(), side: "both" }), false);
  });

  it("preserves side/session/repetition identity on a valid submission", () => {
    const submission = validSubmission();
    assert.equal(isValidShoulderAbductionReachLabelSubmission(submission), true);
    assert.equal(submission.devSessionId, "dev-session-test");
    assert.equal(submission.repetitionId, "dev-session-test-right-rep-1");
    assert.equal(submission.side, "right");
  });

  it("rejects a negative or non-integer sourceLineIndex", () => {
    assert.equal(isValidShoulderAbductionReachLabelSubmission({ ...validSubmission(), sourceLineIndex: -1 }), false);
    assert.equal(isValidShoulderAbductionReachLabelSubmission({ ...validSubmission(), sourceLineIndex: 1.5 }), false);
  });

  it("rejects a non-string note", () => {
    assert.equal(isValidShoulderAbductionReachLabelSubmission({ ...validSubmission(), note: 123 }), false);
  });

  it("rejects null and non-object input", () => {
    assert.equal(isValidShoulderAbductionReachLabelSubmission(null), false);
    assert.equal(isValidShoulderAbductionReachLabelSubmission("record"), false);
    assert.equal(isValidShoulderAbductionReachLabelSubmission(undefined), false);
  });

  it("does not require participantId, labelSchemaVersion, datasetVersion, or labeledAtMs (submission shape)", () => {
    const submission = validSubmission();
    assert.equal("participantId" in submission, false);
    assert.equal("labelSchemaVersion" in submission, false);
    assert.equal("datasetVersion" in submission, false);
    assert.equal("labeledAtMs" in submission, false);
  });

  it("rejects a submission that still carries labeledAtMs", () => {
    assert.equal(
      isValidShoulderAbductionReachLabelSubmission({ ...validSubmission(), labeledAtMs: Date.now() }),
      false,
    );
  });

  it("rejects a submission that carries participantId (server-owned)", () => {
    assert.equal(
      isValidShoulderAbductionReachLabelSubmission({ ...validSubmission(), participantId: "forged-participant" }),
      false,
    );
  });

  it("rejects a submission that carries labelSchemaVersion (server-owned)", () => {
    assert.equal(
      isValidShoulderAbductionReachLabelSubmission({ ...validSubmission(), labelSchemaVersion: "wrong-version" }),
      false,
    );
  });

  it("rejects a submission that carries datasetVersion (server-owned)", () => {
    assert.equal(
      isValidShoulderAbductionReachLabelSubmission({ ...validSubmission(), datasetVersion: "wrong-dataset" }),
      false,
    );
  });
});

describe("isValidShoulderAbductionReachLabelRecord", () => {
  it("accepts a well-formed full record", () => {
    assert.equal(isValidShoulderAbductionReachLabelRecord(validRecord()), true);
  });

  it("rejects a mismatched label schema version", () => {
    assert.equal(
      isValidShoulderAbductionReachLabelRecord({ ...validRecord(), labelSchemaVersion: "wrong" }),
      false,
    );
  });

  it("rejects a mismatched dataset version", () => {
    assert.equal(isValidShoulderAbductionReachLabelRecord({ ...validRecord(), datasetVersion: "wrong" }), false);
  });

  it("rejects a missing or empty participantId", () => {
    assert.equal(isValidShoulderAbductionReachLabelRecord({ ...validRecord(), participantId: "" }), false);
    assert.equal(isValidShoulderAbductionReachLabelRecord(omit(validRecord(), "participantId")), false);
  });

  it("rejects both compensationLabel and exclusionFlag set, same as the submission validator", () => {
    assert.equal(
      isValidShoulderAbductionReachLabelRecord({
        ...validRecord(),
        compensationLabel: "MILD_COMPENSATION",
        exclusionFlag: "INCOMPLETE_REPETITION",
      }),
      false,
    );
  });

  it("rejects neither set", () => {
    assert.equal(
      isValidShoulderAbductionReachLabelRecord({ ...validRecord(), compensationLabel: null, exclusionFlag: null }),
      false,
    );
  });

  it("rejects null and non-object input", () => {
    assert.equal(isValidShoulderAbductionReachLabelRecord(null), false);
    assert.equal(isValidShoulderAbductionReachLabelRecord("record"), false);
    assert.equal(isValidShoulderAbductionReachLabelRecord(undefined), false);
  });
});

describe("projectShoulderAbductionReachLabelForRater", () => {
  it("omits participantId from the rater-facing view", () => {
    const projected = projectShoulderAbductionReachLabelForRater(validRecord());
    assert.equal("participantId" in projected, false);
    assert.doesNotMatch(JSON.stringify(projected), /dev-participant-001/);
  });

  it("preserves every other field the labeling UI relies on", () => {
    const record = validRecord();
    const projected = projectShoulderAbductionReachLabelForRater(record);
    assert.deepEqual(projected, omit(record, "participantId"));
  });

  it("does not mutate or strip provenance from the persisted record", () => {
    const record = validRecord();
    projectShoulderAbductionReachLabelForRater(record);
    assert.equal(record.participantId, "dev-participant-001");
    assert.equal(isValidShoulderAbductionReachLabelRecord(record), true);
  });

  it("produces a view that is no longer a valid full record (participantId is required on disk)", () => {
    const projected = projectShoulderAbductionReachLabelForRater(validRecord());
    assert.equal(isValidShoulderAbductionReachLabelRecord(projected), false);
  });
});
