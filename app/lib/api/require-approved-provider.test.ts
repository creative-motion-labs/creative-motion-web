import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { guardApprovedProviderApiAccess } from "./require-approved-provider";

function mockAdminClient(providerRow: { approval_status: string } | null): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === "providers") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: providerRow
                  ? { role: "provider", approval_status: providerRow.approval_status }
                  : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "provider_access_requests") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe("guardApprovedProviderApiAccess", () => {
  it("returns 403 for pending provider rows", async () => {
    const response = await guardApprovedProviderApiAccess(
      mockAdminClient({ approval_status: "pending" }),
      "user-pending",
    );
    assert.ok(response);
    assert.equal(response.status, 403);
    const body = (await response.json()) as { code?: string };
    assert.equal(body.code, "provider_pending");
  });

  it("returns 403 for rejected provider rows", async () => {
    const response = await guardApprovedProviderApiAccess(
      mockAdminClient({ approval_status: "rejected" }),
      "user-rejected",
    );
    assert.ok(response);
    assert.equal(response.status, 403);
  });

  it("returns null for approved provider rows", async () => {
    const response = await guardApprovedProviderApiAccess(
      mockAdminClient({ approval_status: "approved" }),
      "user-approved",
    );
    assert.equal(response, null);
  });

  it("returns 403 when no provider record exists", async () => {
    const response = await guardApprovedProviderApiAccess(
      mockAdminClient(null),
      "user-none",
    );
    assert.ok(response);
    assert.equal(response.status, 403);
  });
});
