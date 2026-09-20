/**
 * Run: npx tsx --test app/lib/clinical/clinical-prescribed-side.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseClinicalPrescribedSide,
  parsePlanSessionPrescriptionsFromBody,
  serializeClinicalPrescribedSideFromDb,
  toCatalogRpcSessionPrescribedSides,
  validateGuidedPlanSessionPrescriptions,
} from "./clinical-prescribed-side";

describe("clinical-prescribed-side validation", () => {
  it("accepts left and right exactly", () => {
    assert.deepEqual(parseClinicalPrescribedSide("left"), { ok: true, value: "left" });
    assert.deepEqual(parseClinicalPrescribedSide("right"), { ok: true, value: "right" });
  });

  it("treats missing values as null, not right", () => {
    assert.deepEqual(parseClinicalPrescribedSide(undefined), { ok: true, value: null });
    assert.deepEqual(parseClinicalPrescribedSide(null), { ok: true, value: null });
  });

  it("rejects bilateral as an Interactive Shoulder prescription value", () => {
    const result = parseClinicalPrescribedSide("bilateral");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /bilateral/i);
    }
  });

  it("rejects uppercase and mixed-case variants", () => {
    for (const value of ["Left", "RIGHT", " RiGhT "]) {
      const result = parseClinicalPrescribedSide(value);
      assert.equal(result.ok, false);
    }
  });

  it("rejects arrays, objects, and empty strings", () => {
    for (const value of [[], {}, "", "   "]) {
      const result = parseClinicalPrescribedSide(value);
      assert.equal(result.ok, false);
    }
  });

  it("serializes only valid stored db values", () => {
    assert.equal(serializeClinicalPrescribedSideFromDb(null), null);
    assert.equal(serializeClinicalPrescribedSideFromDb("left"), "left");
    assert.equal(serializeClinicalPrescribedSideFromDb("right"), "right");
    assert.equal(serializeClinicalPrescribedSideFromDb("bilateral"), null);
  });
});

describe("guided plan session prescriptions", () => {
  it("maps left and right per session without cross-session leakage", () => {
    const result = validateGuidedPlanSessionPrescriptions([
      { sessionNumber: 1, prescribedSide: "left" },
      { sessionNumber: 2, prescribedSide: "right" },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.prescribedSideBySessionNumber.get(1), "left");
    assert.equal(result.prescribedSideBySessionNumber.get(2), "right");
    assert.equal(result.prescribedSideBySessionNumber.get(3), undefined);
  });

  it("keeps legacy compatibility when prescribedSide is omitted", () => {
    const result = validateGuidedPlanSessionPrescriptions([
      { sessionNumber: 1 },
      { sessionNumber: 2 },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.prescribedSideBySessionNumber.size, 0);
  });
});

describe("catalog plan session prescriptions", () => {
  it("parses per-session prescriptions with strict own-property validation", () => {
    const result = parsePlanSessionPrescriptionsFromBody([
      { sessionNumber: 1, prescribedSide: "left" },
      { sessionNumber: 2, prescribedSide: "right" },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(toCatalogRpcSessionPrescribedSides(result.value), [
      { sessionNumber: 1, prescribedSide: "left" },
      { sessionNumber: 2, prescribedSide: "right" },
    ]);
  });

  it("rejects unknown session prescription fields", () => {
    const result = parsePlanSessionPrescriptionsFromBody([
      { sessionNumber: 1, prescribedSide: "left", providerId: "evil" },
    ]);
    assert.equal(result.ok, false);
  });
});
