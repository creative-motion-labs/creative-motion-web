import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { genericServerErrorResponse } from "@/app/lib/api/safe-errors";
import { validateRasqDemoLeadBody } from "@/app/lib/rasq-demo/demo-leads-validation";
import { processRasqDemoLeadSubmit } from "@/app/lib/rasq-demo/demo-leads-submit";
import { checkPatientGeneralLimit, rateLimitExceededResponse } from "@/app/lib/rate-limit";

const MAX_BODY_BYTES = 16_384;

/**
 * POST /api/public/rasq-demo/leads
 * Optional contact after the public demo — separate from clinical assessment data.
 */
export async function POST(req: NextRequest) {
  const limited = checkPatientGeneralLimit(req, "rasq-demo-leads");
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

  const validated = validateRasqDemoLeadBody(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const result = await processRasqDemoLeadSubmit({
      payload: validated.value,
      submitIntent: validated.submitIntent,
      hasContactOrConsent: validated.hasContactOrConsent,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    if (!result.stored) {
      return NextResponse.json({ ok: true, stored: false, skipped: true });
    }

    return NextResponse.json({
      ok: true,
      stored: true,
      id: result.id,
      duplicate: result.duplicate,
      confirmationEmail: result.confirmationEmail,
    });
  } catch {
    return genericServerErrorResponse();
  }
}
