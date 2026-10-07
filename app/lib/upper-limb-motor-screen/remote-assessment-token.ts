import { createHash, randomUUID } from "node:crypto";

export const REMOTE_ULMS_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const REMOTE_ULMS_ASSESSMENT_LINK_INVALID_MESSAGE =
  "This assessment link is invalid or has expired. Ask your therapist for a new link.";

const REMOTE_ULMS_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Normalizes a URL token segment; rejects empty or non-UUID values. */
export function normalizeRemoteUlmsAssessmentToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || !REMOTE_ULMS_TOKEN_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function hashRemoteUlmsToken(token: string): string {
  return createHash("sha256").update(token.trim(), "utf8").digest("hex");
}

export function generateRemoteUlmsToken(): string {
  return randomUUID();
}

export function remoteUlmsPatientAssessmentPath(token: string): string {
  return `/patient/assessment/${encodeURIComponent(token.trim())}`;
}

export function remoteUlmsTokenExpiresAt(fromMs = Date.now()): string {
  return new Date(fromMs + REMOTE_ULMS_TOKEN_TTL_MS).toISOString();
}
