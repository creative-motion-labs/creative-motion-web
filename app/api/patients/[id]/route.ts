import { requireAuthenticatedApprovedUser } from "@/app/lib/api/require-approved-provider";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validatePatientOwnership } from "../../../lib/validate-patient-ownership";
import {
  API_ERRORS,
  ownershipErrorResponse,
  serviceUnavailableResponse,
} from "../../../lib/api/safe-errors";
import { demoFallbackIfUnavailable } from "../../../lib/api/demo-fallback-server";
import { getDemoPatientById } from "../../../lib/demo/local-demo-fallback";
import {
  checkClinicianWriteLimit,
  rateLimitExceededResponse,
} from "../../../lib/rate-limit";

// ── Shared client factory (mirrors route.ts) ───────────────────────────────────
async function buildClients() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey) return null;
  const cookieStore = await cookies();
  const sessionClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
        catch { /* Route Handler may not allow cookie writes */ }
      },
    },
  });
  const adminClient = serviceKey
    ? createAdminClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    : sessionClient;
  return { sessionClient, adminClient };
}

// ── Auth helper ───────────────────────────────────────────────────────────────
async function getAuthAndClients() {
  const clients = await buildClients();
  if (!clients) return { mode: "offline" as const };
  const auth = await requireAuthenticatedApprovedUser(
    clients.sessionClient,
    clients.adminClient,
  );
  if (!auth.ok) {
    return {
      mode: "unauthorized" as const,
      response: auth.response,
    };
  }
  return {
    mode: "live" as const,
    sessionClient: clients.sessionClient,
    adminClient: clients.adminClient,
    user: auth.user,
  };
}

// ── GET /api/patients/[id] ─────────────────────────────────────────────────────

/**
 * Returns a single patient owned by the requesting provider.
 * Response 200: PatientRow
 * Response 401: { error } — no valid session
 * Response 404: { error } — not found or wrong provider
 * Response 500: { error } — DB error or migration not applied
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: patientId } = await params;
  if (!patientId?.trim()) return NextResponse.json({ error: "Patient ID is required." }, { status: 400 });

  const auth = await getAuthAndClients();
  if (auth.mode === "unauthorized") {
    return auth.response;
  }
  if (auth.mode === "offline") {
    const demoPatient = getDemoPatientById(patientId);
    if (!demoPatient) {
      return NextResponse.json({ error: API_ERRORS.PATIENT_NOT_FOUND }, { status: 404 });
    }
    const demo = demoFallbackIfUnavailable(null, demoPatient);
    if (demo) return demo;
    return serviceUnavailableResponse();
  }

  const { adminClient, user } = auth;

  const result = await validatePatientOwnership(adminClient, patientId, user.id);
  if (!result.ok) return ownershipErrorResponse(result);
  return NextResponse.json(result.patient);
}

// ── PATCH /api/patients/[id] ───────────────────────────────────────────────────

type PatchBody = {
  full_name?: string;
  phone?: string;
  age?: number | null;
  gender?: string | null;
  sport?: string | null;
  diagnosis?: string | null;
  status?: string | null;
  file_number?: unknown;
};

/**
 * Partial update for a patient owned by the requesting provider.
 * Response 200: PatientRow (updated)
 * Response 400: { error } — empty full_name if provided
 * Response 401: { error } — not authenticated
 * Response 404: { error } — not found or wrong provider
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: patientId } = await params;
  if (!patientId?.trim()) return NextResponse.json({ error: "Patient ID is required." }, { status: 400 });

  const auth = await getAuthAndClients();
  if (auth.mode === "unauthorized") {
    return auth.response;
  }
  if (auth.mode !== "live") return serviceUnavailableResponse();
  const { adminClient, user } = auth;

  const limited = checkClinicianWriteLimit(user.id, "patients:update");
  if (!limited.allowed) {
    return rateLimitExceededResponse(limited.retryAfterSec);
  }

  const ownership = await validatePatientOwnership(adminClient, patientId, user.id);
  if (!ownership.ok) return ownershipErrorResponse(ownership);

  let body: PatchBody;
  try { body = (await req.json()) as PatchBody; }
  catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }

  // file_number is intentionally omitted — assigned server-side on create only.

  const patch: Record<string, unknown> = {};
  if (body.full_name !== undefined) {
    const n = body.full_name.trim();
    if (!n) return NextResponse.json({ error: "full_name cannot be empty." }, { status: 400 });
    patch.full_name = n;
  }
  if (body.phone !== undefined) patch.phone = body.phone?.trim() || null;
  if (body.age !== undefined) patch.age = body.age;
  if (body.gender !== undefined) patch.gender = body.gender?.trim() || null;
  if (body.sport !== undefined) patch.sport = body.sport?.trim() || null;
  if (body.diagnosis !== undefined) patch.diagnosis = body.diagnosis?.trim() || null;
  if (body.status !== undefined) patch.status = body.status?.trim() || null;

  const { data: updated, error: updateError } = await adminClient
    .from("patients")
    .update(patch)
    .eq("id", patientId)
    .select()
    .single();

  if (updateError) {
    console.error("[PATCH /api/patients/[id]] update failed:", updateError.message);
    return NextResponse.json({ error: "Failed to update patient." }, { status: 500 });
  }
  return NextResponse.json(updated);
}

// ── DELETE /api/patients/[id] ──────────────────────────────────────────────────

/**
 * Permanently deletes a patient owned by the requesting provider.
 * Response 204: empty — success
 * Response 401: { error } — not authenticated
 * Response 404: { error } — not found or wrong provider
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: patientId } = await params;
  if (!patientId?.trim()) return NextResponse.json({ error: "Patient ID is required." }, { status: 400 });

  const auth = await getAuthAndClients();
  if (auth.mode === "unauthorized") {
    return auth.response;
  }
  if (auth.mode !== "live") return serviceUnavailableResponse();
  const { adminClient, user } = auth;

  const limited = checkClinicianWriteLimit(user.id, "patients:delete");
  if (!limited.allowed) {
    return rateLimitExceededResponse(limited.retryAfterSec);
  }

  const ownership = await validatePatientOwnership(adminClient, patientId, user.id);
  if (!ownership.ok) return ownershipErrorResponse(ownership);

  const { error: deleteError } = await adminClient
    .from("patients")
    .delete()
    .eq("id", patientId);

  if (deleteError) {
    console.error("[DELETE /api/patients/[id]] delete failed:", deleteError.message);
    return NextResponse.json({ error: "Failed to delete patient." }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
