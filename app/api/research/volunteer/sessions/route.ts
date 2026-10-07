import type { NextRequest } from "next/server";
import {
  checkVolunteerSessionCreateLimit,
  rateLimitExceededResponse,
} from "@/app/lib/rate-limit";
import {
  genericServerErrorResponse,
  serviceUnavailableResponse,
} from "@/app/lib/api/safe-errors";
import {
  ensureVolunteerCollectionEnabled,
  readBoundedVolunteerJsonBody,
  volunteerInvalidCampaignResponse,
  volunteerJsonResponse,
  withVolunteerNoCacheHeaders,
} from "@/app/lib/research/volunteer-api-guards";
import {
  isVolunteerCampaignCodeConfigured,
  verifyVolunteerCampaignCode,
} from "@/app/lib/research/volunteer-campaign";
import {
  createVolunteerCollectionSession,
  getVolunteerResearchAdminClient,
} from "@/app/lib/research/volunteer-session-store";
import { validateVolunteerSessionCreateBody } from "@/app/lib/research/volunteer-validation";

/**
 * POST /api/research/volunteer/sessions
 * Create anonymous volunteer collection session (no browser session id exposure).
 */
export async function POST(req: NextRequest) {
  const disabled = ensureVolunteerCollectionEnabled();
  if (disabled) return disabled;

  const limited = checkVolunteerSessionCreateLimit(req);
  if (!limited.allowed) {
    return withVolunteerNoCacheHeaders(rateLimitExceededResponse(limited.retryAfterSec));
  }

  if (!isVolunteerCampaignCodeConfigured()) {
    return withVolunteerNoCacheHeaders(serviceUnavailableResponse());
  }

  const parsed = await readBoundedVolunteerJsonBody(req);
  if (!parsed.ok) return parsed.response;

  const validated = validateVolunteerSessionCreateBody(
    (parsed.value ?? {}) as Record<string, unknown>,
  );
  if (!validated.ok) {
    return volunteerJsonResponse({ error: validated.error }, 400);
  }

  if (!verifyVolunteerCampaignCode(validated.value.campaignCode)) {
    return volunteerInvalidCampaignResponse(req);
  }

  const admin = getVolunteerResearchAdminClient();
  if (!admin) {
    return withVolunteerNoCacheHeaders(serviceUnavailableResponse());
  }

  try {
    const created = await createVolunteerCollectionSession(admin, {
      consentVersion: validated.value.consentVersion,
      protocolVersion: validated.value.protocolVersion,
    });

    return volunteerJsonResponse({
      sessionToken: created.sessionToken,
      expiresAt: created.expiresAt,
    });
  } catch {
    return withVolunteerNoCacheHeaders(genericServerErrorResponse());
  }
}
