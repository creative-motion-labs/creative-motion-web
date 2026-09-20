/**
 * Remote Assessment Service — Supabase-backed with localStorage fallback.
 *
 * Clinician creates a tokenized link → patient fills sections → submits →
 * patient answers are persisted to Supabase and merged into the clinician's
 * GeneralAssessmentDraft when submitted from the same browser.
 */

import { getAuthHeaders } from "../auth";
import { loadGeneralAssessmentDraft, saveGeneralAssessmentDraft } from "../general-assessment/storage";
import { PATIENT_SECTION_LABELS_EN } from "../patient-assessment-questions";
import { isUuidPatientId } from "./patient-id-utils";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AssessmentType =
  | "general_msk"
  | "sports"
  | "gait"
  | "pain_function"
  | "stroke_neuro_v1";

/** Subset of SectionId that a patient can answer (no CV/SOAP/AI/special-tests). */
export type PatientSectionId = "pain" | "rom" | "strength" | "balance" | "gait" | "functional";

export const ASSESSMENT_TYPE_LABELS: Record<AssessmentType, string> = {
  general_msk:   "General MSK",
  sports:        "Sports Assessment",
  gait:          "Gait Assessment",
  pain_function: "Pain & Function",
  stroke_neuro_v1: "Remote Neurorehabilitation Intake",
};

export const DEFAULT_SECTIONS: Record<AssessmentType, PatientSectionId[]> = {
  general_msk:   ["pain", "rom", "strength", "balance", "functional"],
  sports:        ["pain", "rom", "strength", "balance", "gait", "functional"],
  gait:          ["pain", "gait", "functional"],
  pain_function: ["pain", "functional"],
  stroke_neuro_v1: [],
};

/** English labels for patient forms (Arabic via patient-assessment-questions when enabled). */
export const PATIENT_SECTION_LABELS: Record<PatientSectionId, string> =
  PATIENT_SECTION_LABELS_EN;

export type AssessmentLanguage = "en" | "ar";

export interface RemoteAssessmentRequest {
  id: string;                          // UUID — also serves as the URL token
  patientId: string;
  patientName: string;
  assessmentType: AssessmentType;
  includedSections: PatientSectionId[];
  status: "pending" | "in_progress" | "submitted";
  expiresAt: string;                   // ISO string — 7 days from creation
  createdAt: string;
  submittedAt?: string;
  assessmentId?: string;
  /** Patient-filled answers, keyed by section */
  patientDraft?: PatientAssessmentDraft;
  /** Language used when patient completed the form */
  assessmentLanguage?: AssessmentLanguage;
}

/** Simplified, patient-friendly answers (no clinical jargon). */
export interface PatientAssessmentDraft {
  pain?: {
    chiefComplaint: string;
    painLocation: string;
    painScore: string;       // "0"–"10"
    aggravating: string;
    easing: string;
    dailyImpact: string;
    goals: string;
  };
  rom?: {
    limitations: string;
    worseWith: string;
  };
  strength?: {
    weaknessDescription: string;
    activitiesAffected: string;
  };
  balance?: {
    difficultyDescription: string;
    fallHistory: string;
  };
  gait?: {
    walkingDescription: string;
    aids: string;
  };
  functional?: {
    standingDuration: string;
    walkingDistance: string;
    stairsAbility: string;
    otherNotes: string;
  };
}

// ── Storage keys ───────────────────────────────────────────────────────────────

const REQ_PREFIX   = "cm_remote_req:";
const INDEX_PREFIX = "cm_remote_req_idx:";
const EXPIRY_DAYS  = 7;

function reqKey(id: string)       { return `${REQ_PREFIX}${id}`; }
function indexKey(patientId: string) {
  return `${INDEX_PREFIX}${patientId.trim()}`;
}

