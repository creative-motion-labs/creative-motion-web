/**
 * Run: npx tsx --test app/api/plans/route.rolling-deploy.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGuidedPlanSessionInsertRows,
  requiresPrescribedSideStorageCapability,
  validateGuidedPlanSessionPrescriptions,
} from "@/app/lib/clinical/clinical-prescribed-side";
import { probePrescribedSideStorageCapability } from "@/app/lib/clinical/clinical-prescribed-side-capability";

describe("POST /api/plans rolling deployment gate", () => {
  it("2. legacy no-side guided creation does not require capability", async () => {
    const validation = validateGuidedPlanSessionPrescriptions([
      { sessionNumber: 1, prescribedSide: undefined },
    ]);
    assert.equal(validation.ok, true);
    if (!validation.ok) return;

    assert.equal(requiresPrescribedSideStorageCapability(validation.prescribedSideBySessionNumber), false);

    const rows = buildGuidedPlanSessionInsertRows({
      planId: "plan-1",
      providerId: "provider-1",
      patientId: "patient-1",
      sessions: [{ sessionNumber: 1, title: "Session 1", exercises: [] }],
      prescribedSideBySessionNumber: validation.prescribedSideBySessionNumber,
    });

    assert.equal("prescribed_side" in rows[0]!, false);
  });

  it("4. side-aware guided creation fails before first mutation when capability is unavailable", async () => {
    const validation = validateGuidedPlanSessionPrescriptions([
      { sessionNumber: 1, prescribedSide: "left" },
    ]);
    assert.equal(validation.ok, true);
    if (!validation.ok) return;

    assert.equal(requiresPrescribedSideStorageCapability(validation.prescribedSideBySessionNumber), true);

    const capability = await probePrescribedSideStorageCapability({
      from() {
        return {
          select() {
            return {
              limit: async () => ({
                error: {
                  code: "42703",
                  message: 'column "prescribed_side" does not exist',
                },
              }),
            };
          },
        };
      },
    } as never);

    assert.deepEqual(capability, { ok: true, available: false });
  });

  it("5. capability probe failure prevents proceeding to plan insert", async () => {
    let planInserted = false;

    const validation = validateGuidedPlanSessionPrescriptions([
      { sessionNumber: 1, prescribedSide: "right" },
    ]);
    assert.equal(validation.ok, true);
    if (!validation.ok) return;

    const capability = await probePrescribedSideStorageCapability({
      from() {
        return {
          select() {
            return {
              limit: async () => ({ error: { code: "42501", message: "permission denied" } }),
            };
          },
        };
      },
    } as never);

    if (!capability.ok || !capability.available) {
      assert.equal(planInserted, false);
      return;
    }

    planInserted = true;
    assert.fail("should not reach plan insert when capability is unavailable");
  });

  it("10. unrelated probe errors are not treated as legacy availability", async () => {
    const capability = await probePrescribedSideStorageCapability({
      from() {
        return {
          select() {
            return {
              limit: async () => ({ error: { code: "08006", message: "connection failure" } }),
            };
          },
        };
      },
    } as never);

    assert.deepEqual(capability, { ok: false });
  });
});
