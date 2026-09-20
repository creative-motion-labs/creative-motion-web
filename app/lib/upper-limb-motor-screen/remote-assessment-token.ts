import { createHash, randomUUID } from "node:crypto";

export const REMOTE_ULMS_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
