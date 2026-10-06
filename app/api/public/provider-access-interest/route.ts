import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { genericServerErrorResponse } from "@/app/lib/api/safe-errors";
import { processProviderAccessInterestSubmit } from "@/app/lib/auth/provider-access-interest-submit";
import { validateProviderAccessInterestBody } from "@/app/lib/auth/provider-access-interest-validation";
import { checkPatientGeneralLimit, rateLimitExceededResponse } from "@/app/lib/rate-limit";

const MAX_BODY_BYTES = 4_096;

/**
 * POST /api/public/provider-access-interest
 * Public provider access interest from /signup — no Supabase Auth account created.
 */
export async function POST(req: NextRequest) {
  const limited = checkPatientGeneralLimit(req, "provider-access-interest");
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

  const validated = validateProviderAccessInterestBody(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const result = await processProviderAccessInterestSubmit(validated.value);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return genericServerErrorResponse();
  }
}
