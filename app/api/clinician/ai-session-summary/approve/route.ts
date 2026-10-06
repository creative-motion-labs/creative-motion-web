import { requireAuthenticatedApprovedUser } from "@/app/lib/api/require-approved-provider";
/**
 * POST /api/clinician/ai-session-summary/approve
 *
 * Persists clinician approval of an AI session summary draft (Sprint 1 D2).
 * Approved records are immutable via RLS (draft-only UPDATE policy).
 */
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  approveAiClinicianSummary,
  parseApproveSummaryRequestBody,
  type ApproveSummaryRequestBody,
} from "@/app/lib/ai/clinician-summary-persistence";
import {
  genericServerErrorResponse,
  serviceUnavailableResponse,
} from "@/app/lib/api/safe-errors";

async function buildClients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon) return null;

  const cookieStore = await cookies();
  const sessionClient = createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* read-only */
        }
      },
    },
  });
  const adminClient = svc
    ? createAdminClient(url, svc, { auth: { autoRefreshToken: false, persistSession: false } })
    : sessionClient;
  return { sessionClient, adminClient };
}

export async function POST(req: NextRequest) {
  const clients = await buildClients();
  if (!clients) {
    return serviceUnavailableResponse();
  }
  const { sessionClient, adminClient } = clients;

  const auth = await requireAuthenticatedApprovedUser(sessionClient, adminClient);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  let body: ApproveSummaryRequestBody;
  try {
    body = (await req.json()) as ApproveSummaryRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseApproveSummaryRequestBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: "summaryId is required." }, { status: 400 });
  }

  const result = await approveAiClinicianSummary(adminClient, {
    summaryId: parsed.summaryId,
    providerId: user.id,
    approvedText: parsed.approvedText,
    approvedAt: new Date().toISOString(),
  });

  if (!result.ok) {
    if (result.migrationPending) {
      return genericServerErrorResponse();
    }
    return NextResponse.json({ error: result.message }, { status: result.httpStatus });
  }

  return NextResponse.json({
    id: result.row.id,
    status: result.row.status,
    approvedText: result.row.approved_text,
    approvedAt: result.row.approved_at,
    approvedBy: result.row.approved_by,
    patientId: result.row.patient_id,
    planId: result.row.plan_id,
  });
}
