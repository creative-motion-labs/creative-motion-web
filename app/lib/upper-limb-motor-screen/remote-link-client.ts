/**
 * Browser-safe client for clinician remote ULMS link generation.
 */

import type { UpperLimbSide } from "./types";

export type RemoteUlmsLinkCreateSuccess = {
  token: string;
  url: string;
  expiresAt: string;
  assignmentId: string;
};

export type RemoteUlmsLinkCreateResult =
  | { ok: true; link: RemoteUlmsLinkCreateSuccess }
  | { ok: false; message: string; status?: number };

const USER_MESSAGES = {
  unauthorized: "Your session has expired. Sign in again to continue.",
  notFound: "This patient record could not be found.",
  badRequest: "Could not create the remote assessment link. Review and try again.",
  network: "Could not reach the server. Check your connection and try again.",
  unexpected: "Something went wrong while creating the remote link. Try again.",
} as const;

function mapHttpError(status: number): string {
  if (status === 401) return USER_MESSAGES.unauthorized;
  if (status === 404) return USER_MESSAGES.notFound;
  if (status === 400) return USER_MESSAGES.badRequest;
  return USER_MESSAGES.unexpected;
}

function parseSuccess(body: unknown): RemoteUlmsLinkCreateSuccess | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const token = typeof record.token === "string" ? record.token : null;
  const url = typeof record.url === "string" ? record.url : null;
  const expiresAt = typeof record.expiresAt === "string" ? record.expiresAt : null;
  const assignmentId = typeof record.assignmentId === "string" ? record.assignmentId : null;
  if (!token || !url || !expiresAt || !assignmentId) return null;
  return { token, url, expiresAt, assignmentId };
}

export async function createRemoteUlmsAssessmentLink(
  patientId: string,
  testedSide: UpperLimbSide,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<RemoteUlmsLinkCreateResult> {
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl("/api/upper-limb-motor-screen/remote-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: options.signal,
      body: JSON.stringify({ patientId, testedSide }),
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok) {
      const message =
        typeof body === "object" &&
        body !== null &&
        typeof (body as Record<string, unknown>).error === "string"
          ? String((body as Record<string, unknown>).error)
          : mapHttpError(response.status);
      return { ok: false, message, status: response.status };
    }

    const link = parseSuccess(body);
    if (!link) {
      return { ok: false, message: USER_MESSAGES.unexpected };
    }

    return { ok: true, link };
  } catch {
    return { ok: false, message: USER_MESSAGES.network };
  }
}

export function absoluteRemoteUlmsLink(path: string): string {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path.startsWith("/") ? path : `/${path}`}`;
}