function readIndex(patientId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(indexKey(patientId)) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function writeIndex(patientId: string, ids: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(indexKey(patientId), JSON.stringify(ids));
}

/** Legacy assessments indexed under numeric patient id (pre-UUID). */
function legacyNumericIndexKey(patientId: string): string | null {
  const trimmed = patientId.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return trimmed;
}

function collectIndexIds(patientId: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (key: string) => {
    for (const id of readIndex(key)) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  };
  const trimmed = patientId.trim();
  if (!trimmed) return out;
  add(trimmed);
  const legacy = legacyNumericIndexKey(trimmed);
  if (legacy && legacy !== trimmed) add(legacy);
  return out;
}

function persist(req: RemoteAssessmentRequest) {
  if (typeof window === "undefined") return;
  localStorage.setItem(reqKey(req.id), JSON.stringify(req));
}

function getRemoteAssessmentLocal(id: string): RemoteAssessmentRequest | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(reqKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as RemoteAssessmentRequest;
  } catch {
    return null;
  }
}

function uuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function parseAssessmentType(value: string): AssessmentType {
  if (
    value === "general_msk" ||
    value === "sports" ||
    value === "gait" ||
    value === "pain_function" ||
    value === "stroke_neuro_v1"
  ) {
    return value;
  }
  return "general_msk";
}

function parseIncludedSections(value: unknown): PatientSectionId[] {
  if (!Array.isArray(value)) return [];
  const allowed: PatientSectionId[] = ["pain", "rom", "strength", "balance", "gait", "functional"];
  return value.filter((s): s is PatientSectionId => typeof s === "string" && allowed.includes(s as PatientSectionId));
}

function createRemoteAssessmentLocal(input: {
  patientId: string;
  patientName: string;
  assessmentType: AssessmentType;
  includedSections: PatientSectionId[];
}): RemoteAssessmentRequest {
  const now = new Date();
  const expires = new Date(now);
  expires.setDate(expires.getDate() + EXPIRY_DAYS);

  const patientId = input.patientId.trim();
  const req: RemoteAssessmentRequest = {
    id: uuid(),
    patientId,
    patientName: input.patientName,
    assessmentType: input.assessmentType,
    includedSections: input.includedSections,
    status: "pending",
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };

  persist(req);

  const ids = readIndex(patientId);
  writeIndex(patientId, [req.id, ...ids]);

  return req;
}

