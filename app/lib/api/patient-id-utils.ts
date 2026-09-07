const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True when the id is a Supabase UUID patient record (not legacy numeric demo). */
export function isUuidPatientId(id: string): boolean {
  return UUID_RE.test(id.trim());
}

/** Optional ?patientId= from assessment workspace URLs. */
export function readOptionalPatientIdParam(
  searchParams: { get(name: string): string | null },
): string | undefined {
  const value = searchParams.get("patientId")?.trim();
  return value || undefined;
}

/** Legacy demo portal uses numeric patient ids stored in localStorage. */
export function parseNumericDemoPatientId(id: string | number): number | null {
  if (typeof id === "number") {
    return Number.isFinite(id) && id > 0 ? id : null;
  }
  const trimmed = id.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  return n > 0 ? n : null;
}
