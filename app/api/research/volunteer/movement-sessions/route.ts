import type { NextRequest } from "next/server";
import {
  checkVolunteerMovementSessionLimit,
  checkVolunteerSessionTokenLimit,
  rateLimitExceededResponse,
} from "@/app/lib/rate-limit";
import { genericServerErrorResponse } from "@/app/lib/api/safe-errors";
import {
  getVolunteerSessionTokenFromRequest,
  readBoundedVolunteerJsonBody,
  resolveAuthenticatedVolunteerSession,
  volunteerJsonResponse,
  withVolunteerNoCacheHeaders,
} from "@/app/lib/research/volunteer-api-guards";
import { createVolunteerMovementSession } from "@/app/lib/research/volunteer-session-store";
import { validateVolunteerMovementSessionBody } from "@/app/lib/research/volunteer-validation";

/**
 * POST /api/research/volunteer/movement-sessions
 * Create a movement block within an active volunteer collection session.
 */
export async function POST(req: NextRequest) {
  const rawToken = getVolunteerSessionTokenFromRequest(req);
  if (rawToken) {
    const limited = checkVolunteerSessionTokenLimit(req, rawToken, "movement-sessions");
    if (!limited.allowed) {
      return withVolunteerNoCacheHeaders(rateLimitExceededResponse(limited.retryAfterSec));
    }
  }

  const resolved = await resolveAuthenticatedVolunteerSession(req);
  if (!resolved.ok) return resolved.response;

  const movementLimited = checkVolunteerMovementSessionLimit(req, rawToken ?? "missing");
  if (!movementLimited.allowed) {
    return withVolunteerNoCacheHeaders(rateLimitExceededResponse(movementLimited.retryAfterSec));
  }

  const parsed = await readBoundedVolunteerJsonBody(req);
  if (!parsed.ok) return parsed.response;

  const validated = validateVolunteerMovementSessionBody(
    (parsed.value ?? {}) as Record<string, unknown>,
  );
  if (!validated.ok) {
    return volunteerJsonResponse({ error: validated.error }, 400);
  }

  try {
    const created = await createVolunteerMovementSession(
      resolved.admin,
      resolved.session.id,
      validated.value,
    );

    return volunteerJsonResponse({
      movementSessionId: created.movementSessionId,
      blockIndex: created.blockIndex,
    });
  } catch {
    return withVolunteerNoCacheHeaders(genericServerErrorResponse());
  }
}
