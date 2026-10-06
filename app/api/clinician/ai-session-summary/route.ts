import { requireAuthenticatedApprovedUser } from "@/app/lib/api/require-approved-provider";
/**
 * POST /api/clinician/ai-session-summary
 *
 * Clinician-only AI draft summary from structured session data.
 * No patient exposure, no plan mutation, no diagnosis or treatment recommendations.
 */
import OpenAI from "openai";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validatePatientOwnership } from "@/app/lib/validate-patient-ownership";
import { classifyOpenAiError } from "@/app/lib/openai/classify-openai-error";
import { getOpenAiKeyConfig } from "@/app/lib/openai/server-env";
import {
  AI_ERROR_CODES,
  aiErrorHttpStatus,
  aiErrorMessage,
  fromKeyConfigCode,
  fromOpenAiClassified,
} from "@/app/lib/ai/ai-errors";
import { checkAiRateLimit } from "@/app/lib/ai/rate-limit";
import {
  AI_CLINICIAN_SUMMARY_DISCLAIMER,
  AI_CLINICIAN_SUMMARY_SCHEMA_VERSION,
} from "@/app/lib/ai/clinician-summary-constants";
import { fetchClinicianSummaryContext } from "@/app/lib/ai/clinician-summary-data";
import {
  buildClinicianSummaryPayload,
  findForbiddenPayloadKeys,
} from "@/app/lib/ai/clinician-summary-input";
import {
  AI_CLINICIAN_SUMMARY_SYSTEM_PROMPT,
  buildClinicianSummaryUserPrompt,
} from "@/app/lib/ai/clinician-summary-prompt";
import {
  buildSafeFallbackSummaryV2,
  parseAiV2SectionsFromJson,
  sectionsToDraftSummary,
  validateAndNormalizeAiSummary,
  validateV2Sections,
} from "@/app/lib/ai/clinician-summary-validate";
import { persistAiClinicianSummaryDraft, fetchLatestApprovedAiClinicianSummary, parseAiSessionSummaryGetParams } from "@/app/lib/ai/clinician-summary-persistence";
import {
  genericServerErrorResponse,
  ownershipErrorResponse,
  serviceUnavailableResponse,
  unableToCompleteResponse,
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

function aiErrorJson(code: (typeof AI_ERROR_CODES)[keyof typeof AI_ERROR_CODES]) {
  return NextResponse.json(
    { error: aiErrorMessage(code), code },
    { status: aiErrorHttpStatus(code) },
  );
}

export type AiSessionSummaryRequestBody = {
  patientId?: unknown;
  planId?: unknown;
};

export function parseAiSessionSummaryRequestBody(
  body: AiSessionSummaryRequestBody,
): { ok: true; patientId: string; planId: string | null } | { ok: false } {
  const patientId =
    typeof body.patientId === "string" ? body.patientId.trim() : "";
  if (!patientId) return { ok: false };

  const planId =
    typeof body.planId === "string" && body.planId.trim()
      ? body.planId.trim()
      : null;

  return { ok: true, patientId, planId };
}

async function attachPersistedSummaryId(
  adminClient: SupabaseClient,
  response: Record<string, unknown>,
  persistInput: {
    providerId: string;
    patientId: string;
    planId: string | null;
    draftText: string;
    inputsSnapshot: ReturnType<typeof buildClinicianSummaryPayload>["inputsSnapshot"];
    schemaVersion: string;
  },
): Promise<Record<string, unknown>> {
  const summaryId = await persistAiClinicianSummaryDraft(adminClient, persistInput);
  if (summaryId) {
    return { ...response, summaryId };
  }
  return response;
}

/**
 * GET /api/clinician/ai-session-summary?patientId=UUID&planId=UUID
 *
 * Returns the latest approved AI summary for the provider-owned patient/plan scope.
 */
export async function GET(req: NextRequest) {
  const clients = await buildClients();
  if (!clients) {
    return serviceUnavailableResponse();
  }
  const { sessionClient, adminClient } = clients;

  const auth = await requireAuthenticatedApprovedUser(sessionClient, adminClient);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const parsed = parseAiSessionSummaryGetParams(new URL(req.url).searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: "patientId is required." }, { status: 400 });
  }

  const ownership = await validatePatientOwnership(
    adminClient,
    parsed.patientId,
    user.id,
  );
  if (!ownership.ok) {
    return ownershipErrorResponse(ownership);
  }

  const result = await fetchLatestApprovedAiClinicianSummary(adminClient, {
    providerId: user.id,
    patientId: parsed.patientId,
    planId: parsed.planId,
  });

  if (!result.ok) {
    if (result.migrationPending) {
      return genericServerErrorResponse();
    }
    return NextResponse.json({ error: result.message }, { status: result.httpStatus });
  }

  return NextResponse.json({ summary: result.summary });
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

  let body: AiSessionSummaryRequestBody;
  try {
    body = (await req.json()) as AiSessionSummaryRequestBody;
  } catch {
    return aiErrorJson(AI_ERROR_CODES.AI_INVALID_INPUT);
  }

  const parsed = parseAiSessionSummaryRequestBody(body);
  if (!parsed.ok) {
    return aiErrorJson(AI_ERROR_CODES.AI_INVALID_INPUT);
  }
  const { patientId, planId } = parsed;

  const ownership = await validatePatientOwnership(adminClient, patientId, user.id);
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.message }, { status: ownership.httpStatus });
  }

  const keyConfig = getOpenAiKeyConfig();
  if (!keyConfig.ok) {
    const code = fromKeyConfigCode(keyConfig.code);
    return NextResponse.json(
      { error: aiErrorMessage(code), code },
      { status: aiErrorHttpStatus(code) },
    );
  }

  const rateLimit = checkAiRateLimit(user.id);
  if (!rateLimit.allowed) {
    return aiErrorJson(AI_ERROR_CODES.AI_RATE_LIMITED);
  }

  let fetchResult;
  try {
    fetchResult = await fetchClinicianSummaryContext(
      adminClient,
      patientId,
      user.id,
      planId,
    );
  } catch (err) {
    console.error("[POST /api/clinician/ai-session-summary] fetch failed:", err);
    return genericServerErrorResponse();
  }

  if (!fetchResult.ok) {
    return unableToCompleteResponse(404);
  }

  const { payload, inputsSnapshot } = buildClinicianSummaryPayload(fetchResult.context);

  const forbiddenKeys = findForbiddenPayloadKeys(payload);
  if (forbiddenKeys.length > 0) {
    console.error(
      "[POST /api/clinician/ai-session-summary] forbidden payload keys:",
      forbiddenKeys.join(", "),
    );
    return genericServerErrorResponse();
  }

  const generatedAt = new Date().toISOString();
  const fallbackSections = buildSafeFallbackSummaryV2(payload);
  const fallbackSummary = sectionsToDraftSummary(fallbackSections);

  const openai = new OpenAI({ apiKey: keyConfig.apiKey });
  let draftSummary = fallbackSummary;
  let sections = fallbackSections;
  let usedFallback = true;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 420,
      temperature: 0.2,
      messages: [
        { role: "system", content: AI_CLINICIAN_SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: buildClinicianSummaryUserPrompt(payload) },
      ],
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    if (raw) {
      const parsedSections = parseAiV2SectionsFromJson(raw);
      if (parsedSections) {
        const validatedV2 = validateV2Sections(parsedSections);
        if (validatedV2.ok) {
          sections = validatedV2.sections;
          draftSummary = sectionsToDraftSummary(validatedV2.sections);
          usedFallback = false;
        } else {
          console.warn(
            "[POST /api/clinician/ai-session-summary] unsafe v2 JSON; using fallback:",
            validatedV2.forbiddenPhrases.join(", "),
          );
        }
      } else {
        const validated = validateAndNormalizeAiSummary(raw);
        if (validated.ok) {
          draftSummary = validated.summary;
          sections = {
            ...fallbackSections,
            overview: validated.summary,
          };
          usedFallback = false;
        } else {
          console.warn(
            "[POST /api/clinician/ai-session-summary] unsafe AI output; using fallback:",
            validated.forbiddenPhrases.join(", "),
          );
        }
      }
    }
  } catch (error) {
    const classified = classifyOpenAiError(error);
    const code = fromOpenAiClassified(classified.code);
    console.error("[POST /api/clinician/ai-session-summary] OpenAI error:", code);
    const fallbackResponse = {
      draftSummary: fallbackSummary,
      sections: fallbackSections,
      disclaimer: AI_CLINICIAN_SUMMARY_DISCLAIMER,
      generatedAt,
      schemaVersion: AI_CLINICIAN_SUMMARY_SCHEMA_VERSION,
      inputsSnapshot,
      fallback: true,
      warning: aiErrorMessage(code),
    };
    return NextResponse.json(
      await attachPersistedSummaryId(adminClient, fallbackResponse, {
        providerId: user.id,
        patientId,
        planId,
        draftText: fallbackSummary,
        inputsSnapshot,
        schemaVersion: AI_CLINICIAN_SUMMARY_SCHEMA_VERSION,
      }),
      { status: 200 },
    );
  }

  return NextResponse.json(
    await attachPersistedSummaryId(
      adminClient,
      {
        draftSummary,
        sections,
        disclaimer: AI_CLINICIAN_SUMMARY_DISCLAIMER,
        generatedAt,
        schemaVersion: AI_CLINICIAN_SUMMARY_SCHEMA_VERSION,
        inputsSnapshot,
        fallback: usedFallback,
      },
      {
        providerId: user.id,
        patientId,
        planId,
        draftText: draftSummary,
        inputsSnapshot,
        schemaVersion: AI_CLINICIAN_SUMMARY_SCHEMA_VERSION,
      },
    ),
  );
}
