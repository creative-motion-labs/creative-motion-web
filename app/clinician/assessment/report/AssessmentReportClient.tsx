"use client";

import Link from "next/link";
import { useEffect, useState, useMemo, useCallback, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import type { BackendPatient } from "@/app/lib/api";
import type { AssessmentData } from "@/app/lib/assessment-types";
import type { AssessmentDetailResponse } from "@/app/api/assessments/[id]/route";
import {
  extractGeneralDraft,
} from "@/app/lib/assessment-payload";
import { loadGeneralAssessmentDraft, saveGeneralAssessmentDraft } from "@/app/lib/general-assessment/storage";
import type {
  CvRowStatus,
  FunctionalKey,
  GeneralAssessmentDraft,
  ObjectiveKey,
  OutcomeKey,
  SpecialTestResult,
} from "@/app/lib/general-assessment/types";
import {
  SPECIAL_TESTS_CATALOG,
  REGION_LABELS,
  REGION_ORDER,
  getTestsByRegion,
  countRegionResults,
  getTestedTests,
  type SpecialTestRegion,
} from "@/app/lib/general-assessment/special-tests-catalog";
import {
  getTreatmentPlanForPatient,
  REHAB_PROGRAMS,
  type TreatmentPlan,
  type RehabProgram,
} from "@/app/lib/api/treatment-plans";
import { PatientSubmittedAnswersReview } from "@/app/components/PatientSubmittedAnswersReview";
import type { PatientAssessmentDraft, PatientSectionId } from "@/app/lib/api/remote-assessments";
import {
  detectRedFlag,
  buildRemoteQuestionnaireSummary,
} from "@/app/lib/remote-questionnaire-summary";
import { ReportExportToolbar } from "@/app/components/reports/ReportExportToolbar";
import { RemoteQuestionnairePrintReport } from "@/app/components/reports/RemoteQuestionnairePrintReport";
import { CvCapturesClinicalSection } from "@/app/components/reports/CvCapturesClinicalSection";
import { AssessmentInterpretationDraftSection } from "@/app/components/reports/AssessmentInterpretationDraftSection";
import { PdfTranslationWarningModal } from "@/app/components/clinician/PdfTranslationWarningModal";
import { useCvSessionMetrics } from "@/app/hooks/useCvSessionMetrics";
import { getCvReadyExercises } from "@/app/lib/cv/cv-ready-exercises";
import { GAIT_ASSESSMENT_EXERCISE_DISPLAY_NAMES } from "@/app/lib/cv/gait-assessment-exercise-ids";
import { isAiTranslationEnabled } from "@/app/lib/ai/ai-features";
import {
  BADGE_FOR_THERAPIST_REVIEW,
  CLINICAL_DISCLAIMER_FULL,
  CLINICAL_REPORT_INTRO,
  CLINICAL_REPORT_SUBTITLE,
  CLINICAL_REPORT_TITLE,
  LABEL_THERAPIST_CLINICAL_IMPRESSION,
  LEGACY_IMPRESSION_NOTE,
  PATIENT_REPORTED_INTRO,
  patientReportedLabel,
  SECTION_OVERVIEW,
  RED_FLAG_PATIENT_REPORTED,
  REPORT_NEXT_STEPS,
  SAFETY_NONE_DOCUMENTED,
  SAFETY_REVIEW_REQUIRED,
  SECTION_CLINICAL_FINDINGS,
  SECTION_PATIENT_REPORTED_SUMMARY,
  SECTION_SAFETY_INDICATORS,
  SECTION_SUGGESTED_DIRECTION,
  SUGGESTED_DIRECTION_INTRO,
  SUGGESTED_DIRECTION_MATCH_NOTE,
  SUGGESTED_DIRECTION_NO_MATCH,
  therapistEnteredLabel,
} from "@/app/lib/reports/clinical-report-copy";
import {
  FOCUS_AREA_LABEL,
  FOCUS_BADGE_THERAPIST_REVIEW,
  FOCUS_CATEGORY_LABEL,
  FOCUS_CONFIRMATION_TEXT,
  FOCUS_DIRECTION_LABEL,
  FOCUS_DIRECTION_VALUE,
  FOCUS_PHASE_LABEL,
  FOCUS_SECTION_SUBTITLE,
  FOCUS_SECTION_TITLE,
} from "@/app/lib/clinical-focus-copy";
import { deriveClinicalFocusLabels } from "@/app/lib/clinical-focus-labels";
import { buildGeneralMskPayload } from "@/app/lib/assessment-payload";
import {
  PROGRAM_DIRECTION_CARD_BADGE,
  PROGRAM_DIRECTION_CATEGORY_LINE,
  PROGRAM_DIRECTION_CTA,
  PROGRAM_DIRECTION_FOCUS_LINE,
  PROGRAM_DIRECTION_FOOTER,
  PROGRAM_DIRECTION_INTRO,
  PROGRAM_DIRECTION_LOW_CONFIDENCE,
  PROGRAM_DIRECTION_NO_OPTIONS,
  PROGRAM_DIRECTION_RED_FLAG,
  PROGRAM_DIRECTION_SECTION_TITLE,
} from "@/app/lib/program-direction-copy";
import { resolveProgramOptionsForFocus } from "@/app/lib/program-direction-options";
import { buildAssessmentInterpretationDraft } from "@/app/lib/reports/assessment-interpretation-draft";
import { resolveAssessmentReportFromDetail } from "@/app/lib/reports/assessment-report-resolver";
import type { AssessmentReportKind } from "@/app/lib/reports/assessment-report-resolver";
import type { RemoteUpperLimbBatteryPayload } from "@/app/lib/remote-upper-limb-battery/types";
import { buildRemoteUpperLimbBatteryClinicianSummary } from "@/app/lib/remote-upper-limb-battery/battery-clinician-summary";
import { RemoteUpperLimbBatteryReportView } from "@/app/components/clinician/RemoteUpperLimbBatteryReportView";
import {
  StrokeQuestionnaireClinicianPanel,
  StrokeReportDisplay,
  isStrokeClinicianData,
} from "@/app/components/clinician/StrokeQuestionnaireClinicianPanel";
import {
  clinicalEnglishForStrokeDisplay,
  formatStrokeResponseValue,
  strokeQuestionById,
  type StrokeQuestionnaireSubmission,
} from "@/app/lib/stroke-questionnaire/stroke-questionnaire-schema";
import {
  sanitizeStrokeReportForSourceSafety,
  STROKE_PT_REPORT_APPENDIX_SECTION_ID,
  type StrokePtClinicalReport,
} from "@/app/lib/stroke-questionnaire/stroke-pt-clinical-report";

// ── Constants & labels ─────────────────────────────────────────────────────────

const OBJECTIVE_LABELS: Record<ObjectiveKey, string> = {
  posture: "Posture",
  rom: "Range of Motion",
  squat: "Squat Analysis",
  gait: "Gait Analysis",
  balance: "Balance",
  sit_to_stand: "Sit-to-Stand",
};

const FUNCTIONAL_LABELS: Record<FunctionalKey, string> = {
  five_x_sts: "5× Sit-to-Stand",
  tug: "Timed Up and Go (TUG)",
  gait_speed: "Gait Speed",
  single_leg_balance: "Single-Leg Balance",
  squat: "Squat",
  step_down: "Step-Down Test",
};

const OUTCOME_LABELS: Record<OutcomeKey, { abbr: string; full: string }> = {
  nprs:      { abbr: "NPRS",     full: "Numeric Pain Rating Scale" },
  psfs:      { abbr: "PSFS",     full: "Patient-Specific Functional Scale" },
  lefs:      { abbr: "LEFS",     full: "Lower Extremity Functional Scale" },
  quickdash: { abbr: "QuickDASH", full: "QuickDASH" },
  oswestry:  { abbr: "ODI",      full: "Oswestry Disability Index" },
  ndi:       { abbr: "NDI",      full: "Neck Disability Index" },
};

const STATUS_CLS: Record<CvRowStatus, string> = {
  not_started: "border-white/15 bg-white/[0.06] text-white/40",
  in_progress:  "border-amber-300/25 bg-amber-400/10 text-amber-300",
  completed:    "border-lime-300/25 bg-lime-400/12 text-lime-300",
};

const STATUS_LABEL: Record<CvRowStatus, string> = {
  not_started: "Not started",
  in_progress:  "In progress",
  completed:    "Completed",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function hasPatientSubmittedContent(d: GeneralAssessmentDraft): boolean {
  const s = d.subjective;
  return [
    s.chiefComplaint,
    s.painLocation,
    s.nprs,
    s.aggravating,
    s.easing,
    s.functionalLimitations,
    s.goals,
    s.redFlags,
  ].some((v) => v.trim());
}

function hasSoapContent(d: GeneralAssessmentDraft): boolean {
  return [d.soap.subjective, d.soap.objective, d.soap.assessment, d.soap.plan].some((v) => v.trim());
}

function hasClinicalInterpretation(d: GeneralAssessmentDraft): boolean {
  return [
    d.ai.clinicalImpression,
    d.ai.supportingFindings,
    d.ai.missingTests,
    d.ai.confidenceLevel,
    d.ai.safetyNotes,
  ].some((v) => v.trim());
}

function isDraftMeaningful(d: GeneralAssessmentDraft): boolean {
  const s = d.subjective;
  if ([s.chiefComplaint, s.painLocation, s.nprs, s.aggravating, s.easing, s.goals, s.redFlags]
    .some((v) => v.trim())) return true;
  if ([d.soap.subjective, d.soap.objective, d.soap.assessment, d.soap.plan]
    .some((v) => v.trim())) return true;
  if (d.therapist.finalDiagnosis.trim() || d.therapist.treatmentPriorities.trim()) return true;
  if (Object.values(d.objective).some((v) => v.status !== "not_started" || v.result.trim())) return true;
  if (Object.values(d.functional).some((v) => v.status !== "not_started" || v.result.trim())) return true;
  if (Object.values(d.outcomes).some((v) => v.rawNotes.trim() || v.clinicianDocumented.trim())) return true;
  return false;
}

function matchPrograms(d: GeneralAssessmentDraft): RehabProgram[] {
  const text = [
    d.ai.clinicalImpression,
    d.therapist.finalDiagnosis,
    d.therapist.treatmentPriorities,
    d.subjective.chiefComplaint,
  ].join(" ").toLowerCase();

  return REHAB_PROGRAMS.filter((p) => {
    if (p.id === "acl-rehab" &&
        (text.includes("acl") || text.includes("knee") || text.includes("anterior cruciate") || text.includes("ligament")))
      return true;
    if (p.id === "gait-training" &&
        (text.includes("gait") || text.includes("walk") || text.includes("stride") || text.includes("step")))
      return true;
    return false;
  });
}

function hasRiskData(d: GeneralAssessmentDraft): boolean {
  return Boolean(d.subjective.redFlags.trim() || d.ai.safetyNotes.trim());
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    });
  } catch { return iso; }
}

