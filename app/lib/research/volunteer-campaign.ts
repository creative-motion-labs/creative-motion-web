import { hashVolunteerSecret, normalizeVolunteerCampaignCode, verifyVolunteerSecretHash } from "./volunteer-crypto";

/**
 * Env: VOLUNTEER_CAMPAIGN_CODE_HASH — lowercase hex SHA-256 of the shared pilot code.
 * Never commit the raw campaign code.
 */
export function getVolunteerCampaignCodeHashFromEnv(): string | null {
  const configured = process.env.VOLUNTEER_CAMPAIGN_CODE_HASH?.trim();
  if (!configured) return null;
  return configured.toLowerCase();
}

export function isVolunteerCampaignCodeConfigured(): boolean {
  return getVolunteerCampaignCodeHashFromEnv() !== null;
}

export function verifyVolunteerCampaignCode(providedCode: unknown): boolean {
  const expectedHash = getVolunteerCampaignCodeHashFromEnv();
  if (!expectedHash) return false;
  if (typeof providedCode !== "string") return false;
  const normalized = normalizeVolunteerCampaignCode(providedCode);
  if (!normalized) return false;
  return verifyVolunteerSecretHash(normalized, expectedHash);
}

/** Test helper — derive env hash without storing raw code in repo. */
export function hashVolunteerCampaignCodeForEnvSetup(rawCode: string): string {
  return hashVolunteerSecret(normalizeVolunteerCampaignCode(rawCode));
}
