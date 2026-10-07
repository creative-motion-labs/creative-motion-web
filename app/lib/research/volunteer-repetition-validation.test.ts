/**
 * Run: npx tsx --test app/lib/research/volunteer-repetition-validation.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ML_RESEARCH_FEATURE_SCHEMA_VERSION_V1,
} from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";
import {
  buildVolunteerRepetitionFixture,
  hashVolunteerRepetitionPayload,
  isVolunteerRepetitionBodyTooLarge,
  validateVolunteerRepetitionBody,
  VOLUNTEER_REPETITION_MAX_FRAMES,
  VOLUNTEER_REPETITION_MAX_JSON_BYTES,
} from "./volunteer-repetition-validation";

function bodyFromFixture(
  fixture: ReturnType<typeof buildVolunteerRepetitionFixture>,
) {
  return {
    movementSessionId: fixture.movementSessionId,
    clientSubmissionId: fixture.clientSubmissionId,
    repetitionIndex: fixture.repetitionIndex,
    captureSchemaVersion: fixture.captureSchemaVersion,
    featureSchemaVersion: fixture.featureSchemaVersion,
    startedAtMs: fixture.startedAtMs,
    endedAtMs: fixture.endedAtMs,
    frames: fixture.frames,
    derivedFeatures: fixture.derivedFeatures,
  };
}

describe("validateVolunteerRepetitionBody", () => {
  it("accepts a valid repetition payload", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const result = validateVolunteerRepetitionBody(bodyFromFixture(fixture));
    assert.equal(result.ok, true);
  });

  it("accepts feature schema v1", () => {
    const fixture = buildVolunteerRepetitionFixture({
      featureSchemaVersion: ML_RESEARCH_FEATURE_SCHEMA_VERSION_V1,
    });
    const result = validateVolunteerRepetitionBody(bodyFromFixture(fixture));
    assert.equal(result.ok, true);
  });

  it("rejects client identity fields", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const result = validateVolunteerRepetitionBody({
      ...bodyFromFixture(fixture),
      participantId: "client-controlled",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "Request contains unsupported fields.");
  });

  it("rejects arbitrary extra top-level keys", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const result = validateVolunteerRepetitionBody({
      ...bodyFromFixture(fixture),
      unexpectedField: "value",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "Request contains unsupported fields.");
  });

  it("rejects snake_case identity and ownership fields", () => {
    const fixture = buildVolunteerRepetitionFixture();
    for (const extra of [
      { participant_id: crypto.randomUUID() },
      { collection_session_id: crypto.randomUUID() },
      { payload_hash: "abc" },
    ]) {
      const result = validateVolunteerRepetitionBody({
        ...bodyFromFixture(fixture),
        ...extra,
      });
      assert.equal(result.ok, false, JSON.stringify(extra));
    }
  });

  it("rejects media-shaped top-level fields", () => {
    const fixture = buildVolunteerRepetitionFixture();
    for (const extra of [{ video: "x" }, { base64: "x" }, { blob: "x" }, { imageData: "x" }]) {
      const result = validateVolunteerRepetitionBody({
        ...bodyFromFixture(fixture),
        ...extra,
      });
      assert.equal(result.ok, false, JSON.stringify(extra));
    }
  });

  it("rejects unsupported capture schema", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const result = validateVolunteerRepetitionBody({
      ...bodyFromFixture(fixture),
      captureSchemaVersion: "wrong",
    });
    assert.equal(result.ok, false);
  });

  it("rejects empty frames", () => {
    const fixture = buildVolunteerRepetitionFixture({ frames: [] });
    const result = validateVolunteerRepetitionBody(bodyFromFixture(fixture));
    assert.equal(result.ok, false);
  });

  it("rejects excessive frame count", () => {
    const frames = Array.from({ length: VOLUNTEER_REPETITION_MAX_FRAMES + 1 }, (_, i) => ({
      relativeTimestampMs: i,
      frameIndex: i,
      joints: {},
    }));
    const fixture = buildVolunteerRepetitionFixture({ frames });
    const result = validateVolunteerRepetitionBody(bodyFromFixture(fixture));
    assert.equal(result.ok, false);
  });

  it("rejects non-sequential frame indexes", () => {
    const fixture = buildVolunteerRepetitionFixture({
      frames: [
        { relativeTimestampMs: 0, frameIndex: 0, joints: {} },
        { relativeTimestampMs: 10, frameIndex: 2, joints: {} },
      ],
    });
    const result = validateVolunteerRepetitionBody(bodyFromFixture(fixture));
    assert.equal(result.ok, false);
  });

  it("rejects non-monotonic timestamps", () => {
    const fixture = buildVolunteerRepetitionFixture({
      frames: [
        { relativeTimestampMs: 10, frameIndex: 0, joints: {} },
        { relativeTimestampMs: 5, frameIndex: 1, joints: {} },
      ],
    });
    const result = validateVolunteerRepetitionBody(bodyFromFixture(fixture));
    assert.equal(result.ok, false);
  });

  it("rejects invalid joint keys", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const body = bodyFromFixture(fixture);
    body.frames[0] = {
      relativeTimestampMs: 0,
      frameIndex: 0,
      joints: {
        nose: {
          landmark: { x: 0.1, y: 0.2 },
          confidence: { visibility: 0.9, present: true },
        },
      },
    };
    const result = validateVolunteerRepetitionBody(body);
    assert.equal(result.ok, false);
  });

  it("rejects NaN landmark coordinates", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const body = bodyFromFixture(fixture);
    body.frames[0] = {
      relativeTimestampMs: 0,
      frameIndex: 0,
      joints: {
        right_shoulder: {
          landmark: { x: Number.NaN, y: 0.2 },
          confidence: { visibility: 0.9, present: true },
        },
      },
    };
    const result = validateVolunteerRepetitionBody(body);
    assert.equal(result.ok, false);
  });

  it("rejects trackingQuality framesTotal mismatch", () => {
    const fixture = buildVolunteerRepetitionFixture();
    fixture.derivedFeatures.trackingQuality.framesTotal = 99;
    const result = validateVolunteerRepetitionBody(bodyFromFixture(fixture));
    assert.equal(result.ok, false);
  });

  it("does not require exact movementDurationMs vs timestamp span", () => {
    const fixture = buildVolunteerRepetitionFixture({
      endedAtMs: 2_000,
      startedAtMs: 1_000,
      derivedFeatures: {
        ...buildVolunteerRepetitionFixture().derivedFeatures,
        movementDurationMs: 500,
      },
    });
    const result = validateVolunteerRepetitionBody(bodyFromFixture(fixture));
    assert.equal(result.ok, true);
  });

  it("rejects extra properties on frames", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const body = bodyFromFixture(fixture);
    body.frames[0] = { ...body.frames[0]!, injected: true } as typeof body.frames[0];
    const result = validateVolunteerRepetitionBody(body);
    assert.equal(result.ok, false);
  });

  it("rejects extra properties on joints", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const body = bodyFromFixture(fixture);
    const joint = body.frames[0]!.joints.right_shoulder!;
    body.frames[0]!.joints.right_shoulder = { ...joint, injected: true } as typeof joint;
    const result = validateVolunteerRepetitionBody(body);
    assert.equal(result.ok, false);
  });

  it("rejects extra properties on landmarks", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const body = bodyFromFixture(fixture);
    const joint = body.frames[0]!.joints.right_shoulder!;
    body.frames[0]!.joints.right_shoulder = {
      ...joint,
      landmark: { ...joint.landmark, w: 1 },
    };
    const result = validateVolunteerRepetitionBody(body);
    assert.equal(result.ok, false);
  });

  it("rejects extra properties on derivedFeatures", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const body = bodyFromFixture(fixture);
    const result = validateVolunteerRepetitionBody({
      ...body,
      derivedFeatures: { ...body.derivedFeatures, injected: "x" },
    });
    assert.equal(result.ok, false);
  });

  it("rejects extra properties on trackingQuality", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const body = bodyFromFixture(fixture);
    body.derivedFeatures = {
      ...body.derivedFeatures,
      trackingQuality: {
        ...body.derivedFeatures.trackingQuality,
        injected: 1,
      },
    };
    const result = validateVolunteerRepetitionBody(body);
    assert.equal(result.ok, false);
  });

  it("returns sanitized frames without injected properties", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const result = validateVolunteerRepetitionBody(bodyFromFixture(fixture));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const frame = result.value.frames[0]!;
    assert.deepEqual(Object.keys(frame).sort(), ["frameIndex", "joints", "relativeTimestampMs"]);
    const joint = frame.joints.right_shoulder!;
    assert.deepEqual(Object.keys(joint).sort(), ["confidence", "landmark"]);
    assert.deepEqual(Object.keys(joint.landmark).sort(), ["x", "y"]);
    assert.deepEqual(Object.keys(joint.confidence).sort(), ["present", "visibility"]);
  });

  it("rejects x outside unit interval", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const body = bodyFromFixture(fixture);
    body.frames[0]!.joints.right_shoulder!.landmark.x = 1.01;
    assert.equal(validateVolunteerRepetitionBody(body).ok, false);
    body.frames[0]!.joints.right_shoulder!.landmark.x = -0.01;
    assert.equal(validateVolunteerRepetitionBody(body).ok, false);
  });

  it("rejects y outside unit interval", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const body = bodyFromFixture(fixture);
    body.frames[0]!.joints.right_shoulder!.landmark.y = 2;
    assert.equal(validateVolunteerRepetitionBody(body).ok, false);
  });

  it("rejects visibility outside unit interval", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const body = bodyFromFixture(fixture);
    body.frames[0]!.joints.right_shoulder!.confidence.visibility = 1.5;
    assert.equal(validateVolunteerRepetitionBody(body).ok, false);
  });

  it("accepts optional finite z without enforcing a depth range", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const body = bodyFromFixture(fixture);
    body.frames[0]!.joints.right_shoulder!.landmark.z = 5.5;
    const result = validateVolunteerRepetitionBody(body);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.frames[0]!.joints.right_shoulder!.landmark.z, 5.5);
    }
  });

  it("rejects non-finite z", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const body = bodyFromFixture(fixture);
    body.frames[0]!.joints.right_shoulder!.landmark.z = Number.POSITIVE_INFINITY;
    assert.equal(validateVolunteerRepetitionBody(body).ok, false);
  });

  it("accepts null minCoreJointVisibility", () => {
    const fixture = buildVolunteerRepetitionFixture();
    fixture.derivedFeatures.trackingQuality.minCoreJointVisibility = null;
    assert.equal(validateVolunteerRepetitionBody(bodyFromFixture(fixture)).ok, true);
  });

  it("rejects minCoreJointVisibility outside unit interval", () => {
    const fixture = buildVolunteerRepetitionFixture();
    fixture.derivedFeatures.trackingQuality.minCoreJointVisibility = 1.2;
    assert.equal(validateVolunteerRepetitionBody(bodyFromFixture(fixture)).ok, false);
  });

  it("rejects usableFrameRatio outside unit interval", () => {
    const fixture = buildVolunteerRepetitionFixture();
    fixture.derivedFeatures.trackingQuality.usableFrameRatio = 1.5;
    assert.equal(validateVolunteerRepetitionBody(bodyFromFixture(fixture)).ok, false);
  });

  it("rejects inconsistent usableFrameRatio beyond float tolerance", () => {
    const fixture = buildVolunteerRepetitionFixture();
    fixture.derivedFeatures.trackingQuality.framesWithUsableAngle = 1;
    fixture.derivedFeatures.trackingQuality.usableFrameRatio = 0.9;
    assert.equal(validateVolunteerRepetitionBody(bodyFromFixture(fixture)).ok, false);
  });

  it("accepts usableFrameRatio within float tolerance of framesWithUsableAngle / framesTotal", () => {
    const fixture = buildVolunteerRepetitionFixture();
    fixture.derivedFeatures.trackingQuality.framesWithUsableAngle = 1;
    fixture.derivedFeatures.trackingQuality.usableFrameRatio = 0.5 + 1e-7;
    assert.equal(validateVolunteerRepetitionBody(bodyFromFixture(fixture)).ok, true);
  });

  it("rejects framesWithUsableAngle above framesTotal", () => {
    const fixture = buildVolunteerRepetitionFixture();
    fixture.derivedFeatures.trackingQuality.framesWithUsableAngle = 99;
    fixture.derivedFeatures.trackingQuality.usableFrameRatio = 1;
    assert.equal(validateVolunteerRepetitionBody(bodyFromFixture(fixture)).ok, false);
  });
});

describe("hashVolunteerRepetitionPayload", () => {
  it("is deterministic regardless of property order", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const a = hashVolunteerRepetitionPayload(fixture);
    const reordered = {
      derivedFeatures: fixture.derivedFeatures,
      frames: fixture.frames,
      endedAtMs: fixture.endedAtMs,
      startedAtMs: fixture.startedAtMs,
      repetitionIndex: fixture.repetitionIndex,
      featureSchemaVersion: fixture.featureSchemaVersion,
      captureSchemaVersion: fixture.captureSchemaVersion,
    };
    const b = hashVolunteerRepetitionPayload(reordered);
    assert.equal(a, b);
  });

  it("changes when payload content changes", () => {
    const base = buildVolunteerRepetitionFixture();
    const changed = buildVolunteerRepetitionFixture({ repetitionIndex: 2 });
    assert.notEqual(
      hashVolunteerRepetitionPayload(base),
      hashVolunteerRepetitionPayload(changed),
    );
  });

  it("matches hash of validated sanitized payload, not unsanitized input with extra keys", () => {
    const fixture = buildVolunteerRepetitionFixture();
    const clean = validateVolunteerRepetitionBody(bodyFromFixture(fixture));
    assert.equal(clean.ok, true);
    if (!clean.ok) return;

    const dirtyBody = bodyFromFixture(fixture);
    dirtyBody.frames[0] = { ...dirtyBody.frames[0]!, injected: true } as typeof dirtyBody.frames[0];
    assert.equal(validateVolunteerRepetitionBody(dirtyBody).ok, false);

    const unsanitizedHash = hashVolunteerRepetitionPayload({
      repetitionIndex: clean.value.repetitionIndex,
      captureSchemaVersion: clean.value.captureSchemaVersion,
      featureSchemaVersion: clean.value.featureSchemaVersion,
      startedAtMs: clean.value.startedAtMs,
      endedAtMs: clean.value.endedAtMs,
      frames: dirtyBody.frames,
      derivedFeatures: clean.value.derivedFeatures,
    });
    assert.notEqual(hashVolunteerRepetitionPayload(clean.value), unsanitizedHash);
  });
});

describe("isVolunteerRepetitionBodyTooLarge", () => {
  it("flags content-length above the cap", () => {
    assert.equal(
      isVolunteerRepetitionBodyTooLarge(String(VOLUNTEER_REPETITION_MAX_JSON_BYTES + 1)),
      true,
    );
    assert.equal(
      isVolunteerRepetitionBodyTooLarge(String(VOLUNTEER_REPETITION_MAX_JSON_BYTES)),
      false,
    );
  });
});
