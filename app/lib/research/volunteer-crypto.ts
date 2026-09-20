import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_TOKEN_BYTES = 32;

/** Cryptographically secure session token (32 bytes entropy, base64url). */
export function generateVolunteerSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function hashVolunteerSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function verifyVolunteerSecretHash(provided: string, expectedHashHex: string): boolean {
  const providedHash = hashVolunteerSecret(provided);
  const providedBuffer = Buffer.from(providedHash, "hex");
  const expectedBuffer = Buffer.from(expectedHashHex, "hex");
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

/** Human-readable deletion code returned once at session completion. */
export function generateVolunteerDeletionCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(16);
  let raw = "";
  for (let i = 0; i < bytes.length; i += 1) {
    raw += alphabet[bytes[i]! % alphabet.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

export function normalizeVolunteerCampaignCode(value: string): string {
  return value.trim();
}
