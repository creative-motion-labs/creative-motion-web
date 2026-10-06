import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isClinicianWorkspaceAllowed,
  isPlatformAdminUser,
  mapProviderRowToAccessState,
  parsePlatformAdminAllowlist,
  postLoginPathForAccessState,
} from "./provider-authorization";

describe("provider authorization", () => {
  it("maps approved provider rows to clinician access", () => {
    const state = mapProviderRowToAccessState({
      role: "provider",
      approval_status: "approved",
    });
    assert.equal(state.kind, "approved");
    assert.equal(isClinicianWorkspaceAllowed(state), true);
  });

  it("denies pending, rejected, and revoked providers", () => {
    for (const status of ["pending", "rejected", "revoked"] as const) {
      const state = mapProviderRowToAccessState({
        role: "provider",
        approval_status: status,
      });
      assert.equal(isClinicianWorkspaceAllowed(state), false);
    }
  });

  it("routes pending users to pending-approval", () => {
    assert.equal(
      postLoginPathForAccessState({ kind: "pending" }),
      "/pending-approval",
    );
  });

  it("routes rejected users to access-unavailable", () => {
    assert.equal(
      postLoginPathForAccessState({ kind: "rejected" }),
      "/access-unavailable",
    );
  });

  it("does not treat login role selector as admin authorization", () => {
    const allowlist = parsePlatformAdminAllowlist("");
    const providerAdmin = mapProviderRowToAccessState({
      role: "admin",
      approval_status: "pending",
    });
    assert.equal(
      isPlatformAdminUser("user-1", providerAdmin, allowlist),
      false,
    );
  });

  it("allows platform admin allowlist users", () => {
    const allowlist = parsePlatformAdminAllowlist("founder-uuid");
    assert.equal(
      isPlatformAdminUser(
        "founder-uuid",
        { kind: "pending" },
        allowlist,
      ),
      true,
    );
  });

  it("allows approved admin role", () => {
    const state = mapProviderRowToAccessState({
      role: "admin",
      approval_status: "approved",
    });
    assert.equal(isPlatformAdminUser("admin-1", state, new Set()), true);
  });
});