function mergePatientDraftIntoClinicianDraft(
  patientId: string,
  patientDraft: PatientAssessmentDraft,
): void {
  const clinicianDraft = loadGeneralAssessmentDraft(patientId.trim());
  const pd = patientDraft;

  if (pd.pain) {
    clinicianDraft.subjective = {
      ...clinicianDraft.subjective,
      chiefComplaint:       pd.pain.chiefComplaint      || clinicianDraft.subjective.chiefComplaint,
      painLocation:         pd.pain.painLocation        || clinicianDraft.subjective.painLocation,
      nprs:                 pd.pain.painScore           || clinicianDraft.subjective.nprs,
      aggravating:          pd.pain.aggravating         || clinicianDraft.subjective.aggravating,
      easing:               pd.pain.easing              || clinicianDraft.subjective.easing,
      functionalLimitations:pd.pain.dailyImpact         || clinicianDraft.subjective.functionalLimitations,
      goals:                pd.pain.goals               || clinicianDraft.subjective.goals,
    };
  }
  if (pd.rom?.limitations) {
    clinicianDraft.objective.rom = {
      ...clinicianDraft.objective.rom,
      notes: [clinicianDraft.objective.rom.notes, `[Patient-reported] ${pd.rom.limitations}`]
        .filter(Boolean).join("\n"),
    };
  }
  if (pd.gait?.walkingDescription) {
    clinicianDraft.objective.gait = {
      ...clinicianDraft.objective.gait,
      notes: [clinicianDraft.objective.gait.notes, `[Patient-reported] ${pd.gait.walkingDescription}`]
        .filter(Boolean).join("\n"),
    };
  }
  if (pd.balance?.difficultyDescription) {
    clinicianDraft.objective.balance = {
      ...clinicianDraft.objective.balance,
      notes: [clinicianDraft.objective.balance.notes, `[Patient-reported] ${pd.balance.difficultyDescription}`]
        .filter(Boolean).join("\n"),
    };
  }
  if (pd.functional?.otherNotes) {
    clinicianDraft.functional.five_x_sts = {
      ...clinicianDraft.functional.five_x_sts,
      notes: [clinicianDraft.functional.five_x_sts.notes, `[Patient-reported] ${pd.functional.otherNotes}`]
        .filter(Boolean).join("\n"),
    };
  }

  saveGeneralAssessmentDraft(String(patientId), clinicianDraft);
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

export async function createRemoteAssessment(input: {
  patientId: string;
  patientName: string;
  assessmentType: AssessmentType;
  includedSections: PatientSectionId[];
}): Promise<RemoteAssessmentRequest> {
  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/remote-assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: input.patientId.trim(),
          assessmentType: input.assessmentType,
          includedSections: input.includedSections,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          token: string;
          url: string;
          expiresAt: string;
        };
        const patientId = input.patientId.trim();
        const req: RemoteAssessmentRequest = {
          id: data.token,
          patientId,
          patientName: input.patientName,
          assessmentType: input.assessmentType,
          includedSections: input.includedSections,
          status: "pending",
          createdAt: new Date().toISOString(),
          expiresAt: data.expiresAt,
        };
        persist(req);
        const ids = readIndex(patientId);
        writeIndex(patientId, [req.id, ...ids]);
        return req;
      }

      let message = `Could not create assessment link (HTTP ${res.status}).`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        /* ignore parse errors */
      }
      throw new Error(message);
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error("Could not create assessment link. Check your connection and try again.");
    }
  }

  return createRemoteAssessmentLocal(input);
}

export async function getRemoteAssessment(id: string): Promise<RemoteAssessmentRequest | null> {
  if (typeof window !== "undefined") {
    try {
      const res = await fetch(`/api/remote-assessments/${encodeURIComponent(id)}`);
      if (res.ok) {
        const data = (await res.json()) as {
          assessmentType: string;
          includedSections: unknown;
          expiresAt?: string;
        };
        const local = getRemoteAssessmentLocal(id);
        const req: RemoteAssessmentRequest = {
          id,
          patientId: local?.patientId ?? "",
          patientName: local?.patientName ?? "",
          assessmentType: parseAssessmentType(data.assessmentType),
          includedSections: parseIncludedSections(data.includedSections),
          status: local?.status ?? "pending",
          createdAt: local?.createdAt ?? new Date().toISOString(),
          expiresAt: data.expiresAt ?? local?.expiresAt ?? new Date(Date.now() + EXPIRY_DAYS * 86400000).toISOString(),
          patientDraft: local?.patientDraft,
          assessmentLanguage: local?.assessmentLanguage,
          submittedAt: local?.submittedAt,
        };
        persist(req);
        return req;
      }
      if (res.status === 404) {
        return getRemoteAssessmentLocal(id);
      }
    } catch {
      /* fall through to localStorage */
    }
  }

  return getRemoteAssessmentLocal(id);
}

function parseRemoteStatus(value: string): RemoteAssessmentRequest["status"] {
  if (value === "submitted") return "submitted";
  if (value === "in_progress") return "in_progress";
  return "pending";
}

type RemoteAssessmentListApiItem = {
  token: string;
  patientId: string;
  assessmentType: string;
  includedSections: unknown;
  status: string;
  expiresAt: string;
  createdAt: string;
  submittedAt: string | null;
  assessmentId: string | null;
};

