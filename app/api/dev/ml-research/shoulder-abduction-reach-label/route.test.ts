/**
 * Run: npx tsx --test app/api/dev/ml-research/shoulder-abduction-reach-label/route.test.ts
 *
 * Behavioral route-level tests for the dev-only shoulder abduction reach label API.
 * Uses an isolated test session ID distinct from any real research session, and
 * deterministically cleans up test files afterward.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { readFile, unlink } from "node:fs/promises";
import { NextRequest } from "next/server";
import {
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
  type ShoulderAbductionReachRepCaptureRecord,
} from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";
import { readShoulderAbductionCaptureSessionForLabeling } from "@/app/lib/ml-research/shoulder-abduction-reach/capture-reader";
import {
  ML_RESEARCH_DATASET_VERSION,
  ML_RESEARCH_LABEL_SCHEMA_VERSION,
  type ShoulderAbductionReachLabelForRater,
  type ShoulderAbductionReachLabelRecord,
  type ShoulderAbductionReachLabelSubmission,
} from "@/app/lib/ml-research/shoulder-abduction-reach/label-schema";
import { resolveDevSessionLabelsJsonlPath } from "@/app/lib/ml-research/shoulder-abduction-reach/local-label-writer";
import {
  appendShoulderAbductionReachRepRecordLocally,
  resolveDevSessionJsonlPath,
} from "@/app/lib/ml-research/shoulder-abduction-reach/local-jsonl-writer";
import { GET, POST } from "./route";

const TEST_SESSION_ID = "test-fixture-route-label-api-do-not-use";
const ROUTE_URL = "http://localhost/api/dev/ml-research/shoulder-abduction-reach-label";

function captureRecord(side: "left" | "right"): ShoulderAbductionReachRepCaptureRecord {
  return {
    context: {
      captureSchemaVersion: ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
      featureSchemaVersion: ML_RESEARCH_FEATURE_SCHEMA_VERSION,
      participantId: "route-test-participant-authoritative",
      devSessionId: TEST_SESSION_ID,
      repetitionIndex: 1,
      repetitionId: `${TEST_SESSION_ID}-rep-1`,
      side,
      movementType: "shoulder_abduction_reach",
      startedAtMs: 1000,
      endedAtMs: 2000,
      simulationCondition: "simulated_trunk_lean",
    },
    frames: [{ relativeTimestampMs: 0, frameIndex: 0, joints: {} }],
    derivedFeatures: {
      peakNormalizedTrunkDriftRatio: 0.5,
      peakShoulderAngleDegrees: 120,
      movementDurationMs: 1000,
      peakAngularVelocityDegPerSec: 500,
      trackingQuality: { framesTotal: 1, framesWithUsableAngle: 1, usableFrameRatio: 1 },
    },
  };
}

function makePostRequest(body: unknown): NextRequest {
  const bodyText = JSON.stringify(body);
  return new NextRequest(ROUTE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(bodyText)) },
    body: bodyText,
  });
}

function makeGetRequest(query: Record<string, string>): NextRequest {
  const url = new URL(ROUTE_URL);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url.toString(), { method: "GET" });
}

async function readPersistedLabels(): Promise<ShoulderAbductionReachLabelRecord[]> {
  const raw = await readFile(resolveDevSessionLabelsJsonlPath(TEST_SESSION_ID), "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ShoulderAbductionReachLabelRecord);
}

async function seedCaptureFixture(): Promise<ShoulderAbductionReachRepForLabelingFixture> {
  await unlink(resolveDevSessionJsonlPath(TEST_SESSION_ID)).catch(() => {});
  await unlink(resolveDevSessionLabelsJsonlPath(TEST_SESSION_ID)).catch(() => {});
  await appendShoulderAbductionReachRepRecordLocally(captureRecord("right"));
  const reps = await readShoulderAbductionCaptureSessionForLabeling(TEST_SESSION_ID);
  assert.equal(reps.length, 1);
  return reps[0];
}

type ShoulderAbductionReachRepForLabelingFixture = Awaited<
  ReturnType<typeof readShoulderAbductionCaptureSessionForLabeling>
>[number];

function validSubmission(
  rep: ShoulderAbductionReachRepForLabelingFixture,
  overrides: Partial<ShoulderAbductionReachLabelSubmission> = {},
): ShoulderAbductionReachLabelSubmission {
  return {
    devSessionId: TEST_SESSION_ID,
    sourceLineIndex: rep.sourceLineIndex,
    repetitionId: rep.repetitionId,
    side: rep.side,
    raterId: "therapist-A",
    compensationLabel: "NO_COMPENSATION",
    exclusionFlag: null,
    raterConfidence: "high",
    note: "route test",
    ...overrides,
  };
}

describe("shoulder-abduction-reach-label route (behavioral)", { concurrency: 1 }, () => {
  let savedNodeEnv: string | undefined;
  let rep: ShoulderAbductionReachRepForLabelingFixture;

  before(async () => {
    savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    rep = await seedCaptureFixture();
  });

  after(async () => {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    await unlink(resolveDevSessionJsonlPath(TEST_SESSION_ID)).catch(() => {});
    await unlink(resolveDevSessionLabelsJsonlPath(TEST_SESSION_ID)).catch(() => {});
  });

  it("POST accepts a valid submission without labeledAtMs and persists a valid label", async () => {
    const res = await POST(makePostRequest(validSubmission(rep)));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; filePath: string };
    assert.equal(body.ok, true);
    assert.match(body.filePath, new RegExp(`${TEST_SESSION_ID}\\.labels\\.jsonl$`));

    const labels = await readPersistedLabels();
    assert.equal(labels.length, 1);
    assert.equal(labels[0].participantId, "route-test-participant-authoritative");
    assert.equal(labels[0].devSessionId, TEST_SESSION_ID);
    assert.equal(labels[0].sourceLineIndex, rep.sourceLineIndex);
    assert.equal(labels[0].repetitionId, rep.repetitionId);
    assert.equal(labels[0].side, rep.side);
    assert.equal(labels[0].labelSchemaVersion, ML_RESEARCH_LABEL_SCHEMA_VERSION);
    assert.equal(labels[0].datasetVersion, ML_RESEARCH_DATASET_VERSION);
    assert.equal(Number.isFinite(labels[0].labeledAtMs), true);
  });

  it("POST rejects client-supplied labeledAtMs and stamps server time instead", async () => {
    await unlink(resolveDevSessionLabelsJsonlPath(TEST_SESSION_ID)).catch(() => {});

    const withClientTimestamp = { ...validSubmission(rep), labeledAtMs: 1_600_000_000_000 };
    const rejectRes = await POST(makePostRequest(withClientTimestamp));
    assert.equal(rejectRes.status, 400);
    assert.equal(((await rejectRes.json()) as { error: string }).error, "invalid_record_shape");

    const fixedNow = 1_700_000_123_456;
    const realDateNow = Date.now;
    Date.now = () => fixedNow;
    try {
      const acceptRes = await POST(makePostRequest(validSubmission(rep, { raterId: "therapist-B" })));
      assert.equal(acceptRes.status, 200);
      const labels = await readPersistedLabels();
      assert.equal(labels.length, 1);
      assert.equal(labels[0].labeledAtMs, fixedNow);
      assert.notEqual(labels[0].labeledAtMs, 1_600_000_000_000);
    } finally {
      Date.now = realDateNow;
    }
  });

  it("POST rejects wrong repetitionId, side, sourceLineIndex, and devSessionId", async () => {
    const cases: Array<{ name: string; overrides: Partial<ShoulderAbductionReachLabelSubmission> }> = [
      { name: "repetitionId", overrides: { repetitionId: "wrong-rep-id" } },
      { name: "side", overrides: { side: "left" } },
      { name: "sourceLineIndex", overrides: { sourceLineIndex: rep.sourceLineIndex + 99 } },
      { name: "devSessionId", overrides: { devSessionId: "no-such-session-route-test" } },
    ];

    for (const testCase of cases) {
      const res = await POST(makePostRequest(validSubmission(rep, testCase.overrides)));
      assert.equal(res.status, 400, testCase.name);
      assert.equal(((await res.json()) as { error: string }).error, "repetition_not_found", testCase.name);
    }
  });

  it("POST persists normalized raterId and rejects malformed raters", async () => {
    await unlink(resolveDevSessionLabelsJsonlPath(TEST_SESSION_ID)).catch(() => {});

    const normalizedRes = await POST(makePostRequest(validSubmission(rep, { raterId: "  therapist-C  " })));
    assert.equal(normalizedRes.status, 200);
    const labels = await readPersistedLabels();
    assert.equal(labels[0].raterId, "therapist-C");

    for (const badRaterId of ["", "   ", "bad\x01id"]) {
      const res = await POST(makePostRequest(validSubmission(rep, { raterId: badRaterId })));
      assert.equal(res.status, 400);
      assert.equal(((await res.json()) as { error: string }).error, "invalid_record_shape");
    }
  });

  it("POST rejects malformed submissions and invalid JSON", async () => {
    const malformedRes = await POST(makePostRequest({ devSessionId: TEST_SESSION_ID }));
    assert.equal(malformedRes.status, 400);
    assert.equal(((await malformedRes.json()) as { error: string }).error, "invalid_record_shape");

    const invalidJsonReq = new NextRequest(ROUTE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    const invalidJsonRes = await POST(invalidJsonReq);
    assert.equal(invalidJsonRes.status, 400);
    assert.equal(((await invalidJsonRes.json()) as { error: string }).error, "invalid_json");
  });

  it("POST rejects all server-owned fields (participantId, labelSchemaVersion, datasetVersion, labeledAtMs)", async () => {
    const serverOwnedFields = [
      { field: "participantId", value: "forged-participant" },
      { field: "labelSchemaVersion", value: "forged-schema-version" },
      { field: "datasetVersion", value: "forged-dataset-version" },
      { field: "labeledAtMs", value: Date.now() },
    ];

    for (const { field, value } of serverOwnedFields) {
      const forgedSubmission = { ...validSubmission(rep), [field]: value };
      const res = await POST(makePostRequest(forgedSubmission));
      assert.equal(res.status, 400, `Should reject server-owned field: ${field}`);
      assert.equal(
        ((await res.json()) as { error: string }).error,
        "invalid_record_shape",
        `Should reject server-owned field: ${field}`,
      );
    }
  });

  it("GET normalizes raterId, rejects malformed raterId, and blinds the ENTIRE payload", async () => {
    await unlink(resolveDevSessionLabelsJsonlPath(TEST_SESSION_ID)).catch(() => {});
    const postRes = await POST(makePostRequest(validSubmission(rep, { raterId: " therapist-D " })));
    assert.equal(postRes.status, 200);

    const missingRaterRes = await GET(makeGetRequest({ devSessionId: TEST_SESSION_ID }));
    assert.equal(missingRaterRes.status, 400);
    assert.equal(((await missingRaterRes.json()) as { error: string }).error, "rater_id_required");

    const badRaterRes = await GET(makeGetRequest({ devSessionId: TEST_SESSION_ID, raterId: "   " }));
    assert.equal(badRaterRes.status, 400);
    assert.equal(((await badRaterRes.json()) as { error: string }).error, "rater_id_required");

    const getRes = await GET(makeGetRequest({ devSessionId: TEST_SESSION_ID, raterId: "therapist-D" }));
    assert.equal(getRes.status, 200);
    const payload = (await getRes.json()) as {
      reps: unknown[];
      labels: ShoulderAbductionReachLabelForRater[];
    };
    assert.equal(payload.labels.length, 1);
    assert.equal(payload.labels[0].raterId, "therapist-D");

    // The returned label must be structurally free of participant identity, not
    // merely free of it for this fixture.
    assert.equal("participantId" in payload.labels[0], false);

    // Blinding is asserted against the WHOLE browser-facing payload — reps AND
    // labels — because a leak in either half breaks the blinded workflow.
    const serializedPayload = JSON.stringify(payload).toLowerCase();
    for (const forbidden of [
      "participantid",
      "route-test-participant-authoritative",
      "derivedfeatures",
      "simulationcondition",
      "peaknormalizedtrunkdriftratio",
      "peakshoulderangledegrees",
      "peakangularvelocitydegpersec",
      "predictedcompensation",
      "compensationdetected",
      "compensationflag",
    ]) {
      assert.doesNotMatch(serializedPayload, new RegExp(forbidden), forbidden);
    }

    // The rater's OWN judgment must still round-trip, so blinding cannot be
    // trivially satisfied by returning nothing useful.
    assert.equal(payload.labels[0].compensationLabel, "NO_COMPENSATION");
    assert.equal(payload.labels[0].sourceLineIndex, rep.sourceLineIndex);

    // Provenance is withheld from the browser, NOT dropped from disk.
    const persisted = await readPersistedLabels();
    assert.equal(persisted[0].participantId, "route-test-participant-authoritative");
  });

  it("POST rejects a body carrying a media-shaped key and persists nothing", async () => {
    await unlink(resolveDevSessionLabelsJsonlPath(TEST_SESSION_ID)).catch(() => {});

    const mediaShapedKeys = [
      "videoBase64",
      "imageDataUrl",
      "frame_blob",
      "rawVideo",
      "thumbnailImage",
    ];

    for (const key of mediaShapedKeys) {
      const res = await POST(makePostRequest({ ...validSubmission(rep), [key]: "AAAA" }));
      assert.equal(res.status, 400, key);
      assert.equal(((await res.json()) as { error: string }).error, "forbidden_payload_key", key);
    }

    // A nested media-shaped key must be caught too, not just a top-level one.
    const nestedRes = await POST(
      makePostRequest({ ...validSubmission(rep), metadata: { capture: { videoBase64: "AAAA" } } }),
    );
    assert.equal(nestedRes.status, 400);
    assert.equal(((await nestedRes.json()) as { error: string }).error, "forbidden_payload_key");

    // Rejected at the HTTP boundary means nothing reached the JSONL file.
    await assert.rejects(() => readPersistedLabels(), /ENOENT/);

    // The guard must not reject a legitimate submission whose free-text note
    // merely mentions video — the pattern applies to KEYS, not values.
    const noteRes = await POST(
      makePostRequest(validSubmission(rep, { note: "no video was captured for this rep" })),
    );
    assert.equal(noteRes.status, 200);
    const persisted = await readPersistedLabels();
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].note, "no video was captured for this rep");
  });

  it("GET and POST refuse to operate outside development", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const getRes = await GET(makeGetRequest({ devSessionId: TEST_SESSION_ID, raterId: "therapist-A" }));
      assert.equal(getRes.status, 404);
      assert.equal(((await getRes.json()) as { error: string }).error, "not_found");

      const postRes = await POST(makePostRequest(validSubmission(rep)));
      assert.equal(postRes.status, 404);
      assert.equal(((await postRes.json()) as { error: string }).error, "not_found");
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
