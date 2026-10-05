export const PATIENT_PROFILE_WORKSPACE_SECTIONS = [
  "overview",
  "assessments",
  "plan",
  "progress",
  "movement",
  "activity",
] as const;

export type PatientProfileWorkspaceSection =
  (typeof PATIENT_PROFILE_WORKSPACE_SECTIONS)[number];

export const DEFAULT_PATIENT_PROFILE_SECTION: PatientProfileWorkspaceSection =
  "overview";

/** Legacy in-page hash anchors → workspace section (direct links and bookmarks). */
export const PATIENT_PROFILE_LEGACY_HASH_TO_SECTION: Record<
  string,
  PatientProfileWorkspaceSection
> = {
  "clinical-assessment-summary": "assessments",
  "rehabilitation-plan": "plan",
  "progress-objective-results": "progress",
  "progress-snapshot": "progress",
  "movement-tracking-sessions": "movement",
};

export const PATIENT_PROFILE_SECTION_NAV: ReadonlyArray<{
  id: PatientProfileWorkspaceSection;
  label: string;
}> = [
  { id: "overview", label: "Overview" },
  { id: "assessments", label: "Assessment" },
  { id: "plan", label: "Treatment plan" },
  { id: "progress", label: "Progress" },
  { id: "movement", label: "Movement tracking" },
  { id: "activity", label: "Activity" },
];

export function isPatientProfileWorkspaceSection(
  value: string | null | undefined,
): value is PatientProfileWorkspaceSection {
  if (!value) return false;
  return (PATIENT_PROFILE_WORKSPACE_SECTIONS as readonly string[]).includes(value);
}

export function resolvePatientProfileSectionFromHash(
  hash: string,
): PatientProfileWorkspaceSection | null {
  const id = hash.replace(/^#/, "").trim();
  if (!id) return null;
  return PATIENT_PROFILE_LEGACY_HASH_TO_SECTION[id] ?? null;
}

export function resolvePatientProfileSection(
  sectionParam: string | null,
  hash: string,
): PatientProfileWorkspaceSection {
  if (isPatientProfileWorkspaceSection(sectionParam)) {
    return sectionParam;
  }
  const fromHash = resolvePatientProfileSectionFromHash(hash);
  if (fromHash) return fromHash;
  return DEFAULT_PATIENT_PROFILE_SECTION;
}
