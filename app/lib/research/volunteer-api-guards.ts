import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  enforceVolunteerFailedCampaignRateLimit,
  enforceVolunteerFailedSessionTokenRateLimit,
} from "../rate-limit";
import {
  genericServerErrorResponse,
  serviceUnavailableResponse,
  unableToCompleteResponse,
} from "../api/safe-errors";
import { isVolunteerCollectionEnabled } from "./volunteer-feature-flag";
import { VOLUNTEER_SESSION_TOKEN_HEADER } from "./volunteer-constants";
import {
  getVolunteerResearchAdminClient,
  resolveVolunteerCollectionSessionByToken,
  resolveVolunteerCollectionSessionForCompletion,
  type VolunteerCollectionSessionRow,
} from "./volunteer-session-store";

/** Metadata-only volunteer API bodies — not movement capture payloads. */
export const VOLUNTEER_METADATA_BODY_MAX_BYTES = 8 * 1024;

export const VOLUNTEER_NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const;

export function withVolunteerNoCacheHeaders(response: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(VOLUNTEER_NO_CACHE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export function volunteerJsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: VOLUNTEER_NO_CACHE_HEADERS });
}

export type BoundedVolunteerJsonReadResult =
  | { ok: true; value: unknown }
  | { ok: false; response: NextResponse };

function isJsonContentType(contentType: string): boolean {
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export async function readBoundedVolunteerJsonBody(
  req: NextRequest,
  maxBytes = VOLUNTEER_METADATA_BODY_MAX_BYTES,
): Promise<BoundedVolunteerJsonReadResult> {
  const contentType = req.headers.get("content-type");
  if (!contentType || !isJsonContentType(contentType)) {
    return {
      ok: false,
      response: volunteerJsonResponse({ error: "Unsupported media type." }, 415),
    };
  }

  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const declared = Number(contentLengthHeader);
    if (!Number.isFinite(declared) || declared < 0 || declared > maxBytes) {
      return {
        ok: false,
        response: volunteerJsonResponse({ error: "Request body too large." }, 413),
      };
    }
  }

  const stream = req.body;
  if (!stream) {
    return {
      ok: false,
      response: volunteerJsonResponse({ error: "Invalid JSON body." }, 400),
    };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return {
          ok: false,
          response: volunteerJsonResponse({ error: "Request body too large." }, 413),
        };
      }
      chunks.push(value);
    }
  } catch {
    return {
      ok: false,
      response: volunteerJsonResponse({ error: "Invalid JSON body." }, 400),
    };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(concatUint8Arrays(chunks));
  } catch {
    return {
      ok: false,
      response: volunteerJsonResponse({ error: "Invalid JSON body." }, 400),
    };
  }

  if (text.trim().length === 0) {
    return { ok: true, value: {} };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      response: volunteerJsonResponse({ error: "Invalid JSON body." }, 400),
    };
  }
}

export function volunteerCollectionDisabledResponse(): NextResponse {
  return withVolunteerNoCacheHeaders(unableToCompleteResponse(404));
}

export function ensureVolunteerCollectionEnabled(): NextResponse | null {
  if (!isVolunteerCollectionEnabled()) {
    return volunteerCollectionDisabledResponse();
  }
  return null;
}

export function getVolunteerSessionTokenFromRequest(req: NextRequest): string | null {
  const raw = req.headers.get(VOLUNTEER_SESSION_TOKEN_HEADER);
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

export type ResolvedVolunteerSession =
  | {
      ok: true;
      admin: NonNullable<ReturnType<typeof getVolunteerResearchAdminClient>>;
      session: VolunteerCollectionSessionRow;
    }
  | { ok: false; response: NextResponse };

function wrapVolunteerGuardResponse(response: NextResponse): NextResponse {
  return withVolunteerNoCacheHeaders(response);
}

export async function resolveAuthenticatedVolunteerSession(
  req: NextRequest,
): Promise<ResolvedVolunteerSession> {
  const disabled = ensureVolunteerCollectionEnabled();
  if (disabled) return { ok: false, response: disabled };

  const rawToken = getVolunteerSessionTokenFromRequest(req);
  if (!rawToken) {
    const limited = enforceVolunteerFailedSessionTokenRateLimit(req);
    if (limited) return { ok: false, response: wrapVolunteerGuardResponse(limited) };
    return { ok: false, response: wrapVolunteerGuardResponse(unableToCompleteResponse(404)) };
  }

  const admin = getVolunteerResearchAdminClient();
  if (!admin) {
    return { ok: false, response: wrapVolunteerGuardResponse(serviceUnavailableResponse()) };
  }

  try {
    const resolved = await resolveVolunteerCollectionSessionByToken(admin, rawToken);
    if (!resolved.ok) {
      const limited = enforceVolunteerFailedSessionTokenRateLimit(req);
      if (limited) return { ok: false, response: wrapVolunteerGuardResponse(limited) };
      return { ok: false, response: wrapVolunteerGuardResponse(unableToCompleteResponse(404)) };
    }
    return { ok: true, admin, session: resolved.session };
  } catch {
    return { ok: false, response: wrapVolunteerGuardResponse(genericServerErrorResponse()) };
  }
}

export async function resolveVolunteerSessionForCompletion(
  req: NextRequest,
): Promise<ResolvedVolunteerSession> {
  const disabled = ensureVolunteerCollectionEnabled();
  if (disabled) return { ok: false, response: disabled };

  const rawToken = getVolunteerSessionTokenFromRequest(req);
  if (!rawToken) {
    const limited = enforceVolunteerFailedSessionTokenRateLimit(req);
    if (limited) return { ok: false, response: wrapVolunteerGuardResponse(limited) };
    return { ok: false, response: wrapVolunteerGuardResponse(unableToCompleteResponse(404)) };
  }

  const admin = getVolunteerResearchAdminClient();
  if (!admin) {
    return { ok: false, response: wrapVolunteerGuardResponse(serviceUnavailableResponse()) };
  }

  try {
    const resolved = await resolveVolunteerCollectionSessionForCompletion(admin, rawToken);
    if (!resolved.ok) {
      const limited = enforceVolunteerFailedSessionTokenRateLimit(req);
      if (limited) return { ok: false, response: wrapVolunteerGuardResponse(limited) };
      return { ok: false, response: wrapVolunteerGuardResponse(unableToCompleteResponse(404)) };
    }
    return { ok: true, admin, session: resolved.session };
  } catch {
    return { ok: false, response: wrapVolunteerGuardResponse(genericServerErrorResponse()) };
  }
}

export function volunteerInvalidCampaignResponse(req: NextRequest): NextResponse {
  const limited = enforceVolunteerFailedCampaignRateLimit(req);
  if (limited) return wrapVolunteerGuardResponse(limited);
  return wrapVolunteerGuardResponse(unableToCompleteResponse(404));
}
