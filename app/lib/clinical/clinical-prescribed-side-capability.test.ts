/**
 * Run: npx tsx --test app/lib/clinical/clinical-prescribed-side-capability.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMissingPrescribedSideRpcArgument,
  probePrescribedSideStorageCapability,
} from "./clinical-prescribed-side-capability";

describe("clinical-prescribed-side capability", () => {
  it("probe returns available when prescribed_side select succeeds", async () => {
    const admin = {
      from() {
        return {
          select() {
            return {
              limit: async () => ({ error: null }),
            };
          },
        };
      },
    };

    const result = await probePrescribedSideStorageCapability(admin as never);
    assert.deepEqual(result, { ok: true, available: true });
  });

  it("probe returns unavailable only for exact missing prescribed_side column", async () => {
    const admin = {
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
    };

    const result = await probePrescribedSideStorageCapability(admin as never);
    assert.deepEqual(result, { ok: true, available: false });
  });

  it("probe fails closed on unrelated database errors", async () => {
    const admin = {
      from() {
        return {
          select() {
            return {
              limit: async () => ({
                error: { code: "42501", message: "permission denied" },
              }),
            };
          },
        };
      },
    };

    const result = await probePrescribedSideStorageCapability(admin as never);
    assert.deepEqual(result, { ok: false });
  });

  it("detects missing seventh RPC argument via PGRST202", () => {
    assert.equal(
      isMissingPrescribedSideRpcArgument({
        code: "PGRST202",
        message:
          'Searched for the function public.create_plan_from_catalog_program with parameters p_session_prescribed_sides ...',
      }),
      true,
    );
  });

  it("does not classify unrelated PGRST202 errors as missing prescribed-side RPC", () => {
    assert.equal(
      isMissingPrescribedSideRpcArgument({
        code: "PGRST202",
        message: "Searched for the function public.other_function",
      }),
      false,
    );
  });
});
