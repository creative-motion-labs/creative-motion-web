/**
 * Browser-safe client for POST /api/upper-limb-motor-screen/session-results.
 */

import type { UpperLimbMotorScreenSessionResultPublic } from "./session-result-persistence";
import type { UpperLimbSessionResultCreateRequest } from "./session-result-request-validation";

export const SESSION_RESULT_SUBMIT_USER_MESSAGES = {
  unauthorized: "Your session has expired. Sign in again to continue.",
  notFound: "The assignment could not be found.",
  badRequest: "The observation could not be saved. Review and try again.",
  network: "Could not reach the server. Check your connection and try again.",
  unexpected: "Something went wrong while saving the observation. Try again.",
} as const;

export type SessionResultSubmitResult =
  | { ok: true; result: UpperLimbMotorScreenSessionResultPublic }
  | { ok: false; message: string; status?: number };

function mapHttpError(status: number): string {
  if (status === 401) return SESSION_RESULT_SUBMIT_USER_MESSAGES.unauthorized;
  if (status === 404) return SESSION_RESULT_SUBMIT_USER_MESSAGES.notFound;
  if (status === 400) return SESSION_RESULT_SUBMIT_USER_MESSAGES.badRequest;
  return SESSION_RESULT_SUBMIT_USER_MESSAGES.unexpected;
}

function parseSuccess(body: unknown): UpperLimbMotorScreenSessionResultPublic | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (!record.sessionResult || typeof record.assignmentId !== "string") return null;
  return body as UpperLimbMotorScreenSessionResultPublic;
}

export async function submitUpperLimbSessionResult(
  request: UpperLimbSessionResultCreateRequest,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<SessionResultSubmitResult> {
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl("/api/upper-limb-motor-screen/session-results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: options.signal,
      body: JSON.stringify(request),
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok) {
      return { ok: false, message: mapHttpError(response.status), status: response.status };
    }

    const result = parseSuccess(body);
    if (!result) {
      return { ok: false, message: SESSION_RESULT_SUBMIT_USER_MESSAGES.unexpected };
    }

    return { ok: true, result };
  } catch {
    return { ok: false, message: SESSION_RESULT_SUBMIT_USER_MESSAGES.network };
  }
}
