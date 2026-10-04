import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { genericServerErrorResponse } from "@/app/lib/api/safe-errors";
import { processRasqDemoAnalyticsEvent } from "@/app/lib/rasq-demo/demo-analytics-supabase-store";
import { validateRasqDemoAnalyticsBody } from "@/app/lib/rasq-demo/demo-analytics-validation";
import { checkPatientGeneralLimit, rateLimitExceededResponse } from "@/app/lib/rate-limit";

const MAX_BODY_BYTES = 4096;

/**
 * POST /api/public/rasq-demo/analytics
 * Anonymous /demo funnel events — no PII, service_role writes only.
 */
export async function POST(req: NextRequest) {
  const limited = checkPatientGeneralLimit(req, "rasq-demo-analytics");
  if (!limited.allowed) {
    return rateLimitExceededResponse(limited.retryAfterSec);
  }

  const contentLength = req.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large." }, { status: 413 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validated = validateRasqDemoAnalyticsBody(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const result = await processRasqDemoAnalyticsEvent({ payload: validated.value });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, duplicate: result.duplicate });
  } catch {
    return genericServerErrorResponse();
  }
}
