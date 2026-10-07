/**
 * Run: npx tsx --test app/lib/research/volunteer-validation.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  VOLUNTEER_CONSENT_VERSION,
  VOLUNTEER_PROTOCOL_VERSION,
} from "./volunteer-constants";
import {
  validateVolunteerMovementSessionBody,
  validateVolunteerSessionCreateBody,
} from "./volunteer-validation";

const validCreateBody = {
  campaignCode: "code",
  ageConfirmed18Plus: true,
  consentVersion: VOLUNTEER_CONSENT_VERSION,
  protocolVersion: VOLUNTEER_PROTOCOL_VERSION,
};

describe("validateVolunteerSessionCreateBody", () => {
  it("rejects missing campaign code", () => {
    const result = validateVolunteerSessionCreateBody({
      ...validCreateBody,
      campaignCode: "",
    });
    assert.equal(result.ok, false);
  });

  it("rejects ageConfirmed18Plus false", () => {
    const result = validateVolunteerSessionCreateBody({
      ...validCreateBody,
      ageConfirmed18Plus: false,
    });
    assert.equal(result.ok, false);
  });

  it("rejects invalid consent version", () => {
    assert.equal(
      validateVolunteerSessionCreateBody({
        ...validCreateBody,
        consentVersion: "wrong",
      }).ok,
      false,
    );
  });

  it("rejects client-supplied consentAcceptedAtMs", () => {
    for (const forged of [0, 1, Date.now(), Date.now() + 60_000]) {
      const result = validateVolunteerSessionCreateBody({
        ...validCreateBody,
        consentAcceptedAtMs: forged,
      });
      assert.equal(result.ok, false);
    }
  });

  it("rejects extra session fields", () => {
    for (const extra of [
      { participantId: crypto.randomUUID() },
      { sessionToken: "forged-token" },
      { deletionCode: "ABCD-1234" },
      { collectionSessionId: crypto.randomUUID() },
      { status: "completed" },
      { nested: { campaignCode: "x" } },
    ]) {
      const result = validateVolunteerSessionCreateBody({
        ...validCreateBody,
        ...extra,
      });
      assert.equal(result.ok, false, JSON.stringify(extra));
    }
  });

  it("accepts valid create body", () => {
    const result = validateVolunteerSessionCreateBody(validCreateBody);
    assert.equal(result.ok, true);
  });
});

describe("validateVolunteerMovementSessionBody", () => {
  it("accepts shoulder_abduction_reach right side", () => {
    const result = validateVolunteerMovementSessionBody({
      movementType: "shoulder_abduction_reach",
      protocolCondition: "NORMAL",
      side: "right",
    });
    assert.equal(result.ok, true);
  });

  it("rejects unsupported movement type", () => {
    const result = validateVolunteerMovementSessionBody({
      movementType: "forward_reach",
      protocolCondition: "NORMAL",
      side: "right",
    });
    assert.equal(result.ok, false);
  });

  it("rejects invalid protocol condition", () => {
    const result = validateVolunteerMovementSessionBody({
      movementType: "shoulder_abduction_reach",
      protocolCondition: "THERAPIST_GROUND_TRUTH",
      side: "right",
    });
    assert.equal(result.ok, false);
  });

  it("rejects left side during pilot", () => {
    const result = validateVolunteerMovementSessionBody({
      movementType: "shoulder_abduction_reach",
      protocolCondition: "NORMAL",
      side: "left",
    });
    assert.equal(result.ok, false);
  });

  it("rejects extra movement fields", () => {
    const result = validateVolunteerMovementSessionBody({
      movementType: "shoulder_abduction_reach",
      protocolCondition: "NORMAL",
      side: "right",
      blockIndex: 99,
    });
    assert.equal(result.ok, false);
  });
});
