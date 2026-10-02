/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-prescribed-side.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeBatteryPrescribedSide,
  PRESCRIBED_SIDE_UNAVAILABLE_MESSAGE,
  readBatteryPrescribedSideFromUlmsAssignment,
  resolveBatteryPrescribedSideForPatientDisplay,
} from "./battery-prescribed-side";
import { getBatteryTestStartVoiceCopy } from "./battery-voice-copy";

describe("battery prescribed side", () => {
  it("resolves left from assignment payload", () => {
    const side = readBatteryPrescribedSideFromUlmsAssignment({
      affectedSide: "right",
      taskAssignmentGroups: [{ taskId: "shoulderAbduction", testedSide: "left", attempts: 1, restPeriodSeconds: 0, eligible: true }],
    } as never);
    assert.equal(side, "left");
    assert.match(getBatteryTestStartVoiceCopy("shoulderAbduction", side!, "en"), /left arm/i);
  });

  it("resolves right from assignment payload", () => {
    const side = readBatteryPrescribedSideFromUlmsAssignment({
      affectedSide: "left",
      taskAssignmentGroups: [{ taskId: "shoulderAbduction", testedSide: "right", attempts: 1, restPeriodSeconds: 0, eligible: true }],
    } as never);
    assert.equal(side, "right");
    assert.match(getBatteryTestStartVoiceCopy("shoulderAbduction", side!, "en"), /right arm/i);
  });

  it("does not change resolved side when mirror preview is enabled", () => {
    assert.equal(resolveBatteryPrescribedSideForPatientDisplay("left", true), "left");
    assert.equal(resolveBatteryPrescribedSideForPatientDisplay("left", false), "left");
    assert.equal(resolveBatteryPrescribedSideForPatientDisplay("right", true), "right");
  });

  it("returns null for missing or invalid side without guessing", () => {
    assert.equal(normalizeBatteryPrescribedSide(undefined), null);
    assert.equal(normalizeBatteryPrescribedSide("bilateral"), null);
    assert.equal(normalizeBatteryPrescribedSide(""), null);
    assert.equal(
      readBatteryPrescribedSideFromUlmsAssignment({
        affectedSide: "left",
        taskAssignmentGroups: [],
      } as never),
      null,
    );
    assert.equal(PRESCRIBED_SIDE_UNAVAILABLE_MESSAGE.includes("therapist"), true);
  });
});
