import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { enforceFailedTokenRateLimit } from "../rate-limit";
import type { OwnershipFail } from "../validate-patient-ownership";

/** Generic client-safe API error messages — no internal details. */
export const API_ERRORS = {
  GENERIC: "Something went wrong.",
  UNABLE: "Unable to complete request.",
  UNAUTHORIZED: "Unauthorized.",
  FORBIDDEN: "Forbidden.",
  SERVICE_UNAVAILABLE: "Service temporarily unavailable.",
  PATIENT_NOT_FOUND: "Patient not found.",
  INVALID_PATIENT_LINK: "Invalid or expired link.",
} as const;

export function serviceUnavailableResponse(): NextResponse {
  return NextResponse.json({ error: API_ERRORS.SERVICE_UNAVAILABLE }, { status: 503 });
}

export function genericServerErrorResponse(): NextResponse {
  return NextResponse.json({ error: API_ERRORS.GENERIC }, { status: 500 });
}

export function unableToCompleteResponse(status = 404): NextResponse {
  return NextResponse.json({ error: API_ERRORS.UNABLE }, { status });
}

/** Unified 404 for invalid, inactive, or expired patient portal tokens. */
export function invalidPatientTokenResponse(req: NextRequest): NextResponse {
  const limited = enforceFailedTokenRateLimit(req);
  if (limited) return limited;
  return NextResponse.json({ error: API_ERRORS.INVALID_PATIENT_LINK }, { status: 404 });
}

/** Map ownership validation failures to safe client responses. */
export function ownershipErrorResponse(failure: OwnershipFail): NextResponse {
  return NextResponse.json({ error: failure.message }, { status: failure.httpStatus });
}
