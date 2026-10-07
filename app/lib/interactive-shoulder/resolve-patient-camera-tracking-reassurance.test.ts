/**
 * Run: npx tsx --test app/lib/interactive-shoulder/resolve-patient-camera-tracking-reassurance.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolvePatientCameraTrackingReassuranceCopy,
  resolvePatientCameraTrackingReassuranceState,
} from "./resolve-patient-camera-tracking-reassurance";

describe("resolvePatientCameraTrackingReassurance", () => {
  it("maps tracking status to Good in English", () => {
    assert.equal(resolvePatientCameraTrackingReassuranceState("tracking"), "good");
    const copy = resolvePatientCameraTrackingReassuranceCopy("en", "tracking");
    assert.deepEqual(copy, { label: "Camera tracking", status: "Good" });
  });

  it("maps non-tracking states to Adjusting in English without poor labels", () => {
    for (const status of ["idle", "lost", "error", null, undefined] as const) {
      assert.equal(resolvePatientCameraTrackingReassuranceState(status), "adjusting");
      const copy = resolvePatientCameraTrackingReassuranceCopy("en", status);
      assert.equal(copy.label, "Camera tracking");
      assert.equal(copy.status, "Adjusting");
      assert.ok(!copy.status.toLowerCase().includes("poor"));
      assert.ok(!copy.status.toLowerCase().includes("normal"));
    }
  });

  it("maps tracking status to Arabic reassurance copy", () => {
    const good = resolvePatientCameraTrackingReassuranceCopy("ar", "tracking");
    assert.deepEqual(good, { label: "تتبع الكاميرا", status: "جيد" });

    const adjusting = resolvePatientCameraTrackingReassuranceCopy("ar", "lost");
    assert.deepEqual(adjusting, { label: "تتبع الكاميرا", status: "جارٍ الضبط" });
  });
});