function mapApiListItemToRequest(
  item: RemoteAssessmentListApiItem,
  local: RemoteAssessmentRequest | null,
): RemoteAssessmentRequest {
  const req: RemoteAssessmentRequest = {
    id: item.token,
    patientId: item.patientId,
    patientName: local?.patientName ?? "",
    assessmentType: parseAssessmentType(item.assessmentType),
    includedSections: parseIncludedSections(item.includedSections),
    status: parseRemoteStatus(item.status),
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
    submittedAt: item.submittedAt ?? local?.submittedAt,
    assessmentId: item.assessmentId ?? local?.assessmentId,
    patientDraft: local?.patientDraft,
    assessmentLanguage: local?.assessmentLanguage,
  };
  persist(req);
  return req;
}

function listPatientAssessmentsLocal(patientId: string): RemoteAssessmentRequest[] {
  const ids = collectIndexIds(patientId);
  return ids
    .map((id) => getRemoteAssessmentLocal(id))
    .filter((r): r is RemoteAssessmentRequest => {
      if (!r) return false;
      const pid = patientId.trim();
      const rid = String(r.patientId).trim();
      return rid === pid || (legacyNumericIndexKey(pid) !== null && rid === legacyNumericIndexKey(pid));
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function fetchPatientAssessmentsFromApi(patientId: string): Promise<RemoteAssessmentRequest[] | null> {
  if (typeof window === "undefined" || !isUuidPatientId(patientId)) return null;

  try {
    const res = await fetch(
      `/api/remote-assessments?patientId=${encodeURIComponent(patientId.trim())}`,
      { headers: getAuthHeaders() },
    );
    if (!res.ok) return null;

    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) return null;

    const apiIds = new Set<string>();
    const merged = (rows as RemoteAssessmentListApiItem[]).map((item) => {
      apiIds.add(item.token);
      return mapApiListItemToRequest(item, getRemoteAssessmentLocal(item.token));
    });

    for (const local of listPatientAssessmentsLocal(patientId)) {
      if (!apiIds.has(local.id)) {
        merged.push(local);
      }
    }

    merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return merged;
  } catch {
    return null;
  }
}

/** List remote assessment links for a patient. Supabase API for UUID patients; localStorage for legacy demo. */
export async function listPatientAssessments(patientId: string): Promise<RemoteAssessmentRequest[]> {
  const fromApi = await fetchPatientAssessmentsFromApi(patientId);
  if (fromApi) return fromApi;
  return listPatientAssessmentsLocal(patientId);
}

export function updateRemoteAssessmentDraft(
  id: string,
  patientDraft: PatientAssessmentDraft,
  assessmentLanguage?: AssessmentLanguage,
): void {
  const req = getRemoteAssessmentLocal(id);
  if (!req) return;
  persist({
    ...req,
    status: "in_progress",
    patientDraft,
    ...(assessmentLanguage ? { assessmentLanguage } : {}),
  });
}

export async function submitRemoteAssessment(
  id: string,
  structuredData: Record<string, unknown>,
  assessmentLanguage: AssessmentLanguage = "en",
): Promise<void> {
  const res = await fetch(`/api/remote-assessments/${encodeURIComponent(id)}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structuredData }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to submit assessment (${res.status})`);
  }

  const req = getRemoteAssessmentLocal(id);
  const base: RemoteAssessmentRequest = req ?? {
    id,
    patientId: "",
    patientName: "",
    assessmentType: "general_msk",
    includedSections: [],
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
  };

  const patientDraft = structuredData as PatientAssessmentDraft;
  const submitted: RemoteAssessmentRequest = {
    ...base,
    status: "submitted",
    submittedAt: new Date().toISOString(),
    patientDraft,
    assessmentLanguage,
  };
  persist(submitted);

  if (base.patientId && base.assessmentType !== "stroke_neuro_v1") {
    mergePatientDraftIntoClinicianDraft(base.patientId, patientDraft);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export function isExpired(req: RemoteAssessmentRequest): boolean {
  return new Date(req.expiresAt) < new Date();
}

export function daysUntilExpiry(req: RemoteAssessmentRequest): number {
  const diff = new Date(req.expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function isTokenValid(req: RemoteAssessmentRequest): boolean {
  return !isExpired(req) && req.status !== "submitted";
}
