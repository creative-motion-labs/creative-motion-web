import type { SupabaseClient } from "@supabase/supabase-js";

export type ProviderApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "revoked";

export type ProviderAccessState =
  | { kind: "approved"; role: string }
  | { kind: "pending" }
  | { kind: "rejected" }
  | { kind: "revoked" }
  | { kind: "no_record" }
  | { kind: "schema_pending" };

export type ProviderRowAuthFields = {
  role: string;
  approval_status: ProviderApprovalStatus;
};

const APPROVAL_STATUSES: ProviderApprovalStatus[] = [
  "pending",
  "approved",
  "rejected",
  "revoked",
];

function parseApprovalStatus(value: unknown): ProviderApprovalStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase() as ProviderApprovalStatus;
  return APPROVAL_STATUSES.includes(normalized) ? normalized : null;
}

export function mapProviderRowToAccessState(
  row: ProviderRowAuthFields | null,
): ProviderAccessState {
  if (!row) return { kind: "no_record" };
  const status = parseApprovalStatus(row.approval_status) ?? "pending";
  if (status === "approved") {
    return { kind: "approved", role: row.role ?? "provider" };
  }
  if (status === "rejected") return { kind: "rejected" };
  if (status === "revoked") return { kind: "revoked" };
  return { kind: "pending" };
}

export async function loadProviderAccessState(
  adminClient: SupabaseClient,
  authUserId: string,
): Promise<ProviderAccessState> {
  const { data, error } = await adminClient
    .from("providers")
    .select("role, approval_status")
    .eq("id", authUserId)
    .maybeSingle<ProviderRowAuthFields>();

  if (error) {
    if (error.code === "42703" || error.code === "PGRST204") {
      return { kind: "schema_pending" };
    }
    console.error("[provider-authorization] provider lookup failed");
    return { kind: "no_record" };
  }

  return mapProviderRowToAccessState(data);
}

export async function loadAccessRequestState(
  adminClient: SupabaseClient,
  authUserId: string,
): Promise<ProviderAccessState | null> {
  const { data, error } = await adminClient
    .from("provider_access_requests")
    .select("status")
    .eq("auth_user_id", authUserId)
    .maybeSingle<{ status: string }>();

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST204") {
      return null;
    }
    console.error("[provider-authorization] access request lookup failed");
    return null;
  }

  if (!data) return null;

  const status = parseApprovalStatus(data.status);
  if (status === "approved") return { kind: "approved", role: "provider" };
  if (status === "rejected") return { kind: "rejected" };
  if (status === "revoked") return { kind: "revoked" };
  return { kind: "pending" };
}

/**
 * Authoritative clinician access: approved provider row, or approved access request
 * when provider row does not exist yet.
 */
export async function resolveClinicianAccessState(
  adminClient: SupabaseClient,
  authUserId: string,
): Promise<ProviderAccessState> {
  const providerState = await loadProviderAccessState(adminClient, authUserId);
  if (providerState.kind === "approved") return providerState;
  if (
    providerState.kind === "pending" ||
    providerState.kind === "rejected" ||
    providerState.kind === "revoked"
  ) {
    return providerState;
  }

  const requestState = await loadAccessRequestState(adminClient, authUserId);
  if (requestState) return requestState;

  if (providerState.kind === "schema_pending") {
    return providerState;
  }

  return { kind: "no_record" };
}

export function isClinicianWorkspaceAllowed(state: ProviderAccessState): boolean {
  return state.kind === "approved";
}

export function postLoginPathForAccessState(state: ProviderAccessState): string {
  switch (state.kind) {
    case "approved":
      return "/clinician";
    case "pending":
    case "no_record":
      return "/pending-approval";
    case "rejected":
    case "revoked":
      return "/access-unavailable";
    case "schema_pending":
      return "/pending-approval";
  }
}

export function parsePlatformAdminAllowlist(
  raw: string | undefined = process.env.RASQ_PLATFORM_ADMIN_USER_IDS,
): Set<string> {
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isPlatformAdminUser(
  authUserId: string,
  providerState: ProviderAccessState,
  allowlist: Set<string> = parsePlatformAdminAllowlist(),
): boolean {
  if (allowlist.has(authUserId)) return true;
  return (
    providerState.kind === "approved" &&
    providerState.role.toLowerCase() === "admin"
  );
}

export function forbiddenResponseForAccessState(
  state: ProviderAccessState,
): { status: 403; code: string } {
  if (state.kind === "pending" || state.kind === "no_record") {
    return { status: 403, code: "provider_pending" };
  }
  if (state.kind === "rejected" || state.kind === "revoked") {
    return { status: 403, code: "provider_access_denied" };
  }
  return { status: 403, code: "provider_forbidden" };
}
