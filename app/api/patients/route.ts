import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PatientRow } from "../../lib/validate-patient-ownership";
import {
  formatPatientFileNumber,
  nextPatientFileNumberSequence,
} from "../../lib/patient-file-number";
import {
  API_ERRORS,
  genericServerErrorResponse,
  serviceUnavailableResponse,
} from "../../lib/api/safe-errors";
import { demoFallbackIfUnavailable } from "../../lib/api/demo-fallback-server";
import { getDemoPatients } from "../../lib/demo/local-demo-fallback";
import {
  checkClinicianWriteLimit,
  rateLimitExceededResponse,
} from "../../lib/rate-limit";
import { requireAuthenticatedApprovedUser } from "../../lib/api/require-approved-provider";

// ── Shared client factory ──────────────────────────────────────────────────────

async function buildClients() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey) return null;

  const cookieStore = await cookies();

  const sessionClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Route Handler context may not allow cookie writes
        }
      },
    },
  });

  // Service-role client for data operations — bypasses any misconfigured RLS
  // during the transition period while migration 003 is being applied.
  const adminClient = serviceKey
    ? createAdminClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : sessionClient;

  return { sessionClient, adminClient };
}

/** Returns a consistent 500 when migration 003 has not been applied yet. */
function migrationPending() {
  console.error("[/api/patients] patients.provider_id column missing — apply migration 003");
  return genericServerErrorResponse();
}

function fileNumberMigrationPending() {
  console.error("[/api/patients] patients.file_number column missing — apply migration 010");
  return genericServerErrorResponse();
}

async function loadProviderFileNumbers(
  adminClient: SupabaseClient,
  providerId: string,
): Promise<{ ok: true; values: string[] } | { ok: false; migration: true } | { ok: false; error: unknown }> {
  const { data, error } = await adminClient
    .from("patients")
    .select("file_number")
    .eq("provider_id", providerId)
    .not("file_number", "is", null);

  if (error) {
    if (error.code === "42703") return { ok: false, migration: true };
    return { ok: false, error };
  }

  const values = (data ?? [])
    .map((row) => (row as { file_number: string | null }).file_number)
    .filter((v): v is string => Boolean(v?.trim()));

  return { ok: true, values };
}

// ── GET /api/patients ──────────────────────────────────────────────────────────

/**
 * Returns all patients owned by the requesting provider
 * (patients.provider_id = session.user.id).
 *
 * Response 200: PatientRow[]
 * Response 401: { error: string }
 * Response 500: { error: string }  — includes migration-pending message
 */
export async function GET(_req: NextRequest) {
  const clients = await buildClients();
  const demo = demoFallbackIfUnavailable(clients, { patients: getDemoPatients() });
  if (demo) return demo;
  const { sessionClient, adminClient } = clients!;

  // ── Auth ────────────────────────────────────────────────────────────────────
  const auth = await requireAuthenticatedApprovedUser(sessionClient, adminClient);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  // ── Query own patients directly by provider_id ───────────────────────────────
  const { data: patients, error: queryError } = await adminClient
    .from("patients")
    .select("*")
    .eq("provider_id", user.id)
    .order("created_at", { ascending: false });

  if (queryError) {
    // 42703 = column does not exist → migration 003 not applied
    if (queryError.code === "42703") return migrationPending();

    console.error("[GET /api/patients] query failed:", queryError.message);
    return NextResponse.json({ error: API_ERRORS.GENERIC }, { status: 500 });
  }

  return NextResponse.json((patients ?? []) as PatientRow[]);
}

// ── POST /api/patients ─────────────────────────────────────────────────────────

type CreatePatientBody = {
  full_name: string;
  phone: string;
  age?: number | null;
  gender?: string | null;
  diagnosis?: string | null;
  sport?: string | null;
  status?: string | null;
  file_number?: unknown;
};

/**
 * Creates a new patient owned by the requesting provider.
 * provider_id is set to session.user.id — callers cannot override it.
 *
 * Body (JSON):
 *   full_name  string  required
 *   phone      string  required
 *   age        number  optional
 *   gender     string  optional
 *   diagnosis  string  optional
 *   sport      string  optional
 *   status     string  optional  (defaults to 'new')
 *
 * Response 201: PatientRow
 * Response 400: { error: string }
 * Response 401: { error: string }
 * Response 500: { error: string }  — includes migration-pending message
 */
export async function POST(req: NextRequest) {
  const clients = await buildClients();
  if (!clients) {
    return serviceUnavailableResponse();
  }
  const { sessionClient, adminClient } = clients;

  // ── Auth ────────────────────────────────────────────────────────────────────
  const auth = await requireAuthenticatedApprovedUser(sessionClient, adminClient);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const limited = checkClinicianWriteLimit(user.id, "patients:create");
  if (!limited.allowed) {
    return rateLimitExceededResponse(limited.retryAfterSec);
  }

  // ── Parse + validate body ────────────────────────────────────────────────────
  let body: CreatePatientBody;
  try {
    body = (await req.json()) as CreatePatientBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const fullName = body.full_name?.trim();
  const phone = body.phone?.trim();

  if (!fullName) {
    return NextResponse.json({ error: "full_name is required." }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json({ error: "phone is required." }, { status: 400 });
  }
  if (body.file_number !== undefined) {
    return NextResponse.json(
      { error: "file_number is assigned server-side and cannot be set by the client." },
      { status: 400 },
    );
  }

  const age =
    body.age === undefined || body.age === null
      ? null
      : typeof body.age === "number" && Number.isFinite(body.age)
        ? Math.floor(body.age)
        : null;

  // ── Insert with server-assigned file_number (never from client body) ─────────
  const existingNumbers = await loadProviderFileNumbers(adminClient, user.id);
  if (!existingNumbers.ok) {
    if ("migration" in existingNumbers && existingNumbers.migration) {
      return fileNumberMigrationPending();
    }
    console.error("[POST /api/patients] file_number lookup failed");
    return NextResponse.json({ error: API_ERRORS.GENERIC }, { status: 500 });
  }

  const baseInsert = {
    provider_id: user.id,
    full_name: fullName,
    phone,
    age,
    gender: body.gender?.trim() || null,
    diagnosis: body.diagnosis?.trim() || null,
    sport: body.sport?.trim() || null,
    status: body.status?.trim() || "new",
  };

  const seq = nextPatientFileNumberSequence(existingNumbers.values);
  let patient: PatientRow | null = null;
  let lastError: { code?: string; message?: string } | null = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const file_number = formatPatientFileNumber(seq + attempt);
    const { data, error: insertError } = await adminClient
      .from("patients")
      .insert({ ...baseInsert, file_number })
      .select()
      .single();

    if (!insertError && data) {
      patient = data as PatientRow;
      break;
    }

    lastError = insertError;
    if (insertError?.code === "42703") return fileNumberMigrationPending();
    if (insertError?.code === "23505") continue;
    break;
  }

  if (!patient) {
    if (lastError?.code === "42703") return migrationPending();
    console.error("[POST /api/patients] insert failed:", lastError?.message);
    return NextResponse.json({ error: API_ERRORS.GENERIC }, { status: 500 });
  }

  return NextResponse.json(patient, { status: 201 });
}