// ── Atoms ──────────────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: CvRowStatus }) {
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CLS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function InfoTile({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30">{label}</p>
      <p className={`mt-1.5 text-sm font-semibold ${accent ?? "text-white"}`}>{value || "—"}</p>
    </div>
  );
}

function TextBlock({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null;
  return (
    <div className="border-b border-white/8 py-3.5 last:border-0">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/40">{label}</p>
      <p className="text-sm leading-6 text-white/80 whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function EmptyFieldNote({ text = "Not recorded" }: { text?: string }) {
  return <span className="text-xs italic text-white/30">{text}</span>;
}

function SoapCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] p-4">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#5DCAA5]/60">{label}</p>
      {value.trim() ? (
        <p className="text-sm leading-6 text-white/80 whitespace-pre-wrap">{value}</p>
      ) : (
        <EmptyFieldNote />
      )}
    </div>
  );
}

function EditableSoapSection({
  draft,
  onChange,
  onSave,
  saving,
  saveMessage,
}: {
  draft: GeneralAssessmentDraft;
  onChange: (soap: GeneralAssessmentDraft["soap"]) => void;
  onSave: () => void;
  saving: boolean;
  saveMessage: string;
}) {
  const fields: { key: keyof GeneralAssessmentDraft["soap"]; label: string }[] = [
    { key: "subjective", label: "S — Subjective: Patient-reported and clinician-entered information" },
    { key: "objective", label: "O — Objective: Clinician examination required" },
    { key: "assessment", label: "A — Clinical impression: Clinician to complete" },
    { key: "plan", label: "P — Plan: Clinician decision" },
  ];

  return (
    <div>
      <p className="mb-4 text-xs text-white/45 print:hidden">
        Edit SOAP notes below. Changes are saved to this assessment record.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(({ key, label }) => (
          <div key={key} className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] p-4">
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-[#5DCAA5]/60">
              {label}
            </label>
            <textarea
              value={draft.soap[key]}
              onChange={(e) => onChange({ ...draft.soap, [key]: e.target.value })}
              rows={key === "assessment" || key === "plan" ? 4 : 5}
              className="w-full resize-y rounded-[6px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2 text-sm leading-6 text-white/85 outline-none focus:border-[#1D9E75]/40 print:border-transparent print:bg-white print:text-black"
            />
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 print:hidden">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-[7px] bg-[#1D9E75] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#179165] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save SOAP"}
        </button>
        {saveMessage && (
          <span className={`text-xs ${saveMessage.startsWith("Saved") ? "text-[#5DCAA5]" : "text-rose-300"}`}>
            {saveMessage}
          </span>
        )}
      </div>
    </div>
  );
}

const DOC_ICON = (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
);

function StructuredAssessmentReport({ data, notes }: { data: AssessmentData; notes: string | null }) {
  return (
    <div className="mx-auto max-w-4xl space-y-5 px-6 py-8">
      <ReportSection id="overview" title="Patient & Assessment Overview" defaultOpen icon={DOC_ICON}>
        <div className="grid gap-3 sm:grid-cols-2">
          <InfoTile label="Assessment type" value="Structured assessment (clinician-entered)" />
          <InfoTile label="Source" value="Mixed — clinician-entered wizard" />
          <InfoTile label="Assessed at" value={formatDate(data.assessedAt)} />
          <InfoTile label="Assessed by" value={data.assessedBy || "—"} />
        </div>
      </ReportSection>
      <ReportSection id="patient-reported" title={SECTION_PATIENT_REPORTED_SUMMARY} defaultOpen icon={DOC_ICON}>
        <p className="mb-4 text-xs text-white/40">
          Values below are clinician-entered during structured assessment. Labelled as patient-reported where they reflect patient history.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <InfoTile label={patientReportedLabel("Body region")} value={data.bodyRegion} />
          <InfoTile label={patientReportedLabel("Pain at rest")} value={`${data.painAtRest}/10`} accent="text-rose-300" />
          <InfoTile label={patientReportedLabel("Pain on movement")} value={`${data.painOnMovement}/10`} accent="text-rose-300" />
          <InfoTile label={patientReportedLabel("Pain location")} value={data.painLocation || "—"} />
          <InfoTile label={patientReportedLabel("Onset")} value={data.onset} />
          <InfoTile label="Rehabilitation phase (clinician-entered)" value={data.rehabilitationPhase} />
        </div>
      </ReportSection>
      <ReportSection id="clinical-findings" title={SECTION_CLINICAL_FINDINGS} defaultOpen icon={DOC_ICON}>
        {data.clinicalNotes && (
          <TextBlock label={therapistEnteredLabel("Clinical notes")} value={data.clinicalNotes} />
        )}
        {notes && <TextBlock label={therapistEnteredLabel("Provider notes")} value={notes} />}
        {data.gaitObservations && (
          <TextBlock label={therapistEnteredLabel("Gait observations")} value={data.gaitObservations} />
        )}
        {data.posturalFindings && (
          <TextBlock label={therapistEnteredLabel("Postural findings")} value={data.posturalFindings} />
        )}
        {data.rehabilitationGoals?.length > 0 && (
          <TextBlock
            label={therapistEnteredLabel("Rehabilitation goals")}
            value={data.rehabilitationGoals.join(", ")}
          />
        )}
        {data.aggravatingFactors?.length > 0 && (
          <TextBlock
            label={patientReportedLabel("Aggravating factors")}
            value={data.aggravatingFactors.join(", ")}
          />
        )}
      </ReportSection>
      <ReportSection id="safety" title={SECTION_SAFETY_INDICATORS} icon={DOC_ICON}>
        <p className="text-sm text-white/70">{SAFETY_NONE_DOCUMENTED}</p>
      </ReportSection>
      {data.rom?.measurements?.length > 0 && (
        <ReportSection id="objective" title="Range of Motion (clinician-entered)" defaultOpen icon={DOC_ICON}>
          <div className="space-y-2">
            {data.rom.measurements.map((m) => (
              <div key={m.label} className="flex justify-between border-b border-white/8 py-2 text-sm">
                <span className="text-white/70">{m.label}</span>
                <span className="font-semibold text-[#5DCAA5]">
                  {m.value}{m.unit ?? "°"}
                </span>
              </div>
            ))}
          </div>
        </ReportSection>
      )}
      {data.functionalTests?.length > 0 && (
        <ReportSection id="functional" title="Functional Tests" icon={DOC_ICON}>
          {data.functionalTests.map((t) => (
            <div key={t.testName} className="border-b border-white/8 py-3 last:border-0">
              <p className="text-sm font-semibold text-white">{t.testName}</p>
              <p className="text-xs text-white/50">Result: {t.result}</p>
              {t.notes && <p className="mt-1 text-sm text-white/70">{t.notes}</p>}
            </div>
          ))}
        </ReportSection>
      )}
    </div>
  );
}

// ── Collapsible section wrapper ────────────────────────────────────────────────

function ReportSection({
  id,
  title,
  icon,
  children,
  defaultOpen = true,
  accent,
  screenOnly = false,
  hideWhenEmptyPrint = false,
  hasPrintContent = true,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  accent?: string;
  screenOnly?: boolean;
  hideWhenEmptyPrint?: boolean;
  hasPrintContent?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const emptyPrintClass = hideWhenEmptyPrint && !hasPrintContent ? "print-empty-section" : "";

  return (
    <section
      id={id}
      className={`print-section overflow-hidden rounded-[10px] border border-[#1E2D42] bg-[#0F1825] ${screenOnly ? "screen-only" : ""} ${emptyPrintClass}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="screen-only flex w-full items-center gap-3 px-6 py-4 text-left transition hover:bg-[#0B1220]/50"
      >
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border ${accent ?? "border-[#1E2D42] bg-[#0B1220] text-white/40"}`}>
          {icon}
        </div>
        <h2 className="flex-1 text-base font-bold text-white">{title}</h2>
        <svg
          className={`h-4 w-4 text-white/30 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <h2 className="print-section-title hidden print:block">{title}</h2>
      <div
        className={`print-section-body border-t border-[#1E2D42] px-6 pb-6 pt-5 print:border-0 print:px-0 print:pb-0 print:pt-3 ${
          open ? "" : "hidden print:!block"
        }`}
      >
        {children}
      </div>
    </section>
  );
}

function ClinicalDisclaimerBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-start gap-3 rounded-[7px] border border-amber-400/20 bg-amber-400/[0.07] px-4 py-3 ${className}`}
    >
      <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
      <p className="text-xs leading-5 text-amber-200/90">{CLINICAL_DISCLAIMER_FULL}</p>
    </div>
  );
}

function ReportScreenHeader({
  patientName,
  displayDate,
  assessmentTypeLabel,
  sourceLabel,
  languageLabel,
  hasRiskFlags,
}: {
  patientName: string;
  displayDate: string;
  assessmentTypeLabel: string;
  sourceLabel: string;
  languageLabel?: string | null;
  hasRiskFlags?: boolean;
}) {
  return (
    <section className="screen-only border-b border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.07),transparent_38%),linear-gradient(135deg,#071a2f_0%,#0d1f3c_55%,#0f1f45_100%)]">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">{CLINICAL_REPORT_TITLE}</p>
        <p className="mt-1 text-xs text-white/50">{CLINICAL_REPORT_SUBTITLE}</p>
        <p className="mt-2 text-xs text-white/45">{CLINICAL_REPORT_INTRO}</p>
        <h1 className="mt-4 text-3xl font-bold text-white">{patientName}</h1>
        <p className="mt-1.5 text-sm text-white/55">Assessment date: {formatDate(displayDate)}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-0.5 text-[11px] font-semibold text-white/50">
            {assessmentTypeLabel}
          </span>
          <span className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-0.5 text-[11px] font-semibold text-white/50">
            Source: {sourceLabel}
          </span>
          {languageLabel ? (
            <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-0.5 text-[11px] font-semibold text-amber-200">
              Language: {languageLabel}
            </span>
          ) : null}
          {hasRiskFlags ? (
            <span className="rounded-full border border-rose-400/30 bg-rose-400/15 px-3 py-0.5 text-[11px] font-semibold text-rose-300">
              Clinician review required
            </span>
          ) : null}
        </div>
        <div className="mt-5">
          <ClinicalDisclaimerBlock />
        </div>
      </div>
    </section>
  );
}

function RasqPrintHeader({
  patientName,
  patientId,
  displayDate,
  assessmentId,
  assessmentTypeLabel = "General MSK assessment",
  sourceLabel = "Mixed",
}: {
  patientName: string;
  patientId: string;
  displayDate: string;
  assessmentId?: string;
  assessmentTypeLabel?: string;
  sourceLabel?: string;
}) {
  return (
    <header className="print-only print-report-header">
      <div className="flex items-center gap-3 border-b border-gray-300 pb-3">
        <svg width="28" height="28" viewBox="0 0 20 20" fill="none" aria-hidden className="shrink-0">
          <path d="M10 2C5.582 2 2 5.582 2 10s3.582 8 8 8" stroke="#1D9E75" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M10 5.5C7.515 5.5 5.5 7.515 5.5 10S7.515 14.5 10 14.5" stroke="#179165" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="10" cy="10" r="1.5" fill="#1D9E75" />
        </svg>
        <div>
          <p className="text-base font-bold text-black">RASQ</p>
          <p className="text-[11px] text-gray-600">{CLINICAL_REPORT_SUBTITLE}</p>
        </div>
      </div>
      <h1 className="mt-4 text-xl font-bold text-black">{CLINICAL_REPORT_TITLE}</h1>
      <p className="mt-1 text-xs text-gray-600">{CLINICAL_REPORT_INTRO}</p>
      <p className="mt-3 text-sm font-semibold text-black">{patientName}</p>
      <p className="mt-1 text-xs text-gray-600">
        {formatDate(displayDate)} · Patient ID {patientId}
        {assessmentId ? ` · Ref ${assessmentId.slice(0, 8)}` : ""}
      </p>
      <p className="mt-2 text-xs text-gray-700">
        Assessment type: {assessmentTypeLabel} · Source: {sourceLabel}
      </p>
      <p className="mt-3 rounded border border-gray-300 bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-gray-700">
        {CLINICAL_DISCLAIMER_FULL}
      </p>
    </header>
  );
}

function PatientSubmittedPrintSection({ draft }: { draft: GeneralAssessmentDraft }) {
  return (
    <ReportSection
      id="patient-portal-answers"
      title={SECTION_PATIENT_REPORTED_SUMMARY}
      defaultOpen
      hideWhenEmptyPrint
      hasPrintContent={hasPatientSubmittedContent(draft)}
      icon={DOC_ICON}
    >
      <p className="mb-3 text-xs text-white/40 print:text-gray-600">
        Patient-reported information only. Not objective examination findings.
      </p>
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-1">
        <TextBlock label={patientReportedLabel("Main complaint")} value={draft.subjective.chiefComplaint} />
        <TextBlock label={patientReportedLabel("Pain score (NPRS)")} value={draft.subjective.nprs} />
        <TextBlock label={patientReportedLabel("Pain location")} value={draft.subjective.painLocation} />
        <TextBlock label={patientReportedLabel("Aggravating factors")} value={draft.subjective.aggravating} />
        <TextBlock label={patientReportedLabel("Easing factors")} value={draft.subjective.easing} />
        <TextBlock label={patientReportedLabel("Functional limitations")} value={draft.subjective.functionalLimitations} />
        <TextBlock label={patientReportedLabel("Goals")} value={draft.subjective.goals} />
        <TextBlock label={patientReportedLabel("Red flags reported")} value={draft.subjective.redFlags} />
      </div>
    </ReportSection>
  );
}

// ── Section 4: Risk Flags (elevated layout, outside wrapper) ───────────────────

function SafetyIndicatorsSection({ draft }: { draft: GeneralAssessmentDraft }) {
  const hasFlags = hasRiskData(draft);

  return (
    <ReportSection
      id="safety"
      title={SECTION_SAFETY_INDICATORS}
      defaultOpen={hasFlags}
      accent={hasFlags ? "border-rose-400/30 bg-rose-400/10 text-rose-300" : "border-lime-300/25 bg-lime-400/10 text-lime-300"}
      icon={DOC_ICON}
    >
      {hasFlags ? (
        <>
          <p className="mb-4 text-sm font-semibold text-rose-200">{SAFETY_REVIEW_REQUIRED}</p>
          <div className="space-y-3">
            {draft.subjective.redFlags.trim() && (
              <div className="rounded-[8px] border border-rose-400/25 bg-rose-400/10 p-4">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-rose-300/80">
                  {patientReportedLabel("Red flags reported")}
                </p>
                <p className="text-sm leading-6 text-white/85 whitespace-pre-wrap">{draft.subjective.redFlags}</p>
              </div>
            )}
            {draft.ai.safetyNotes.trim() && (
              <div className="rounded-[8px] border border-amber-400/25 bg-amber-400/10 p-4">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-amber-300/80">
                  {therapistEnteredLabel("Safety notes (draft for review)")}
                </p>
                <p className="text-sm leading-6 text-white/85 whitespace-pre-wrap">{draft.ai.safetyNotes}</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-white/70">{SAFETY_NONE_DOCUMENTED}</p>
      )}
    </ReportSection>
  );
}

function RiskFlagsAlert({ draft }: { draft: GeneralAssessmentDraft }) {
  if (!hasRiskData(draft)) return null;
  return (
    <div id="risk-flags" className="screen-only">
      <SafetyIndicatorsSection draft={draft} />
    </div>
  );
}

// ── Assessment focus context (Sprint O) ───────────────────────────────────────

const FOCUS_ICON = (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.745 3.745 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z"
    />
  </svg>
);

function AssessmentFocusContextSection({
  assessmentType,
  structuredData,
}: {
  assessmentType?: string;
  structuredData?: unknown;
}) {
  const labels = useMemo(
    () => deriveClinicalFocusLabels(assessmentType, structuredData),
    [assessmentType, structuredData],
  );

  const dataSourceNote =
    labels.dataSource === "patient-reported"
      ? "Based on patient-reported fields."
      : labels.dataSource === "clinician-entered"
        ? "Based on clinician-entered fields."
        : labels.dataSource === "mixed"
          ? "Based on patient-reported and clinician-entered fields."
          : "Based on limited assessment fields.";

  return (
    <ReportSection
      id="focus-context"
      title={FOCUS_SECTION_TITLE}
      defaultOpen
      accent="border-cyan-300/25 bg-cyan-400/10 text-cyan-300"
      icon={FOCUS_ICON}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-white/50">{FOCUS_SECTION_SUBTITLE}</p>
        <span className="shrink-0 rounded-full border border-cyan-300/25 bg-cyan-400/10 px-2.5 py-0.5 text-[10px] font-semibold text-cyan-300">
          {FOCUS_BADGE_THERAPIST_REVIEW}
        </span>
      </div>
      <p className="mb-4 text-[10px] text-white/35">{dataSourceNote}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <InfoTile label={FOCUS_AREA_LABEL} value={labels.focusArea} />
        <InfoTile label={FOCUS_CATEGORY_LABEL} value={labels.clinicalCategory} />
        <InfoTile label={FOCUS_PHASE_LABEL} value={labels.phaseContext} />
        <InfoTile label={FOCUS_DIRECTION_LABEL} value={FOCUS_DIRECTION_VALUE} />
      </div>
      <p className="mt-4 text-xs leading-relaxed text-white/45">{FOCUS_CONFIRMATION_TEXT}</p>
    </ReportSection>
  );
}

// ── Sprint P: Program options for therapist review ─────────────────────────────

const PROGRAM_DIRECTION_ICON = (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
    />
  </svg>
);

function ProgramDirectionForReviewSection({
  assessmentType,
  structuredData,
  patientId,
}: {
  assessmentType?: string;
  structuredData?: unknown;
  patientId: string;
}) {
  const labels = useMemo(
    () => deriveClinicalFocusLabels(assessmentType, structuredData),
    [assessmentType, structuredData],
  );
  const hasRedFlag = useMemo(() => detectRedFlag(structuredData), [structuredData]);
  const options = useMemo(
    () => resolveProgramOptionsForFocus(labels, { hasRedFlag }),
    [labels, hasRedFlag],
  );
  const planBuilderHref = patientId
    ? `/clinician/plans/new?patientId=${encodeURIComponent(patientId)}`
    : "/clinician/plans/new";

  return (
    <ReportSection
      id="program-direction"
      title={PROGRAM_DIRECTION_SECTION_TITLE}
      defaultOpen
      accent="border-violet-300/25 bg-violet-400/10 text-violet-300"
      icon={PROGRAM_DIRECTION_ICON}
    >
      <p className="mb-4 max-w-2xl text-xs leading-relaxed text-white/50">
        {PROGRAM_DIRECTION_INTRO}
      </p>

      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        <p className="text-xs text-white/55">
          <span className="font-semibold text-white/70">{PROGRAM_DIRECTION_FOCUS_LINE}</span>{" "}
          {labels.focusArea}
        </p>
        <p className="text-xs text-white/55">
          <span className="font-semibold text-white/70">{PROGRAM_DIRECTION_CATEGORY_LINE}</span>{" "}
          {labels.clinicalCategory}
        </p>
      </div>

      {hasRedFlag && (
        <div className="mb-4 rounded-xl border border-amber-300/25 bg-amber-400/10 px-4 py-3">
          <p className="text-xs leading-relaxed text-amber-200">{PROGRAM_DIRECTION_RED_FLAG}</p>
        </div>
      )}

      {labels.confidence === "low" && options.length > 0 && (
        <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <p className="text-xs leading-relaxed text-white/50">{PROGRAM_DIRECTION_LOW_CONFIDENCE}</p>
        </div>
      )}

      {options.length === 0 ? (
        <p className="text-sm leading-relaxed text-white/50">{PROGRAM_DIRECTION_NO_OPTIONS}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {options.map((option) => (
            <div
              key={option.templateId}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <h3 className="text-sm font-bold text-white">{option.title}</h3>
                <span className="shrink-0 rounded-full border border-violet-300/25 bg-violet-400/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-300">
                  {PROGRAM_DIRECTION_CARD_BADGE}
                </span>
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
                {option.conditionArea} · {option.level}
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-white/45">{option.displayNote}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          href={planBuilderHref}
          className="inline-flex rounded-xl border border-violet-300/30 bg-violet-400/10 px-4 py-2.5 text-xs font-semibold text-violet-200 transition hover:bg-violet-400/15"
        >
          {PROGRAM_DIRECTION_CTA} →
        </Link>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-white/40">{PROGRAM_DIRECTION_FOOTER}</p>
    </ReportSection>
  );
}

// ── Section 7: Program recommendation ─────────────────────────────────────────

function ProgramRecommendationSection({
  draft,
  patientId,
  existingPlan,
}: {
  draft: GeneralAssessmentDraft;
  patientId: string;
  existingPlan: TreatmentPlan | null;
}) {
  const matched = useMemo(() => matchPrograms(draft), [draft]);
  const allPrograms = matched.length > 0 ? matched : REHAB_PROGRAMS.slice(0, 2);
  const isMatched = matched.length > 0;

  return (
    <ReportSection
      id="programs"
      title={SECTION_SUGGESTED_DIRECTION}
      defaultOpen
      accent="border-violet-300/25 bg-violet-400/10 text-violet-300"
      icon={
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0118 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3l1.5 1.5 3-3.75" />
        </svg>
      }
    >
      <p className="mb-4 text-xs leading-relaxed text-white/50">{SUGGESTED_DIRECTION_INTRO}</p>
      {!isMatched && (
        <p className="mb-4 text-xs text-white/40 italic">{SUGGESTED_DIRECTION_NO_MATCH}</p>
      )}
      {isMatched && (
        <p className="mb-4 text-xs text-cyan-300/70">{SUGGESTED_DIRECTION_MATCH_NOTE}</p>
      )}

      <div className="space-y-4">
        {allPrograms.map((prog) => (
          <div key={prog.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">
                  Program option · {prog.category}
                </span>
                <h3 className="mt-0.5 text-sm font-bold text-white">{prog.name}</h3>
              </div>
              {isMatched && (
                <span className="shrink-0 rounded-full border border-violet-300/25 bg-violet-400/10 px-2.5 py-0.5 text-[10px] font-semibold text-violet-300">
                  {BADGE_FOR_THERAPIST_REVIEW}
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {prog.phases.map((ph, i) => (
                <div
                  key={ph.id}
                  className={`flex items-start gap-3 rounded-xl border px-3 py-2 ${
                    i === 0
                      ? "border-cyan-300/20 bg-cyan-400/[0.06]"
                      : "border-white/8 bg-white/[0.02]"
                  }`}
                >
                  <span className={`mt-0.5 h-4 w-4 shrink-0 text-center text-[10px] font-bold leading-4 ${i === 0 ? "text-cyan-300" : "text-white/30"}`}>
                    P{i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-xs font-semibold ${i === 0 ? "text-cyan-200" : "text-white/50"}`}>
                      Phase {i + 1}: {ph.name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/40">{ph.durationHint} · {ph.defaultSessions} sessions</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ReportSection>
  );
}

// ── Report next steps (pilot demo flow) ───────────────────────────────────────

function ReportNextStepsFooter({
  patientId,
  existingPlan,
}: {
  patientId: string;
  existingPlan: TreatmentPlan | null;
}) {
  const planHref = `/clinician/plans/new?patientId=${encodeURIComponent(patientId)}`;
  const profileHref = `/clinician/patients/${patientId}`;
  const profilePlanHref = `${profileHref}#rehabilitation-plan`;

  return (
    <section className="screen-only overflow-hidden rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6">
      <h2 className="text-base font-bold text-white">Next steps</h2>
      <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-white/55">
        {REPORT_NEXT_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-white/45">
        Select or adapt a rehabilitation plan after reviewing this report. All clinical decisions remain with the treating physiotherapist.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Link
          href={planHref}
          className="inline-flex items-center justify-center rounded-[7px] bg-[#1D9E75] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#179165]"
        >
          {existingPlan ? "Update treatment plan →" : "Build treatment plan →"}
        </Link>
        <Link
          href={existingPlan ? profilePlanHref : profileHref}
          className="inline-flex items-center justify-center rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-5 py-2.5 text-sm font-semibold text-white/70 transition hover:text-white"
        >
          View patient chart →
        </Link>
        <Link
          href="/clinician/results"
          className="inline-flex items-center justify-center rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-5 py-2.5 text-sm font-semibold text-white/70 transition hover:text-white"
        >
          Open Results →
        </Link>
      </div>
    </section>
  );
}

// ── Section 8: Assign Treatment Plan ──────────────────────────────────────────

function AssignPlanSection({
  patientId,
  existingPlan,
}: {
  patientId: string;
  existingPlan: TreatmentPlan | null;
}) {
  const profileHref = `/clinician/patients/${patientId}`;
  const planHref = `/clinician/plans/new?patientId=${encodeURIComponent(patientId)}`;

  return (
    <ReportSection
      id="assign"
      title="Rehabilitation Plan Assignment"
      defaultOpen
      screenOnly
      accent="border-cyan-300/25 bg-cyan-400/10 text-cyan-300"
      icon={
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      }
    >
      {existingPlan ? (
        <div className="mb-5 rounded-2xl border border-lime-300/20 bg-lime-400/[0.06] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-lime-300/80">
            Treatment plan already assigned
          </p>
          <p className="mt-1 text-sm font-semibold text-white">{existingPlan.programName}</p>
          <p className="mt-0.5 text-xs text-white/55">{existingPlan.phaseName}</p>
          <p className="mt-1 text-xs text-white/40">
            {existingPlan.totalSessions} sessions · {existingPlan.sessionsPerWeek}× per week · Assigned {formatDate(existingPlan.assignedAt)}
          </p>
        </div>
      ) : (
        <div className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-sm text-white/60">No treatment plan has been assigned to this patient yet.</p>
          <p className="mt-1 text-xs text-white/35">
            Select a programme template, adjust dose, and share the patient portal link.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href={planHref}
          className="flex items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {existingPlan ? "Update Treatment Plan" : "Build Treatment Plan"}
        </Link>
        <Link
          href={`${profileHref}#rehabilitation-plan`}
          className="flex items-center justify-center rounded-2xl border border-white/12 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          View plan on patient chart →
        </Link>
      </div>
    </ReportSection>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AssessmentReportClient() {
  const searchParams = useSearchParams();
  const patientIdParam = searchParams.get("patientId")?.trim() ?? "";
  const assessmentId = searchParams.get("assessmentId")?.trim() ?? "";

  const [draft, setDraft] = useState<GeneralAssessmentDraft | null>(null);
  const [structuredData, setStructuredData] = useState<AssessmentData | null>(null);
  const [remoteUpperLimbBattery, setRemoteUpperLimbBattery] = useState<RemoteUpperLimbBatteryPayload | null>(null);
  const [remoteQuestionnaireDraft, setRemoteQuestionnaireDraft] = useState<PatientAssessmentDraft | null>(null);
  const [remoteSubmissionMeta, setRemoteSubmissionMeta] = useState<Record<string, unknown> | null>(null);
  const [remoteIncludedSections, setRemoteIncludedSections] = useState<PatientSectionId[]>([]);
  const [strokeSubmission, setStrokeSubmission] = useState<StrokeQuestionnaireSubmission | null>(null);
  const [reportKind, setReportKind] = useState<AssessmentReportKind | null>(null);
  const [serverBacked, setServerBacked] = useState(false);
  const [resolvedPatientId, setResolvedPatientId] = useState(patientIdParam);
  const [serverNotes, setServerNotes] = useState<string | null>(null);
  const [reportDate, setReportDate] = useState("");
  const [loadError, setLoadError] = useState("");

  const [patient, setPatient] = useState<BackendPatient | null>(null);
  const [existingPlan, setExistingPlan] = useState<TreatmentPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [soapSaving, setSoapSaving] = useState(false);
  const [soapSaveMessage, setSoapSaveMessage] = useState("");
  const [patientAnsweredInArabic, setPatientAnsweredInArabic] = useState(false);
  const [showPdfWarning, setShowPdfWarning] = useState(false);
  const [translateThenExportLoading, setTranslateThenExportLoading] = useState(false);
  const [translationExport, setTranslationExport] = useState({
    doneCount: 0,
    totalCount: 0,
    allTranslated: true,
    anyLoading: false,
    translateAll: async () => {},
  });

  const handleTranslationProgress = useCallback(
    (progress: {
      doneCount: number;
      totalCount: number;
      allTranslated: boolean;
      anyLoading: boolean;
      translateAll: () => Promise<void>;
    }) => {
      setTranslationExport((prev) => {
        if (
          prev.doneCount === progress.doneCount &&
          prev.totalCount === progress.totalCount &&
          prev.allTranslated === progress.allTranslated &&
          prev.anyLoading === progress.anyLoading &&
          prev.translateAll === progress.translateAll
        ) {
          return prev;
        }
        return progress;
      });
    },
    [],
  );

  const handleRemoteQuestionnaireExport = useCallback(() => {
    if (!isAiTranslationEnabled()) {
      window.print();
      return;
    }
    const assessmentLanguage = patientAnsweredInArabic ? "ar" : "en";
    const untranslatedCount = translationExport.totalCount - translationExport.doneCount;
    if (untranslatedCount > 0 && assessmentLanguage === "ar") {
      setShowPdfWarning(true);
    } else {
      window.print();
    }
  }, [patientAnsweredInArabic, translationExport.doneCount, translationExport.totalCount]);

  const handleTranslateThenExport = useCallback(async () => {
    setTranslateThenExportLoading(true);
    try {
      await translationExport.translateAll();
      window.print();
      setShowPdfWarning(false);
    } finally {
      setTranslateThenExportLoading(false);
    }
  }, [translationExport.translateAll]);

  const handleExportAnyway = useCallback(() => {
    window.print();
    setShowPdfWarning(false);
  }, []);

  const patientId = resolvedPatientId || patientIdParam;

  const { metrics: patientCvMetrics, loading: cvMetricsLoading } = useCvSessionMetrics({
    patientId: patientId || undefined,
    limit: 12,
    dedupePatientSessions: false,
  });

  const cvExerciseNameById = useMemo<Record<string, string>>(
    () => ({
      ...Object.fromEntries(
        getCvReadyExercises().map((exercise) => [exercise.exerciseId, exercise.nameEn]),
      ),
      ...GAIT_ASSESSMENT_EXERCISE_DISPLAY_NAMES,
      "timed-up-and-go": "Timed Up and Go",
    }),
    [],
  );

  const cvMetricsForReport = useMemo(
    () =>
      patientCvMetrics.filter(
        (row) => row.source === "assessment_movement" || row.source === "patient_session",
      ),
    [patientCvMetrics],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError("");
      setStructuredData(null);
      setRemoteUpperLimbBattery(null);
      setRemoteQuestionnaireDraft(null);
      setRemoteSubmissionMeta(null);
      setRemoteIncludedSections([]);
      setStrokeSubmission(null);
      setReportKind(null);
      setServerBacked(false);
      setPatientAnsweredInArabic(false);

      if (assessmentId) {
        try {
          const res = await fetch(`/api/assessments/${encodeURIComponent(assessmentId)}`);
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `Failed to load assessment (${res.status})`);
          }
          const detail = (await res.json()) as AssessmentDetailResponse;
          if (cancelled) return;

          const resolved = resolveAssessmentReportFromDetail(detail);
          setResolvedPatientId(resolved.resolvedPatientId);
          setServerNotes(resolved.serverNotes);
          setReportDate(resolved.reportDate);
          setPatient(resolved.patient);
          setServerBacked(resolved.serverBacked);
          setPatientAnsweredInArabic(resolved.patientAnsweredInArabic);
          setDraft(resolved.draft);
          setRemoteQuestionnaireDraft(resolved.remoteQuestionnaireDraft);
          setRemoteSubmissionMeta(resolved.remoteSubmissionMeta);
          setRemoteIncludedSections(resolved.remoteIncludedSections);
          setStrokeSubmission(resolved.strokeSubmission);
          setStructuredData(resolved.structuredData);
          setRemoteUpperLimbBattery(resolved.remoteUpperLimbBattery);
          setReportKind(resolved.kind);
          if (resolved.loadError) {
            setLoadError(resolved.loadError);
          }
        } catch (err) {
          if (!cancelled) {
            setLoadError(err instanceof Error ? err.message : "Failed to load assessment.");
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
        return;
      }

      if (!patientIdParam) {
        if (!cancelled) setLoading(false);
        return;
      }

      setResolvedPatientId(patientIdParam);
      const d = loadGeneralAssessmentDraft(patientIdParam);
      if (!cancelled) {
        setDraft(isDraftMeaningful(d) ? d : null);
        setReportKind("general_msk");
        setServerBacked(false);
        setReportDate(d.updatedAt);
        setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [assessmentId, patientIdParam]);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;

    if (patient && patient.full_name) return;

    void fetch(`/api/patients/${encodeURIComponent(patientId)}`)
      .then(async (res) => {
        if (!res.ok) return;
        const p = (await res.json()) as { full_name: string; diagnosis?: string | null };
        if (!cancelled) {
          setPatient({ full_name: p.full_name, diagnosis: p.diagnosis ?? null } as BackendPatient);
        }
      })
      .catch(() => { /* optional */ });

    return () => { cancelled = true; };
  }, [patientId, patient]);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    void getTreatmentPlanForPatient(patientId)
      .then((plan) => {
        if (!cancelled) setExistingPlan(plan);
      })
      .catch(() => {
        if (!cancelled) setExistingPlan(null);
      });
    return () => { cancelled = true; };
  }, [patientId]);

  async function handleSaveSoap() {
    if (!assessmentId || !draft) return;
    setSoapSaving(true);
    setSoapSaveMessage("");
    try {
      const res = await fetch(`/api/assessments/${encodeURIComponent(assessmentId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Save failed (${res.status})`);
      }
      const detail = (await res.json()) as AssessmentDetailResponse;
      const updated = extractGeneralDraft(detail.structured_data, detail.type);
      if (updated) setDraft(updated);
      if (patientId) saveGeneralAssessmentDraft(patientId, updated ?? draft);
      setSoapSaveMessage("Saved to server.");
    } catch (err) {
      setSoapSaveMessage(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSoapSaving(false);
    }
  }

  const objectiveKeys = Object.keys(draft?.objective ?? {}) as ObjectiveKey[];
  const functionalKeys = Object.keys(draft?.functional ?? {}) as FunctionalKey[];
  const outcomeKeys = Object.keys(draft?.outcomes ?? {}) as OutcomeKey[];
  const hasFlags = draft ? Boolean(hasRiskData(draft)) : false;

  const therapistDecisionLabel = useMemo(() => {
    if (!draft?.therapist.decision) return null;
    return draft.therapist.decision === "approve"
      ? { label: "Approved", cls: "text-lime-300" }
      : draft.therapist.decision === "edit"
      ? { label: "Needs Edit", cls: "text-amber-300" }
      : { label: "Rejected", cls: "text-rose-300" };
  }, [draft]);

  // ── Loading / empty states ──────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#0B1220]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1E2D42] border-t-[#1D9E75]" />
        <p className="text-sm text-white/40">Loading assessment report…</p>
      </main>
    );
  }

  if (!patientId && !assessmentId) {
    return (
      <main className="min-h-screen bg-[#0B1220] text-white">
        <div className="mx-auto max-w-2xl px-6 py-20 text-center">
          <h1 className="text-2xl font-bold text-white">No report selected</h1>
          <p className="mt-3 text-sm text-white/45">
            Open this report from the patient chart or the Results page.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/clinician/patients"
              className="inline-flex items-center rounded-[7px] bg-[#1D9E75] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#179165]">
              Patient charts
            </Link>
            <Link href="/clinician/results"
              className="inline-flex items-center rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-6 py-2.5 text-sm font-semibold text-white transition hover:text-white/80">
              Results
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-[#0B1220] text-white">
        <div className="mx-auto max-w-2xl px-6 py-20 text-center">
          <h1 className="text-xl font-bold text-white">Could not load report</h1>
          <p className="mt-2 text-sm text-rose-300">{loadError}</p>
          {patientId && (
            <Link href={`/clinician/patients/${patientId}`}
              className="mt-7 inline-flex rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-6 py-2.5 text-sm font-semibold text-white">
              ← Patient profile
            </Link>
          )}
        </div>
      </main>
    );
  }

  if (reportKind === "stroke_questionnaire" && strokeSubmission) {
    const storedStrokeReport =
      ((strokeSubmission as unknown as Record<string, unknown>)
        .strokePtClinicalReportFinal ??
        (strokeSubmission as unknown as Record<string, unknown>)
          .strokePtClinicalReportDraft) as StrokePtClinicalReport | undefined;
    const strokeReport = storedStrokeReport
      ? sanitizeStrokeReportForSourceSafety(storedStrokeReport, strokeSubmission)
      : undefined;
    const hasReportAppendix = Boolean(
      strokeReport?.sections.some(
        (section) => section.id === STROKE_PT_REPORT_APPENDIX_SECTION_ID,
      ),
    );
    const backHref = patientId
      ? `/clinician/patients/${patientId}`
      : "/clinician/patients";

    return (
      <main className="assessment-report-root print-report min-h-screen bg-[#0B1220] text-white">
        <ReportExportToolbar backHref={backHref} onExportClick={() => window.print()} />
        <ReportScreenHeader
          patientName={patient?.full_name ?? "Patient"}
          displayDate={reportDate}
          assessmentTypeLabel="Remote Neurorehabilitation Intake"
          sourceLabel="Patient- and/or caregiver-reported"
          languageLabel={strokeSubmission.assessmentLanguage === "ar" ? "Arabic" : "English"}
          hasRiskFlags={strokeSubmission.safetyState !== "PASS"}
        />
        <div className="print-report-body mx-auto max-w-4xl space-y-6 px-6 py-8 print:space-y-2">
          <div className="print:hidden">
            <StrokeQuestionnaireClinicianPanel
              assessmentId={assessmentId}
              structuredData={strokeSubmission}
              patientId={patientId}
              onStructuredDataUpdated={(next) => {
                if (isStrokeClinicianData(next)) setStrokeSubmission(next);
              }}
            />
          </div>
          <header className="hidden border-b border-gray-300 pb-2 print:block">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              RASQ Clinical Assessment Report
            </p>
            <h1 className="mt-1 text-xl font-bold text-gray-950">
              {patient?.full_name ?? "Patient"}
            </h1>
            <p className="mt-0.5 text-sm text-gray-600">
              Remote Neurorehabilitation Intake · {reportDate.slice(0, 10)}
            </p>
            <p className="mt-1 text-xs text-gray-600">
              Patient- and/or caregiver-reported clinical decision-support information
              for physiotherapist review.
            </p>
          </header>
          {strokeReport ? (
            <section className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6 print:border-0 print:bg-white print:p-0 print:text-gray-900">
              <StrokeReportDisplay report={strokeReport} />
            </section>
          ) : (
            <section className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6">
              <p className="text-sm text-white/70">
                The Stroke PT Clinical Report has not been generated and finalized yet.
              </p>
            </section>
          )}
          {!strokeReport ? (
          <section
            className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6 print:border-gray-200 print:bg-white print:text-gray-900"
          >
            <h2 className="text-base font-bold">Encounter &amp; Safety</h2>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <InfoTile label="Questionnaire" value="Stroke v1" />
              <InfoTile label="Pathway" value="Remote Neurorehabilitation Intake" />
              <InfoTile
                label="Safety gate"
                value={strokeSubmission.safetyState.replaceAll("_", " ")}
              />
              <InfoTile
                label="Information source"
                value={
                  strokeSubmission.responses.sc_information_source
                    ? formatStrokeResponseValue(
                        "sc_information_source",
                        strokeSubmission.responses.sc_information_source,
                      )
                    : "Not specified"
                }
              />
            </dl>
            <p className="mt-4 text-xs text-white/50 print:text-gray-600">
              {strokeSubmission.safetyState === "PASS"
                ? "PASS reflects completion of the intake safety gate only. It does not indicate medical clearance for exercise or performance assessment."
                : strokeSubmission.safetyState === "REQUIRES_CLINICIAN_REVIEW"
                  ? "Clinician safety review is required before considering performance assessment. This status does not indicate medical clearance."
                  : "An urgent escalation response was recorded. Do not authorize performance assessment from this intake."}
            </p>
          </section>
          ) : null}
          {!hasReportAppendix ? (
          <section className="hidden break-before-page print:block">
            <h2 className="text-lg font-bold text-gray-950">
              Appendix: Source Response Traceability
            </h2>
            <p className="mt-1 text-xs text-gray-600">
              Original responses and approved Clinical English. This appendix preserves
              reporter provenance and is not an objective examination.
            </p>
            <div className="mt-5 space-y-4">
              {Object.entries(strokeSubmission.responses)
                .filter(([, response]) =>
                  Array.isArray(response.rawValue)
                    ? response.rawValue.length > 0
                    : response.rawValue.trim().length > 0,
                )
                .map(([id, response]) => (
                  <div key={id} className="break-inside-avoid border-b border-gray-200 pb-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                      {id.replaceAll("_", " ")} · {response.provenance} ·{" "}
                      {response.reporterRole} · {response.rawLanguage} ·{" "}
                      {response.responseMethod ??
                        (strokeQuestionById(id)?.options ? "selection" : "text")}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">Original</p>
                    <p className="text-sm text-gray-900">
                      {formatStrokeResponseValue(id, response)}
                    </p>
                    {clinicalEnglishForStrokeDisplay(id, response) ? (
                      <>
                        <p className="mt-2 text-xs text-gray-500">Clinical English</p>
                        <p className="text-sm text-gray-900">
                          {clinicalEnglishForStrokeDisplay(id, response)}
                        </p>
                      </>
                    ) : null}
                  </div>
                ))}
            </div>
          </section>
          ) : null}
        </div>
      </main>
    );
  }

  if (reportKind === "remote_questionnaire" && remoteQuestionnaireDraft) {
    const hasRedFlag = detectRedFlag(remoteQuestionnaireDraft);
    const printSummary = buildRemoteQuestionnaireSummary(
      remoteQuestionnaireDraft,
      reportDate || new Date().toISOString(),
    );
    const interpretationDraft = buildAssessmentInterpretationDraft({
      draft: remoteQuestionnaireDraft,
      includedSections: remoteIncludedSections,
      submissionMeta: remoteSubmissionMeta,
    });
    const backHref = patientId ? `/clinician/patients/${patientId}` : "/clinician/patients";

    return (
      <main className="assessment-report-root print-report min-h-screen bg-[#0B1220] text-white">
        {printSummary ? (
          <div className="print-only">
            <RemoteQuestionnairePrintReport
              summary={printSummary}
              interpretationDraft={interpretationDraft}
              patientName={patient?.full_name ?? "Patient"}
              patientId={patientId}
              assessmentId={assessmentId || undefined}
              clinicianNotes={serverNotes}
              submissionMeta={remoteSubmissionMeta}
              assessmentLanguage={patientAnsweredInArabic ? "ar" : "en"}
            />
            <div className="mt-4">
              <CvCapturesClinicalSection
                metrics={cvMetricsForReport}
                exerciseNameById={cvExerciseNameById}
                variant="print"
              />
            </div>
          </div>
        ) : null}

        <ReportExportToolbar backHref={backHref} onExportClick={handleRemoteQuestionnaireExport} />
        {showPdfWarning ? (
          <PdfTranslationWarningModal
            untranslatedCount={translationExport.totalCount - translationExport.doneCount}
            onTranslateThenExport={() => void handleTranslateThenExport()}
            onExportAnyway={handleExportAnyway}
            translating={translationExport.anyLoading || translateThenExportLoading}
            doneCount={translationExport.doneCount}
            totalCount={translationExport.totalCount}
          />
        ) : null}
        <ReportScreenHeader
          patientName={patient?.full_name ?? "Patient"}
          displayDate={reportDate}
          assessmentTypeLabel="Remote questionnaire"
          sourceLabel="Patient-reported"
          languageLabel={patientAnsweredInArabic ? "Arabic" : "English"}
          hasRiskFlags={hasRedFlag}
        />
        <div className="screen-only print-report-body mx-auto max-w-4xl px-6 py-8 space-y-6">
          <ReportSection id="overview" title={SECTION_OVERVIEW} defaultOpen icon={DOC_ICON}>
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoTile label="Patient reference" value={patient?.full_name ?? `#${patientId}`} />
              <InfoTile label="Assessment type" value="Remote questionnaire" />
              <InfoTile label="Assessment date" value={formatDate(reportDate)} />
              <InfoTile label="Source" value="Patient-reported" />
              {patientAnsweredInArabic && <InfoTile label="Language" value="Arabic" />}
            </div>
          </ReportSection>
          <ReportSection
            id="safety"
            title={SECTION_SAFETY_INDICATORS}
            defaultOpen={hasRedFlag}
            icon={DOC_ICON}
            accent={hasRedFlag ? "border-rose-400/30 bg-rose-400/10 text-rose-300" : "border-lime-300/25 bg-lime-400/10 text-lime-300"}
          >
            {hasRedFlag ? (
              <>
                <p className="text-sm font-semibold text-rose-200">{RED_FLAG_PATIENT_REPORTED}</p>
                <p className="mt-2 text-sm text-rose-200/80">{SAFETY_REVIEW_REQUIRED}</p>
              </>
            ) : (
              <p className="text-sm text-white/70">{SAFETY_NONE_DOCUMENTED}</p>
            )}
          </ReportSection>
          <section className="overflow-hidden rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6">
            <div>
              <PatientSubmittedAnswersReview
                patientDraft={remoteQuestionnaireDraft}
                includedSections={remoteIncludedSections}
                assessmentLanguage={patientAnsweredInArabic ? "ar" : "en"}
                submissionMeta={remoteSubmissionMeta}
                assessmentId={assessmentId || undefined}
                onTranslationProgress={handleTranslationProgress}
              />
            </div>
          </section>
          <AssessmentInterpretationDraftSection draft={interpretationDraft} />
          {serverNotes?.trim() ? (
            <section className="overflow-hidden rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6">
              <h2 className="text-base font-bold text-white">Therapist-entered clinical note</h2>
              <p className="mt-3 text-sm leading-relaxed text-white/80 whitespace-pre-wrap">
                {serverNotes.trim()}
              </p>
            </section>
          ) : null}
          <AssessmentFocusContextSection
            assessmentType="remote_questionnaire"
            structuredData={remoteSubmissionMeta}
          />
          <ProgramDirectionForReviewSection
            assessmentType="remote_questionnaire"
            structuredData={remoteSubmissionMeta}
            patientId={patientId}
          />
          {!cvMetricsLoading ? (
            <CvCapturesClinicalSection
              metrics={cvMetricsForReport}
              exerciseNameById={cvExerciseNameById}
            />
          ) : null}
          <ReportNextStepsFooter patientId={patientId} existingPlan={existingPlan} />
          <ClinicalDisclaimerBlock />
        </div>
      </main>
    );
  }

  if (reportKind === "structured" && structuredData) {
    return (
      <main className="assessment-report-root print-report min-h-screen bg-[#0B1220] text-white">
        <RasqPrintHeader
          patientName={patient?.full_name ?? "Patient"}
          patientId={patientId}
          displayDate={reportDate}
          assessmentId={assessmentId || undefined}
          assessmentTypeLabel="Structured assessment"
          sourceLabel="Mixed — clinician-entered"
        />
        <header className="screen-only sticky top-0 z-30 border-b border-[#1E2D42] bg-[#0B1220]">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-3">
            <Link href={patientId ? `/clinician/patients/${patientId}` : "/clinician/patients"}
              className="rounded-[6px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2 text-xs font-semibold text-white">
              ← Patient
            </Link>
            <div className="flex flex-col items-end gap-1">
              <button type="button" onClick={() => window.print()}
                className="rounded-[6px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2 text-xs font-semibold text-white/55 hover:text-white">
                Export Clinical Report (PDF)
              </button>
              <p className="max-w-[220px] text-right text-[10px] leading-snug text-white/35">
                Use &ldquo;Save as PDF&rdquo; in your browser&apos;s print dialog.
              </p>
            </div>
          </div>
        </header>
        <ReportScreenHeader
          patientName={patient?.full_name ?? "Patient"}
          displayDate={reportDate}
          assessmentTypeLabel="Structured assessment"
          sourceLabel="Mixed — clinician-entered"
        />
        <div className="print-report-body mx-auto max-w-4xl px-6 py-8 space-y-6">
        <StructuredAssessmentReport data={structuredData} notes={serverNotes} />
        <AssessmentFocusContextSection
          assessmentType="structured"
          structuredData={structuredData}
        />
        <ProgramDirectionForReviewSection
          assessmentType="structured"
          structuredData={structuredData}
          patientId={patientId}
        />
        <ReportNextStepsFooter patientId={patientId} existingPlan={existingPlan} />
        <ClinicalDisclaimerBlock />
        </div>
      </main>
    );
  }

  if (reportKind === "upper_limb_motor_screen" && remoteUpperLimbBattery) {
    const batterySummary = buildRemoteUpperLimbBatteryClinicianSummary({
      payload: remoteUpperLimbBattery,
      submittedAt: reportDate,
    });
    const backHref = patientId ? `/clinician/patients/${patientId}` : "/clinician/patients";
    return (
      <main className="assessment-report-root print-report min-h-screen bg-[#0B1220] text-white">
        <ReportExportToolbar backHref={backHref} backLabel="Back to Patient Profile" />
        <ReportScreenHeader
          patientName={patient?.full_name ?? "Patient"}
          displayDate={reportDate}
          assessmentTypeLabel="Remote Upper-Limb Battery"
          sourceLabel="Camera-derived · remote"
        />
        <div className="print-report-body mx-auto max-w-4xl px-6 py-8 space-y-6">
          <RemoteUpperLimbBatteryReportView summary={batterySummary} profileHref={backHref} />
          <ClinicalDisclaimerBlock />
        </div>
      </main>
    );
  }

  if (!draft) {
    return (
      <main className="min-h-screen bg-[#0B1220] text-white">
        <div className="mx-auto max-w-2xl px-6 py-20 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-[10px] border border-[#1E2D42] bg-[#0F1825]">
            <svg className="h-6 w-6 text-white/35" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white">No report available</h1>
          <p className="mt-2 text-sm text-white/45">
            {assessmentId
              ? "This assessment does not have a printable report yet."
              : "Complete an assessment first, then open the report from the patient chart."}
          </p>
          {patientId ? (
            <Link href={`/clinician/patients/${patientId}`}
              className="mt-7 inline-flex items-center rounded-[7px] bg-[#1D9E75] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#179165]">
              Open patient chart
            </Link>
          ) : (
            <Link href="/clinician/patients"
              className="mt-7 inline-flex items-center rounded-[7px] bg-[#1D9E75] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#179165]">
              Patient charts
            </Link>
          )}
        </div>
      </main>
    );
  }

  // ── Full report ─────────────────────────────────────────────────────────────

  const displayDate = reportDate || draft.updatedAt;

  return (
    <main className="assessment-report-root print-report min-h-screen bg-[#0B1220] text-white">

      <RasqPrintHeader
        patientName={patient?.full_name ?? `Patient #${patientId}`}
        patientId={patientId}
        displayDate={displayDate}
        assessmentId={assessmentId || undefined}
        assessmentTypeLabel="General MSK assessment"
        sourceLabel={patientAnsweredInArabic ? "Mixed" : "Clinician-entered / patient-reported"}
      />

      {/* ── Sticky top bar ── */}
      <header className="screen-only sticky top-0 z-30 border-b border-[#1E2D42] bg-[#0B1220]">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-2">
            <Link href={`/clinician/patients/${patientId}`}
              className="rounded-[6px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2 text-xs font-semibold text-white transition hover:text-white/80">
              ← Patient
            </Link>
            <Link href={`/clinician/assessment?patientId=${patientId}`}
              className="rounded-[6px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2 text-xs font-semibold text-white/55 transition hover:text-white">
              Edit Assessment
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-[6px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2 text-xs font-semibold text-white/55 transition hover:text-white"
              >
                Export Clinical Report (PDF)
              </button>
              <p className="max-w-[220px] text-right text-[10px] leading-snug text-white/35">
                Use &ldquo;Save as PDF&rdquo; in your browser&apos;s print dialog.
              </p>
            </div>
            {serverBacked && (
              <span className="rounded-[5px] border border-[#1D9E75]/25 bg-[#1D9E75]/10 px-2 py-1 text-[10px] font-semibold text-[#5DCAA5]">
                Saved to patient record
              </span>
            )}
            <Link
              href={`/clinician/plans/new?patientId=${encodeURIComponent(patientId)}`}
              className="rounded-xl bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-cyan-300"
            >
              Build treatment plan →
            </Link>
          </div>
        </div>
      </header>

      <ReportScreenHeader
        patientName={patient?.full_name ?? `Patient #${patientId}`}
        displayDate={displayDate}
        assessmentTypeLabel="General MSK assessment"
        sourceLabel={patientAnsweredInArabic ? "Mixed" : "Clinician-entered / patient-reported"}
        languageLabel={patientAnsweredInArabic ? "Arabic (patient-reported sections)" : "English"}
        hasRiskFlags={hasFlags}
      />

      {/* ── Section jump nav ── */}
      <div className="screen-only sticky top-[53px] z-20 border-b border-white/[0.06] bg-[#071a2f]/90 backdrop-blur-md">
        <div className="mx-auto max-w-4xl overflow-x-auto px-6 py-2">
          <div className="flex min-w-max gap-1">
            {[
              { id: "overview", label: "Overview" },
              { id: "patient-reported", label: "Patient-reported" },
              hasFlags ? { id: "safety", label: "Safety" } : null,
              { id: "clinical-findings", label: "Clinical findings" },
              { id: "objective", label: "Objective" },
              { id: "functional", label: "Functional" },
              { id: "outcomes", label: "Outcomes" },
              { id: "ai", label: "Therapist notes" },
              { id: "soap", label: "SOAP" },
              { id: "programs", label: "Rehab direction" },
              { id: "assign", label: "Plan assignment" },
            ].filter(Boolean).map((item) => item && (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={`shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold transition ${
                  item.id === "safety"
                    ? "text-rose-300 hover:bg-rose-400/10"
                    : "text-white/50 hover:bg-white/8 hover:text-white"
                }`}
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* ── Report body ── */}
      <div className="print-report-body mx-auto max-w-4xl space-y-5 px-6 py-8">

        <ReportSection
          id="overview"
          title={SECTION_OVERVIEW}
          defaultOpen
          icon={DOC_ICON}
          accent="border-cyan-300/25 bg-cyan-400/10 text-cyan-300"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <InfoTile label="Patient reference" value={patient?.full_name ?? `#${patientId}`} />
            <InfoTile label="Assessment type" value="General MSK assessment" />
            <InfoTile label="Assessment date" value={formatDate(draft.updatedAt)} />
            <InfoTile
              label="Source"
              value={patientAnsweredInArabic ? "Mixed" : "Clinician-entered / patient-reported"}
            />
            {patientAnsweredInArabic && (
              <InfoTile label="Language" value="Arabic (patient-reported sections)" />
            )}
            <InfoTile
              label="Therapist decision status"
              value={therapistDecisionLabel?.label ?? "Pending clinician review"}
              accent={therapistDecisionLabel?.cls ?? "text-white/40"}
            />
          </div>
        </ReportSection>

        <ReportSection
          id="patient-reported"
          title={SECTION_PATIENT_REPORTED_SUMMARY}
          defaultOpen
          icon={DOC_ICON}
          accent="border-amber-300/25 bg-amber-400/10 text-amber-200"
        >
          <p className="mb-4 text-xs text-white/45">{PATIENT_REPORTED_INTRO}</p>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-1">
            <TextBlock label={patientReportedLabel("Chief complaint")} value={draft.subjective.chiefComplaint} />
            <TextBlock label={patientReportedLabel("Pain location / body region")} value={draft.subjective.painLocation} />
            <TextBlock label={patientReportedLabel("NPRS pain score")} value={draft.subjective.nprs} />
            <TextBlock label={patientReportedLabel("Aggravating factors")} value={draft.subjective.aggravating} />
            <TextBlock label={patientReportedLabel("Easing factors")} value={draft.subjective.easing} />
            <TextBlock label={patientReportedLabel("Functional limitations")} value={draft.subjective.functionalLimitations} />
            <TextBlock label={patientReportedLabel("Patient goals")} value={draft.subjective.goals} />
            {!draft.subjective.chiefComplaint && !draft.subjective.nprs && (
              <p className="py-3 text-sm text-white/30 italic">No patient-reported subjective data recorded.</p>
            )}
          </div>
        </ReportSection>

        <PatientSubmittedPrintSection draft={draft} />

        <div id="safety">
          <SafetyIndicatorsSection draft={draft} />
        </div>

        <ReportSection
          id="clinical-findings"
          title={SECTION_CLINICAL_FINDINGS}
          defaultOpen
          icon={DOC_ICON}
          accent="border-violet-300/25 bg-violet-400/10 text-violet-300"
        >
          <TextBlock
            label={LABEL_THERAPIST_CLINICAL_IMPRESSION}
            value={draft.therapist.finalDiagnosis}
          />
          {draft.therapist.finalDiagnosis?.trim() && (
            <p className="mb-4 text-xs text-white/40 italic">{LEGACY_IMPRESSION_NOTE}</p>
          )}
          <TextBlock label="Therapist-entered treatment priorities" value={draft.therapist.treatmentPriorities} />
          {!draft.therapist.finalDiagnosis?.trim() && !draft.therapist.treatmentPriorities?.trim() && (
            <p className="text-sm text-white/30 italic">No therapist-entered clinical impression recorded.</p>
          )}
        </ReportSection>

        {/* ── Section 2: Objective Findings (screen only) ── */}
        <ReportSection
          id="objective"
          title="Objective Findings"
          defaultOpen
          screenOnly
          accent="border-violet-300/25 bg-violet-400/10 text-violet-300"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" />
            </svg>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {objectiveKeys.map((k) => {
              const row = draft.objective[k];
              return (
                <div key={k} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-cyan-100">{OBJECTIVE_LABELS[k]}</h3>
                    <div className="flex items-center gap-2">
                      {row.cameraCv && (
                        <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
                          CV
                        </span>
                      )}
                      <StatusChip status={row.status} />
                    </div>
                  </div>
                  {row.result.trim() ? (
                    <p className="mb-2 text-sm text-white/75 whitespace-pre-wrap">{row.result}</p>
                  ) : (
                    <p className="mb-2 text-xs italic text-white/30">No result recorded</p>
                  )}
                  {row.notes.trim() && (
                    <p className="border-t border-white/8 pt-2 text-xs text-white/50">{row.notes}</p>
                  )}
                </div>
              );
            })}
          </div>
        </ReportSection>

        {/* ── Section 2b: Special Tests ── */}
        {(() => {
          const st = draft.specialTests ?? {};
          const testedItems = getTestedTests(st);
          const hasAny = testedItems.length > 0;

          const RESULT_STYLES: Record<SpecialTestResult, string> = {
            not_tested:   "border-white/12 bg-white/[0.05] text-white/40",
            negative:     "border-lime-300/30 bg-lime-400/10 text-lime-300",
            positive:     "border-rose-300/30 bg-rose-400/10 text-rose-200",
            inconclusive: "border-amber-300/30 bg-amber-400/10 text-amber-200",
          };

          return (
            <ReportSection
              id="special-tests"
              title="Special Tests"
              defaultOpen={hasAny}
              screenOnly
              accent="border-[#1D9E75]/25 bg-[#1D9E75]/10 text-[#5DCAA5]"
              icon={
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                </svg>
              }
            >
              {/* Disclaimer */}
              <div className="mb-4 flex items-start gap-3 rounded-[7px] border border-amber-300/20 bg-amber-400/[0.07] px-4 py-3">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <p className="text-xs leading-5 text-amber-200/90">
                  Special tests are therapist-entered clinical findings. Results support clinician review and do not
                  constitute a medical diagnosis or treatment prescription.
                </p>
              </div>

              {!hasAny ? (
                <p className="py-2 text-sm italic text-white/30">No special tests recorded in this assessment.</p>
              ) : (
                <div className="space-y-4">
                  {REGION_ORDER.map((region) => {
                    const regionTests = getTestsByRegion(region as SpecialTestRegion);
                    const counts = countRegionResults(st, region as SpecialTestRegion);
                    const testedInRegion = regionTests
                      .map((t) => ({ def: t, entry: st[t.id] }))
                      .filter((t) => t.entry && t.entry.result !== "not_tested");
                    if (testedInRegion.length === 0) return null;
                    return (
                      <div key={region} className="overflow-hidden rounded-[8px] border border-[#1E2D42]">
                        {/* Region header */}
                        <div className="flex items-center justify-between border-b border-[#1E2D42] bg-[#0B1220] px-4 py-3">
                          <p className="text-sm font-bold text-white">{REGION_LABELS[region as SpecialTestRegion]}</p>
                          <div className="flex items-center gap-2">
                            {counts.positive > 0 && (
                              <span className="rounded-[4px] border border-rose-300/25 bg-rose-400/10 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
                                {counts.positive} positive
                              </span>
                            )}
                            {counts.inconclusive > 0 && (
                              <span className="rounded-[4px] border border-amber-300/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                                {counts.inconclusive} inconclusive
                              </span>
                            )}
                            {counts.negative > 0 && (
                              <span className="rounded-[4px] border border-lime-300/20 bg-lime-400/8 px-2 py-0.5 text-[10px] font-semibold text-lime-400/80">
                                {counts.negative} negative
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Test rows */}
                        <div className="divide-y divide-white/[0.06]">
                          {testedInRegion.map(({ def, entry }) => (
                            <div key={def.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-white/90">{def.name}</p>
                                <p className="text-xs text-white/40">{def.hint}</p>
                                {entry?.notes.trim() && (
                                  <p className="mt-1.5 text-xs text-white/60 italic">{entry.notes}</p>
                                )}
                              </div>
                              <span className={`shrink-0 rounded-[5px] border px-2.5 py-1 text-xs font-semibold ${RESULT_STYLES[entry?.result ?? "not_tested"]}`}>
                                {entry?.result === "positive"     ? "Positive" :
                                 entry?.result === "negative"     ? "Negative" :
                                 entry?.result === "inconclusive" ? "Inconclusive" : "Not tested"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ReportSection>
          );
        })()}

        {/* ── Section 3: Functional Tests (screen only) ── */}
        <ReportSection
          id="functional"
          title="Functional Tests"
          defaultOpen
          screenOnly
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
          }
        >
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.04]">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-white/40">
                    Test
                  </th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-widest text-white/40">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-white/40">
                    Result
                  </th>
                  <th className="hidden px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-white/40 sm:table-cell">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {functionalKeys.map((k, i) => {
                  const row = draft.functional[k];
                  return (
                    <tr
                      key={k}
                      className={`border-b border-white/[0.06] last:border-0 ${i % 2 === 0 ? "bg-transparent" : "bg-white/[0.02]"}`}
                    >
                      <td className="px-4 py-3 font-medium text-white/80">{FUNCTIONAL_LABELS[k]}</td>
                      <td className="px-4 py-3 text-center">
                        <StatusChip status={row.status} />
                      </td>
                      <td className="px-4 py-3 text-white/60">
                        {row.result.trim() || <EmptyFieldNote />}
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-white/40 sm:table-cell">
                        {row.notes.trim() || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ReportSection>

        {/* ── Section 3b: Outcome Measures (screen only) ── */}
        <ReportSection
          id="outcomes"
          title="Outcome Measures"
          defaultOpen
          screenOnly
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-9v9m3-4.5v4.5m-10.5 0h9M3.75 3h16.5v18H3.75z" />
            </svg>
          }
        >
          <p className="mb-4 text-xs text-white/40">
            No auto-scoring — raw entries and clinician-documented values only.
          </p>
          <div className="overflow-hidden rounded-[8px] border border-[#1E2D42]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1E2D42] bg-[#0B1220]">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-white/40">Scale</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-white/40">Raw notes</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-white/40">Documented score</th>
                </tr>
              </thead>
              <tbody>
                {outcomeKeys.map((k, i) => {
                  const row = draft.outcomes[k];
                  const meta = OUTCOME_LABELS[k];
                  return (
                    <tr
                      key={k}
                      className={`border-b border-white/[0.06] last:border-0 ${i % 2 === 0 ? "bg-transparent" : "bg-white/[0.02]"}`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-semibold text-white/80">{meta.abbr}</span>
                        <span className="ml-2 text-xs text-white/35">{meta.full}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-white/60">
                        {row.rawNotes.trim() || <EmptyFieldNote />}
                      </td>
                      <td className="px-4 py-3 text-xs text-white/60">
                        {row.clinicianDocumented.trim() || <EmptyFieldNote />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ReportSection>

        {/* ── Therapist-entered draft notes (legacy AI fields) ── */}
        <ReportSection
          id="ai"
          title="Therapist-Entered Notes (Draft for Review)"
          defaultOpen
          hideWhenEmptyPrint
          hasPrintContent={hasClinicalInterpretation(draft)}
          accent="border-amber-300/25 bg-amber-400/10 text-amber-300"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
            </svg>
          }
        >
          <p className="mb-4 text-xs text-white/45">
            Draft documentation for clinician review. Not generated by RASQ as a medical diagnosis.
          </p>

          <div className="space-y-3">
            {[
              { label: therapistEnteredLabel("Clinical impression (draft)"), value: draft.ai.clinicalImpression },
              { label: therapistEnteredLabel("Supporting findings"), value: draft.ai.supportingFindings },
              { label: therapistEnteredLabel("Missing tests / gaps"), value: draft.ai.missingTests },
              { label: therapistEnteredLabel("Confidence level (draft)"), value: draft.ai.confidenceLevel },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] p-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-amber-300/60">{label}</p>
                {value.trim() ? (
                  <p className="text-sm leading-6 text-white/80 whitespace-pre-wrap">{value}</p>
                ) : (
                  <EmptyFieldNote text="Not documented" />
                )}
              </div>
            ))}
          </div>
        </ReportSection>

        {/* ── Section 6: SOAP Documentation ── */}
        <ReportSection
          id="soap"
          title="SOAP Documentation"
          defaultOpen
          hideWhenEmptyPrint
          hasPrintContent={hasSoapContent(draft)}
          accent="border-white/20 bg-white/[0.08] text-white/70"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
            </svg>
          }
        >
          {serverBacked && assessmentId ? (
            <EditableSoapSection
              draft={draft}
              onChange={(soap) => setDraft({ ...draft, soap, updatedAt: new Date().toISOString() })}
              onSave={() => void handleSaveSoap()}
              saving={soapSaving}
              saveMessage={soapSaveMessage}
            />
          ) : (
            <div className="mb-5 grid gap-3 sm:grid-cols-2">
              <SoapCard label="S — Subjective: Patient-reported and clinician-entered information" value={draft.soap.subjective} />
              <SoapCard label="O — Objective: Clinician examination required" value={draft.soap.objective} />
              <SoapCard label="A — Clinical impression: Clinician to complete" value={draft.soap.assessment} />
              <SoapCard label="P — Plan: Clinician decision" value={draft.soap.plan} />
            </div>
          )}
          {!hasSoapContent(draft) && (
            <p className="text-sm text-white/30 italic">Requires clinician completion.</p>
          )}
        </ReportSection>

        <AssessmentFocusContextSection
          assessmentType="general_msk"
          structuredData={buildGeneralMskPayload(
            draft,
            patientAnsweredInArabic ? "ar" : undefined,
          )}
        />

        <ProgramDirectionForReviewSection
          assessmentType="general_msk"
          structuredData={buildGeneralMskPayload(
            draft,
            patientAnsweredInArabic ? "ar" : undefined,
          )}
          patientId={patientId}
        />

        <ProgramRecommendationSection
          draft={draft}
          patientId={patientId}
          existingPlan={existingPlan}
        />

        {/* ── Section 8: Assign Treatment Plan ── */}
        <AssignPlanSection patientId={patientId} existingPlan={existingPlan} />

        {!cvMetricsLoading ? (
          <CvCapturesClinicalSection
            metrics={cvMetricsForReport}
            exerciseNameById={cvExerciseNameById}
          />
        ) : null}

        <ReportNextStepsFooter patientId={patientId} existingPlan={existingPlan} />

        <div className="pb-8 print:block">
          <div className="print-only mb-4">
            <CvCapturesClinicalSection
              metrics={cvMetricsForReport}
              exerciseNameById={cvExerciseNameById}
              variant="print"
            />
          </div>
          <ClinicalDisclaimerBlock className="print:border-gray-300 print:bg-gray-50" />
          <p className="mt-3 text-center text-[10px] text-white/25 print:text-gray-500">
            {serverBacked ? "Server-backed assessment" : "Local draft (not yet finalized)"} · {formatDate(displayDate)} · Patient #{patientId}
          </p>
        </div>
      </div>
    </main>
  );
}
