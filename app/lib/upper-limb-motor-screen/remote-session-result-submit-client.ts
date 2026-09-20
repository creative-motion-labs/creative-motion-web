/**
 * Browser-safe client for token-authenticated remote ULMS session result submit.
 */

import type { UpperLimbMotorScreenSessionResultPublic } from "./session-result-persistence";
import type { UpperLimbSessionResultCreateRequest } from "./session-result-request-validation";

export type RemoteUlmsSessionResultSubmitResult =
  | { ok: true; result: UpperLimbMotorScreenSessionResultPublic; assessmentId?: string }
  | { ok: false; message: string; status?: number };

const USER_MESSAGES = {
  expired: "This assessment link is invalid or has expired.",
  completed: "This assessment has already been completed.",
  badRequest: "The observation could not be saved. Try again.",
  network: "Could not reach the server. Check your connection and try again.",
  unexpected: "Something went wrong while saving the observation. Try again.",
} as const;

function mapHttpError(status: number, body: unknown): string {
  if (typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).error === "string") {
    return String((body as Record<string, unknown>).error);
  }
  if (status === 404 || status === 410) return USER_MESSAGES.expired;
  if (status === 409) return USER_MESSAGES.completed;
  if (status === 400) return USER_MESSAGES.badRequest;
  return USER_MESSAGES.unexpected;
}

function parseSuccess(body: unknown): { result: UpperLimbMotorScreenSessionResultPublic; assessmentId?: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (!record.sessionResult || typeof record.assignmentId !== "string") return null;
  const assessmentId =
    typeof record.assessmentId === "string" ? record.assessmentId : undefined;
  return { result: body as UpperLimbMotorScreenSessionResultPublic, assessmentId };
}

export async function submitRemoteUlmsSessionResult(
  token: string,
  request: UpperLimbSessionResultCreateRequest,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<RemoteUlmsSessionResultSubmitResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const trimmed = token.trim();
  if (!trimmed) {
    return { ok: false, message: USER_MESSAGES.expired };
  }

  try {
    const response = await fetchImpl(
      `/api/patient/assessment/${encodeURIComponent(trimmed)}/session-results`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: options.signal,
        body: JSON.stringify(request),
      },
    );

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        message: mapHttpError(response.status, body),
        status: response.status,
      };
    }

    const parsed = parseSuccess(body);
    if (!parsed) {
      return { ok: false, message: USER_MESSAGES.unexpected };
    }

    return { ok: true, result: parsed.result, assessmentId: parsed.assessmentId };
  } catch {
    return { ok: false, message: USER_MESSAGES.network };
  }
}
