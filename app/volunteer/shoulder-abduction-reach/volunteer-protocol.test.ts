/**
 * Run: npx tsx --test app/volunteer/shoulder-abduction-reach/volunteer-protocol.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  VOLUNTEER_MOVEMENT_SAFETY_REMINDERS,
  VOLUNTEER_PROTOCOL_CONDITIONS,
  VOLUNTEER_TARGET_REPS,
  buildVolunteerSessionSummary,
  canProceedFromConsent,
  canProceedFromConsentWithCampaign,
  isCaptureComplete,
  isVolunteerProtocolCondition,
} from "./volunteer-protocol";

describe("volunteer-protocol", () => {
  it("requires age confirmation before consent can proceed", () => {
    assert.equal(
      canProceedFromConsent({ ageConfirmed: false, participationAgreed: true }),
      false,
    );
  });

  it("requires participation agreement before consent can proceed", () => {
    assert.equal(
      canProceedFromConsent({ ageConfirmed: true, participationAgreed: false }),
      false,
    );
  });

  it("allows continue only when both consent checkboxes are checked", () => {
    assert.equal(
      canProceedFromConsent({ ageConfirmed: true, participationAgreed: true }),
      true,
    );
  });

  it("restricts protocol conditions to the three allowed values", () => {
    assert.equal(VOLUNTEER_PROTOCOL_CONDITIONS.length, 3);
    for (const condition of VOLUNTEER_PROTOCOL_CONDITIONS) {
      assert.equal(isVolunteerProtocolCondition(condition), true);
    }
    assert.equal(isVolunteerProtocolCondition("CLEAR_COMPENSATION"), false);
    assert.equal(isVolunteerProtocolCondition(""), false);
    assert.equal(isVolunteerProtocolCondition("normal"), false);
  });

  it("builds summary with captured rep counts", () => {
    const summary = buildVolunteerSessionSummary({
      capturedCount: VOLUNTEER_TARGET_REPS,
      rejectedCount: 1,
      protocolCondition: "SIMULATED_MILD_COMPENSATION",
      side: "right",
      lastTrackingStatus: "good",
    });
    assert.equal(summary.capturedCount, 3);
    assert.equal(summary.rejectedCount, 1);
    assert.equal(summary.protocolCondition, "SIMULATED_MILD_COMPENSATION");
    assert.equal(summary.side, "right");
    assert.equal(summary.lastTrackingStatus, "good");
  });

  it("allows continue only when both consent checkboxes and campaign code are present", () => {
    assert.equal(
      canProceedFromConsentWithCampaign(
        { ageConfirmed: true, participationAgreed: true },
        "  PILOT  ",
      ),
      true,
    );
    assert.equal(
      canProceedFromConsentWithCampaign(
        { ageConfirmed: true, participationAgreed: true },
        "   ",
      ),
      false,
    );
  });

  it("marks capture complete at the target repetition count", () => {
    assert.equal(isCaptureComplete(2), false);
    assert.equal(isCaptureComplete(3), true);
    assert.equal(isCaptureComplete(4), true);
  });

  it("exposes non-clinical movement safety reminders", () => {
    assert.equal(VOLUNTEER_MOVEMENT_SAFETY_REMINDERS.length, 4);
    assert.match(VOLUNTEER_MOVEMENT_SAFETY_REMINDERS.join(" "), /pain-free range of motion/i);
    assert.match(VOLUNTEER_MOVEMENT_SAFETY_REMINDERS.join(" "), /Simulated compensation is optional/i);
  });
});
