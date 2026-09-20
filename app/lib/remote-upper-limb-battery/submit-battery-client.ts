import type { RemoteUpperLimbBatterySubmitRequest } from "./battery-request-validation";

export type RemoteBatterySubmitResult =
  | { ok: true; assessmentId?: string }
  | { ok: false; message: string; status?: number };

const USER_MESSAGES = {
  expired: "This assessment link is invalid or has expired.",
  completed: "This assessment has already been completed.",
  badRequest: "The assessment could not be saved. Try again.",
  network: "Could not reach the server. Check your connection and try again.",
  unexpected: "Something went wrong while saving the assessment. Try again.",
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

export async function submitRemoteUpperLimbBatteryResult(
  token: string,
  request: RemoteUpperLimbBatterySubmitRequest,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<RemoteBatterySubmitResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const trimmed = token.trim();
  if (!trimmed) {
    return { ok: false, message: USER_MESSAGES.expired };
  }

  try {
    const response = await fetchImpl(
      `/api/patient/assessment/${encodeURIComponent(trimmed)}/battery-results`,
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

    const assessmentId =
      typeof body === "object" &&
      body !== null &&
      typeof (body as Record<string, unknown>).assessmentId === "string"
        ? String((body as Record<string, unknown>).assessmentId)
        : undefined;

    return { ok: true, assessmentId };
  } catch {
    return { ok: false, message: USER_MESSAGES.network };
  }
}
