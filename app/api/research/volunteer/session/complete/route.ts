import type { NextRequest } from "next/server";
import {
  checkVolunteerCompleteLimit,
  checkVolunteerSessionTokenLimit,
  rateLimitExceededResponse,
} from "@/app/lib/rate-limit";
import { genericServerErrorResponse } from "@/app/lib/api/safe-errors";
import {
  getVolunteerSessionTokenFromRequest,
  resolveVolunteerSessionForCompletion,
  volunteerJsonResponse,
  withVolunteerNoCacheHeaders,
} from "@/app/lib/research/volunteer-api-guards";
import { completeVolunteerCollectionSession } from "@/app/lib/research/volunteer-session-store";

/**
 * PATCH /api/research/volunteer/session/complete
 * Complete an active volunteer collection session and mint a one-time deletion code.
 */
export async function PATCH(req: NextRequest) {
  const rawToken = getVolunteerSessionTokenFromRequest(req);
  if (rawToken) {
    const limited = checkVolunteerSessionTokenLimit(req, rawToken, "complete");
    if (!limited.allowed) {
      return withVolunteerNoCacheHeaders(rateLimitExceededResponse(limited.retryAfterSec));
    }
  }

  const resolved = await resolveVolunteerSessionForCompletion(req);
  if (!resolved.ok) return resolved.response;

  const completeLimited = checkVolunteerCompleteLimit(req, rawToken ?? "missing");
  if (!completeLimited.allowed) {
    return withVolunteerNoCacheHeaders(rateLimitExceededResponse(completeLimited.retryAfterSec));
  }

  try {
    const result = await completeVolunteerCollectionSession(
      resolved.admin,
      resolved.session,
    );

    if ("alreadyCompleted" in result && result.alreadyCompleted) {
      return volunteerJsonResponse({ ok: true, alreadyCompleted: true });
    }

    if ("deletionCode" in result) {
      return volunteerJsonResponse({
        ok: true,
        deletionCode: result.deletionCode,
      });
    }

    return withVolunteerNoCacheHeaders(genericServerErrorResponse());
  } catch {
    return withVolunteerNoCacheHeaders(genericServerErrorResponse());
  }
}
