import { requireAuthenticatedApprovedUser } from "@/app/lib/api/require-approved-provider";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { validatePatientOwnership } from "../../../../lib/validate-patient-ownership";
import { getOpenAiKeyConfig } from "@/app/lib/openai/server-env";
import {
  AI_ERROR_CODES,
  aiErrorHttpStatus,
  aiErrorMessage,
  fromKeyConfigCode,
  fromOpenAiClassified,
} from "@/app/lib/ai/ai-errors";
import { checkAiRateLimit } from "@/app/lib/ai/rate-limit";
import { translateClinicalText } from "@/app/lib/ai/translate-clinical-text";

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
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* read-only */
        }
      },
    },
  });
  const adminClient = serviceKey
    ? createAdminClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : sessionClient;
  return { sessionClient, adminClient };
}

type AssessmentRow = {
  id: string;
  patient_id: string;
  provider_id: string;
  structured_data: Record<string, unknown> | null;
};

function aiErrorJson(code: (typeof AI_ERROR_CODES)[keyof typeof AI_ERROR_CODES]) {
  return NextResponse.json(
    { error: aiErrorMessage(code), code },
    { status: aiErrorHttpStatus(code) },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: assessmentId } = await params;
  if (!assessmentId?.trim()) {
    return aiErrorJson(AI_ERROR_CODES.AI_INVALID_INPUT);
  }

  const keyConfig = getOpenAiKeyConfig();
  if (!keyConfig.ok) {
    const code = fromKeyConfigCode(keyConfig.code);
    return NextResponse.json(
      { error: aiErrorMessage(code), code },
      { status: aiErrorHttpStatus(code) },
    );
  }

  const clients = await buildClients();
  if (!clients) {
    return aiErrorJson(AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE);
  }
  const { sessionClient, adminClient } = clients;

  const auth = await requireAuthenticatedApprovedUser(sessionClient, adminClient);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  let body: { fieldKey?: unknown; text?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return aiErrorJson(AI_ERROR_CODES.AI_INVALID_INPUT);
  }

  const { fieldKey, text } = body;

  if (!fieldKey || typeof fieldKey !== "string") {
    return aiErrorJson(AI_ERROR_CODES.AI_INVALID_INPUT);
  }
  if (!text || typeof text !== "string" || text.trim() === "") {
    return aiErrorJson(AI_ERROR_CODES.AI_INVALID_INPUT);
  }
  if (/^\d+$/.test(text.trim())) {
    return aiErrorJson(AI_ERROR_CODES.AI_INVALID_INPUT);
  }
  if (text.length > 2000) {
    return aiErrorJson(AI_ERROR_CODES.AI_INVALID_INPUT);
  }

  const { data: assessment, error: queryErr } = await adminClient
    .from("assessments")
    .select("id, patient_id, provider_id, structured_data")
    .eq("id", assessmentId)
    .eq("provider_id", user.id)
    .maybeSingle<AssessmentRow>();

  if (queryErr) {
    console.error("[POST /api/assessments/[id]/translate] query failed:", queryErr.message);
    return aiErrorJson(AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE);
  }
  if (!assessment) {
    return aiErrorJson(AI_ERROR_CODES.AI_CONTEXT_INVALID);
  }

  const ownership = await validatePatientOwnership(adminClient, assessment.patient_id, user.id);
  if (!ownership.ok) {
    return aiErrorJson(AI_ERROR_CODES.AI_CONTEXT_INVALID);
  }

  const structuredData = (assessment.structured_data ?? {}) as Record<string, unknown>;
  const existingKey = `${fieldKey}_en`;
  const existingTranslation = structuredData[existingKey];
  if (typeof existingTranslation === "string" && existingTranslation.trim()) {
    const generatedAt = structuredData[`${fieldKey}_en_generated_at`];
    return NextResponse.json({
      translation: existingTranslation,
      generatedAt: typeof generatedAt === "string" ? generatedAt : null,
      cached: true,
    });
  }

  const rateLimit = checkAiRateLimit(user.id);
  if (!rateLimit.allowed) {
    return aiErrorJson(AI_ERROR_CODES.AI_RATE_LIMITED);
  }

  const result = await translateClinicalText(keyConfig.apiKey, text);

  if (!result.ok) {
    if (result.code === "no_content") {
      return aiErrorJson(AI_ERROR_CODES.AI_NO_CONTENT);
    }
    const code = fromOpenAiClassified(result.code);
    console.error("[POST /api/assessments/[id]/translate] OpenAI error:", code);
    return NextResponse.json(
      { error: aiErrorMessage(code), code },
      { status: aiErrorHttpStatus(code) },
    );
  }

  const translation = result.translation;

  const generatedAt = new Date().toISOString();
  const updatedData: Record<string, unknown> = {
    ...structuredData,
    [existingKey]: translation,
    [`${fieldKey}_en_generated_at`]: generatedAt,
    [`${fieldKey}_en_reviewed`]: false,
  };

  const { error: updateError } = await adminClient
    .from("assessments")
    .update({ structured_data: updatedData, updated_at: generatedAt })
    .eq("id", assessmentId)
    .eq("provider_id", user.id);

  if (updateError) {
    console.error("Failed to save translation:", updateError.code);
    return aiErrorJson(AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE);
  }

  return NextResponse.json({
    translation,
    generatedAt,
    cached: false,
  });
}
