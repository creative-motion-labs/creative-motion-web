/**
 * Catalog program list types and client-side response validation.
 */

export type CatalogProgramListSession = {
  sessionNumber: number;
  title: string;
  requiresPrescribedSide: boolean;
  blocks: readonly { movementId: string | null }[];
};

export type CatalogProgramListItem = {
  id: string;
  name: string;
  slug: string;
  sessions: CatalogProgramListSession[];
};

export const CATALOG_PROGRAMS_LOAD_ERROR_MESSAGE =
  "Failed to load catalog programs.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidSessionBlock(value: unknown): value is { movementId: string | null } {
  if (!isRecord(value)) return false;
  const movementId = value.movementId;
  return movementId === null || typeof movementId === "string";
}

function isValidCatalogSession(value: unknown): value is CatalogProgramListSession {
  if (!isRecord(value)) return false;
  if (typeof value.sessionNumber !== "number" || !Number.isFinite(value.sessionNumber)) {
    return false;
  }
  if (!isNonEmptyString(value.title)) return false;
  if (typeof value.requiresPrescribedSide !== "boolean") return false;
  if (!Array.isArray(value.blocks)) return false;
  return value.blocks.every(isValidSessionBlock);
}

function isValidCatalogProgram(value: unknown): value is CatalogProgramListItem {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.name)) return false;
  if (!isNonEmptyString(value.slug)) return false;
  if (!Array.isArray(value.sessions)) return false;
  return value.sessions.every(isValidCatalogSession);
}

export type ParseCatalogProgramsResult =
  | { ok: true; programs: CatalogProgramListItem[] }
  | { ok: false; error: string };

/** Rejects malformed catalog list payloads before storing them in UI state. */
export function parseCatalogProgramsResponse(data: unknown): ParseCatalogProgramsResult {
  if (!isRecord(data) || !Array.isArray(data.programs)) {
    return { ok: false, error: CATALOG_PROGRAMS_LOAD_ERROR_MESSAGE };
  }
  for (const program of data.programs) {
    if (!isValidCatalogProgram(program)) {
      return { ok: false, error: CATALOG_PROGRAMS_LOAD_ERROR_MESSAGE };
    }
  }
  return { ok: true, programs: data.programs };
}
