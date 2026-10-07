/**
 * Slice 8B.1 — server-side kill switch for volunteer research collection APIs.
 *
 * Env: ML_VOLUNTEER_COLLECTION_ENABLED=true (explicit opt-in only).
 * Default: OFF.
 */
export function isVolunteerCollectionEnabled(): boolean {
  return process.env.ML_VOLUNTEER_COLLECTION_ENABLED === "true";
}
