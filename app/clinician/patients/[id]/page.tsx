"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams, notFound } from "next/navigation";
import type { AssessmentRecord } from "../../../lib/domain-types";
import {
  getPatientAssessments,
  type AssessmentOut,
} from "../../../lib/api";
import type { SavedAssessment } from "../../../lib/mock-clinical-data";
import type { AssessmentListRow, AssessmentRow } from "../../../api/assessments/route";
import { pickPreferredAssessment } from "../../../lib/assessment-snapshot";
import { RemoteUpperLimbBatteryResultsCard } from "../../../components/clinician/RemoteUpperLimbBatteryResultsCard";
import { buildRemoteUpperLimbBatteryClinicianSummaryFromStructuredData } from "../../../lib/remote-upper-limb-battery/battery-clinician-summary";
import {
  FOCUS_AREA_LABEL,
  FOCUS_CATEGORY_LABEL,
  FOCUS_DIRECTION_LABEL,
  FOCUS_DIRECTION_VALUE,
  FOCUS_PROFILE_DISCLAIMER,
  FOCUS_SECTION_TITLE,
} from "../../../lib/clinical-focus-copy";
import { deriveClinicalFocusLabels } from "../../../lib/clinical-focus-labels";
import {
  PROGRAM_DIRECTION_CTA,
  PROGRAM_DIRECTION_FOOTER,
  PROGRAM_DIRECTION_PROFILE_INTRO,
  PROGRAM_DIRECTION_PROFILE_TITLE,
  PROGRAM_DIRECTION_NO_OPTIONS,
  PROGRAM_DIRECTION_RED_FLAG,
} from "../../../lib/program-direction-copy";
import { resolveProgramOptionsForFocus } from "../../../lib/program-direction-options";
import {
  extractGeneralDraft,
  extractStructuredData,
  getAssessmentLanguage,
} from "../../../lib/assessment-payload";
import {
  ARABIC_READABILITY_NOTICE,
  isArabicAssessmentContent,
  valueTextDirection,
} from "../../../lib/arabic-readability";
import type { PatientRow } from "../../../lib/validate-patient-ownership";
import { assessmentsRepository } from "../../../lib/repositories";
import ConfirmModal from "../../../components/ConfirmModal";
import {
  DEFAULT_THERAPY_PHASE,
  DEFAULT_THERAPY_PROGRAM_ID,
  DEFAULT_THERAPY_SESSION_TYPE,
  type TherapySessionLog,
} from "../../../lib/therapy-sessions-store";
import { loadTherapySessionsForDisplay } from "../../../lib/therapy-session-persistence";
import {
  type TreatmentPlan,
  type Adherence,
  type PlanSession,
} from "../../../lib/api/treatment-plans";
import type { PlanRow } from "../../../api/plans/route";
import {
  listPatientAssessments,
  ASSESSMENT_TYPE_LABELS,
  PATIENT_SECTION_LABELS,
  daysUntilExpiry,
  type RemoteAssessmentRequest,
} from "../../../lib/api/remote-assessments";
import { SendAssessmentModal } from "./SendAssessmentModal";
import { SessionScheduleView } from "../../../components/SessionScheduleView";
import { ClinicalActionCard } from "../../../components/clinician/ClinicalActionCard";
import { PatientJourneyTimeline } from "../../../components/clinician/PatientJourneyTimeline";
import { CvPatientCvMetricsSection } from "../../../components/clinician/cv/CvPatientCvMetricsSection";
import { AiClinicianSummaryCard } from "../../../components/clinician/AiClinicianSummaryCard";
import { XrSessionRecommendationsCard } from "@/app/components/clinician/XrSessionRecommendationsCard";
import { getCvReadyExercises } from "@/app/lib/cv/cv-ready-exercises";
import { GAIT_ASSESSMENT_EXERCISE_DISPLAY_NAMES } from "@/app/lib/cv/gait-assessment-exercise-ids";
import { indexCvMetricsByPlanSessionId } from "@/app/lib/cv/clinician-session-camera-status";
import { useCvSessionMetrics } from "@/app/hooks/useCvSessionMetrics";
import { PatientAdherenceSummary } from "../../../components/clinician/PatientAdherenceSummary";
import {
  formatLastSessionCompletedLine,
  formatSessionsCompletedLine,
  OPERATIONAL_STATUS_ONLY,
} from "@/app/lib/clinician/adherence-display";
import type { PatientProgressSummary, PatientTimelineBundle } from "../../../api/clinician/patient-progress/route";
import { buildPatientTimeline } from "../../../lib/clinician/patient-timeline";
import {
  buildRemoteQuestionnaireSummary,
  type RemoteQuestionnaireSummary,
} from "../../../lib/remote-questionnaire-summary";
import { PatientClinicalTranslationDisplay } from "@/app/components/reports/PatientClinicalTranslationDisplay";
import { isStrokeClinicianData } from "@/app/components/clinician/StrokeQuestionnaireClinicianPanel";
import { displayPatientFileHeader } from "../../../lib/patient-file-number";
import { resolveCurrentAndPreviousPlans } from "../../../lib/clinician/resolve-current-plan";
import { PreviousPlansSummary } from "../../../components/clinician/PreviousPlansSummary";
import { DemoOfflineBanner } from "@/app/components/clinician/DemoOfflineBanner";
import { extractDemoMeta } from "@/app/lib/api/demo-fallback-client";
import {
  parseNumericDemoPatientId,
} from "@/app/lib/api/patient-id-utils";

export default function PatientProfilePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = String(params.id || "");
  // Pure numeric route ids only — UUID Supabase patients skip legacy FastAPI assessment fetch.
  const legacyNumericPatientId = parseNumericDemoPatientId(id);

  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [assessments, setAssessments] = useState<AssessmentRecord[]>([]);
  const [backendAssessmentHistory, setBackendAssessmentHistory] = useState<AssessmentOut[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "success" | "error">("idle");

  // Edit state
  const [editOpen, setEditOpen] = useState(searchParams.get("edit") === "1");
  const [editForm, setEditForm] = useState<Partial<PatientRow>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Delete state
  const [deleting, setDeleting] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [therapySessions, setTherapySessions] = useState<TherapySessionLog[]>([]);
  const [therapyLoading, setTherapyLoading] = useState(false);

  // Treatment plan state
  const [treatmentPlan, setTreatmentPlan] = useState<TreatmentPlan | null>(null);
  const [adherence, setAdherence] = useState<Adherence | null>(null);
  const [planProgress, setPlanProgress] = useState<PatientProgressSummary | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [patientPlanRows, setPatientPlanRows] = useState<PlanRow[]>([]);
  const [previousPlanRows, setPreviousPlanRows] = useState<PlanRow[]>([]);
  const [timelineBundle, setTimelineBundle] = useState<PatientTimelineBundle | null>(null);
  const { metrics: patientCvMetrics, demoMode: cvDemoMode, demoNotice: cvDemoNotice } = useCvSessionMetrics({
    patientId: patient?.id,
    limit: 30,
    dedupePatientSessions: false,
  });

  // Remote assessment state
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [remoteAssessments, setRemoteAssessments] = useState<RemoteAssessmentRequest[]>([]);

  // RASQ new-style assessments (from rasq_assessments localStorage)
  const [rasqAssessments, setRasqAssessments] = useState<SavedAssessment[]>([]);
  const [supabaseAssessmentRows, setSupabaseAssessmentRows] = useState<AssessmentListRow[]>([]);
  const [clinicalSummaryDetail, setClinicalSummaryDetail] = useState<AssessmentRow | null>(null);
  const [ulmsBatteryDetail, setUlmsBatteryDetail] = useState<AssessmentRow | null>(null);

  // Assessment-saved banner (shown when redirected from /clinician/assessment/new)
  const [showAssessmentBanner, setShowAssessmentBanner] = useState(
    searchParams.get("assessmentSaved") === "true"
  );

  // Plan-assigned banner (shown when redirected from /clinician/plans/new)
  const [showPlanAssignedBanner, setShowPlanAssignedBanner] = useState(
    searchParams.get("planAssigned") === "1"
  );
  const [demoMode, setDemoMode] = useState(false);
  const [demoNotice, setDemoNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!id) { setIsLoading(false); return; }
    let isMounted = true;

    async function load() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/patients/${id}`);
        if (res.status === 404) { notFound(); return; }
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `Failed to load patient (${res.status})`);
        }
        const p = (await res.json()) as PatientRow & { demoMode?: boolean; demoNotice?: string };
        if (!isMounted) return;
        const meta = extractDemoMeta(p);
        setDemoMode(meta.demoMode);
        setDemoNotice(meta.demoNotice);
        setPatient(p);
        setEditForm(p);
      } catch (err) {
        if (!isMounted) return;
        console.error("[PatientProfilePage] load error:", err);
        setPatient(null);
        setIsLoading(false);
        return;
      }

      // Local assessment archive (browser-stored)
      const localAssessments = assessmentsRepository.listByPatientId(id);
      if (isMounted) setAssessments(localAssessments);

      // Backend assessment history (FastAPI — numeric legacy ids only; Supabase uses /api/assessments)
      if (legacyNumericPatientId != null) {
        try {
          const history = await getPatientAssessments(legacyNumericPatientId);
          if (isMounted) setBackendAssessmentHistory(history);
        } catch { /* ignore — FastAPI may be offline */ }
      }

      if (isMounted) setIsLoading(false);
    }
    load();
    return () => { isMounted = false; };
  }, [id, legacyNumericPatientId]);

  useEffect(() => {
    if (!patient) return;
    const pid = String(patient.id);
    const refresh = () => {
      setTherapyLoading(true);
      void loadTherapySessionsForDisplay(pid)
        .then(setTherapySessions)
        .finally(() => setTherapyLoading(false));
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("cm-therapy-saved", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("cm-therapy-saved", refresh);
    };
  }, [patient]);

  useEffect(() => {
    if (!patient) return;
    const planAssigned = searchParams.get("planAssigned") === "1";
    setPlanLoading(true);
    fetch(`/api/plans?patientId=${patient.id}`)
      .then(async (res) => {
        if (!res.ok) return;
        const plans = (await res.json()) as PlanRow[];
        setPatientPlanRows(plans);
        const { currentPlan, previousPlans } = resolveCurrentAndPreviousPlans(plans);
        setPreviousPlanRows(previousPlans);
        if (currentPlan) {
          const p = currentPlan;
          const sd = p.structured_data;
          const mapped: TreatmentPlan = {
            id:              p.id,
            patientId:       0,
            patientToken:    p.patient_token ?? undefined,
            programId:       sd?.programId ?? "custom",
            programName:     sd?.programName ?? p.title ?? "Treatment Plan",
            phase:           sd?.phase ?? "phase-1",
            phaseName:       sd?.phaseName ?? "Phase 1",
            phaseGoal:       sd?.phaseGoal ?? "",
            sessionsPerWeek: sd?.sessionsPerWeek ?? 3,
            totalSessions:   p.sessions?.length ?? 0,
            clinicianNotes:  p.clinician_note ?? "",
            assignedAt:      p.created_at,
            assignedBy:      sd?.assignedBy ?? "Clinician",
            status:          p.status as TreatmentPlan["status"],
            sessions:        (p.sessions ?? []).map((s, i) => ({
              id:              s.id,
              sessionNumber:   s.session_number ?? i + 1,
              title:           s.title,
              exercises:       s.exercises ?? [],
              estimatedMinutes: 25,
              // Map DB status (upcoming/today/completed/skipped) to UI type
              status:          (s.status === "completed"
                ? "completed"
                : s.status === "today" ? "in-progress"
                : "ready") as PlanSession["status"],
              completedAt:     s.completed_at ?? undefined,
              scheduledAt:     s.scheduled_at ?? undefined,
            } satisfies PlanSession)),
          };
          setTreatmentPlan(mapped);

          const progressRes = await fetch(
            `/api/clinician/patient-progress?patientId=${encodeURIComponent(patient.id)}&planId=${encodeURIComponent(p.id)}`,
          );
          if (progressRes.ok) {
            const progress = (await progressRes.json()) as PatientProgressSummary;
            setPlanProgress(progress);
            setAdherence({
              patientId:         0,
              sessionsCompleted: progress.sessionsCompleted,
              totalSessions:     progress.totalSessions,
              adherenceRatePct:  progress.progressPct,
              lastActiveAt:      progress.lastCompletedAt,
              weeklyCompletions: [
                { week: "W1", completed: 0, target: mapped.sessionsPerWeek },
                { week: "W2", completed: 0, target: mapped.sessionsPerWeek },
                { week: "W3", completed: 0, target: mapped.sessionsPerWeek },
                { week: "W4", completed: 0, target: mapped.sessionsPerWeek },
              ],
            });
          } else {
            setPlanProgress(null);
            setAdherence({
              patientId:        0,
              sessionsCompleted: mapped.sessions.filter((s) => s.status === "completed").length,
              totalSessions:    mapped.sessions.length,
              adherenceRatePct: mapped.sessions.length > 0
                ? Math.round((mapped.sessions.filter((s) => s.status === "completed").length / mapped.sessions.length) * 100)
                : 0,
              lastActiveAt:     null,
              weeklyCompletions: [
                { week: "W1", completed: 0, target: mapped.sessionsPerWeek },
                { week: "W2", completed: 0, target: mapped.sessionsPerWeek },
                { week: "W3", completed: 0, target: mapped.sessionsPerWeek },
                { week: "W4", completed: 0, target: mapped.sessionsPerWeek },
              ],
            });
          }
        } else {
          setTreatmentPlan(null);
          setPlanProgress(null);
          setPreviousPlanRows([]);
        }
      })
      .catch(() => { /* silent — empty state shown */ })
      .finally(() => {
        setPlanLoading(false);
        if (planAssigned) {
          setShowPlanAssignedBanner(true);
          router.replace(`/clinician/patients/${id}`, { scroll: false });
        }
      });
  }, [patient, searchParams, router, id]);

  useEffect(() => {
    if (!patient) return;
    const refreshTimeline = () => {
      void fetch(`/api/clinician/patient-progress?patientId=${encodeURIComponent(patient.id)}&timelineOnly=1`)
        .then(async (res) => {
          if (!res.ok) return;
          setTimelineBundle((await res.json()) as PatientTimelineBundle);
        })
        .catch(() => {
          setTimelineBundle(null);
        });
    };
    refreshTimeline();
    window.addEventListener("focus", refreshTimeline);
    document.addEventListener("visibilitychange", refreshTimeline);
    return () => {
      window.removeEventListener("focus", refreshTimeline);
      document.removeEventListener("visibilitychange", refreshTimeline);
    };
  }, [patient?.id]);

  useEffect(() => {
    if (!patient) return;
    const refreshRemote = () => {
      void listPatientAssessments(patient.id).then(setRemoteAssessments);
    };
    refreshRemote();
    window.addEventListener("focus", refreshRemote);
    document.addEventListener("visibilitychange", refreshRemote);
    return () => {
      window.removeEventListener("focus", refreshRemote);
      document.removeEventListener("visibilitychange", refreshRemote);
    };
  }, [patient?.id]);

  const refreshClinicalAssessments = useCallback(async () => {
    if (!patient) return;
    try {
      const res = await fetch(`/api/assessments?patientId=${patient.id}`);
      if (!res.ok) return;
      const rows = (await res.json()) as AssessmentListRow[];
      setSupabaseAssessmentRows(rows);

      const mapped: SavedAssessment[] = rows.map((r) => ({
        id: r.id,
        patientId: 0,
        patientName: "",
        type: r.type,
        typeLabel:
          r.type === "remote_questionnaire"
            ? "Remote Questionnaire Assessment"
            : r.type === "general_msk"
              ? "General MSK Assessment"
              : r.type === "upper_limb_motor_screen"
                ? "Remote Upper-Limb Battery"
                : r.type,
        date: r.created_at.split("T")[0] ?? "",
        pain: 0,
        rom: 0,
        strength: "See report",
        mobilityNotes: r.notes ?? "",
        savedAt: r.created_at,
        bodyRegion: undefined,
        rehabilitationPhase: undefined,
        assessmentData: undefined,
      }));
      setRasqAssessments(mapped);

      const preferred = pickPreferredAssessment(rows);
      if (!preferred) {
        setClinicalSummaryDetail(null);
        setUlmsBatteryDetail(null);
        return;
      }

      let preferredDetail: AssessmentRow | null = null;
      const detailRes = await fetch(`/api/assessments/${encodeURIComponent(preferred.id)}`);
      if (detailRes.ok) {
        preferredDetail = (await detailRes.json()) as AssessmentRow;
        setClinicalSummaryDetail(preferredDetail);
      } else {
        setClinicalSummaryDetail(null);
      }

      const ulmsRow = rows.find((row) => row.type === "upper_limb_motor_screen");
      if (!ulmsRow) {
        setUlmsBatteryDetail(null);
        return;
      }
      if (preferred.id === ulmsRow.id) {
        setUlmsBatteryDetail(preferredDetail);
        return;
      }
      const ulmsDetailRes = await fetch(`/api/assessments/${encodeURIComponent(ulmsRow.id)}`);
      if (!ulmsDetailRes.ok) {
        setUlmsBatteryDetail(null);
        return;
      }
      setUlmsBatteryDetail((await ulmsDetailRes.json()) as AssessmentRow);
    } catch {
      /* silently ignore — empty state shown */
    }
  }, [patient?.id]);

  useEffect(() => {
    if (!patient) return;
    void refreshClinicalAssessments();
    const onRefresh = () => void refreshClinicalAssessments();
    window.addEventListener("focus", onRefresh);
    document.addEventListener("visibilitychange", onRefresh);
    return () => {
      window.removeEventListener("focus", onRefresh);
      document.removeEventListener("visibilitychange", onRefresh);
    };
  }, [patient, refreshClinicalAssessments]);

  const latestAssessment = useMemo(() => assessments[0] ?? null, [assessments]);
  const recentAssessments = useMemo(() => assessments.slice(0, 3), [assessments]);
  const latestRemoteAssessment = useMemo(
    () => assessments.find((a) => a.mode === "remote") ?? null,
    [assessments]
  );

  const therapyTrends = useMemo(() => {
    if (therapySessions.length === 0) {
      return {
        latestSteps: null as number | null,
        latestSymmetry: null as number | null,
        latestMovementQuality: null as number | null,
        bestSession: null as TherapySessionLog | null,
        count: 0,
      };
    }
    const latest = therapySessions[0];
    const latestSymmetry =
      latest.symmetryPct ?? latest.symmetry ?? null;
    const latestMq = latest.movementQuality ?? null;
    let best = therapySessions[0];
    for (const s of therapySessions) {
      if ((s.totalSteps ?? 0) > (best.totalSteps ?? 0)) best = s;
    }
    return {
      latestSteps: latest.totalSteps ?? null,
      latestSymmetry:
        typeof latestSymmetry === "number" && Number.isFinite(latestSymmetry)
          ? latestSymmetry
          : null,
      latestMovementQuality:
        typeof latestMq === "number" && Number.isFinite(latestMq) ? latestMq : null,
      bestSession: best,
      count: therapySessions.length,
    };
  }, [therapySessions]);

  const flowNextAction = useMemo(() => {
    const next = therapySessions[0]?.therapyRecommendation?.nextAction?.trim();
    if (next) return next;
    return "Not recorded";
  }, [therapySessions]);

  const clinicalSummaryRow = clinicalSummaryDetail;

  const clinicalSummary = useMemo(() => {
    if (!clinicalSummaryRow) return null;
    if (clinicalSummaryRow.type === "remote_questionnaire") {
      const strokePayload = clinicalSummaryRow.structured_data as unknown;
      if (isStrokeClinicianData(strokePayload)) {
        const source = strokePayload.responses.sc_information_source;
        return {
          title: "Remote Neurorehabilitation Intake",
          submittedAt: clinicalSummaryRow.created_at,
          metrics: [
            { label: "Safety gate", value: strokePayload.safetyState },
            {
              label: "Clinical English",
              value: strokePayload.strokeWorkflow.translation.status,
            },
          ],
          rows: [
            ...(source
              ? [
                  {
                    label: "Information source",
                    value: Array.isArray(source.rawValue)
                      ? source.rawValue.join(", ")
                      : source.rawValue,
                  },
                ]
              : []),
          ],
          hasRedFlag: strokePayload.safetyState !== "PASS",
        };
      }
      return buildRemoteQuestionnaireSummary(
        clinicalSummaryRow.structured_data,
        clinicalSummaryRow.created_at,
      );
    }
    const general = extractGeneralDraft(clinicalSummaryRow.structured_data, clinicalSummaryRow.type);
    if (general) {
      return {
        title: "General MSK Assessment",
        submittedAt: clinicalSummaryRow.created_at,
        metrics: [
          ...(general.subjective.nprs.trim()
            ? [{ label: "Pain score", value: `${general.subjective.nprs}/10` }]
            : []),
          ...(general.subjective.painLocation.trim()
            ? [{ label: "Body region", value: general.subjective.painLocation }]
            : []),
        ],
        rows: [
          ...(general.subjective.chiefComplaint.trim()
            ? [{ label: "Main complaint", value: general.subjective.chiefComplaint }]
            : []),
          ...(general.subjective.aggravating.trim()
            ? [{ label: "Aggravating factors", value: general.subjective.aggravating }]
            : []),
          ...(general.subjective.goals.trim()
            ? [{ label: "Functional goal", value: general.subjective.goals }]
            : []),
        ],
        hasRedFlag: Boolean(general.subjective.redFlags.trim()),
      };
    }
    const structured = extractStructuredData(clinicalSummaryRow.structured_data);
    if (structured) {
      return {
        title: structured.bodyRegion || "Structured Assessment",
        submittedAt: clinicalSummaryRow.created_at,
        metrics: [
          { label: "Pain at rest", value: `${structured.painAtRest}/10` },
          { label: "Pain on movement", value: `${structured.painOnMovement}/10` },
          { label: "Body region", value: structured.bodyRegion },
        ],
        rows: [
          ...(structured.clinicalNotes.trim()
            ? [{ label: "Clinical notes", value: structured.clinicalNotes }]
            : []),
          ...(structured.rehabilitationPhase
            ? [{ label: "Rehab phase", value: structured.rehabilitationPhase }]
            : []),
        ],
        hasRedFlag: false,
      };
    }
    return null;
  }, [clinicalSummaryRow]);

  const ulmsBatterySummary = useMemo(
    () =>
      buildRemoteUpperLimbBatteryClinicianSummaryFromStructuredData(
        ulmsBatteryDetail?.structured_data,
        ulmsBatteryDetail?.created_at,
      ),
    [ulmsBatteryDetail],
  );

  const remoteQuestionnaireSummary: RemoteQuestionnaireSummary | null =
    clinicalSummaryRow?.type === "remote_questionnaire" &&
    !isStrokeClinicianData(clinicalSummaryRow.structured_data as unknown) &&
    clinicalSummary
      ? (clinicalSummary as RemoteQuestionnaireSummary)
      : null;

  const clinicalFocusLabels = useMemo(() => {
    if (!clinicalSummaryRow) return null;
    if (clinicalSummaryRow.type === "upper_limb_motor_screen") return null;
    if (isStrokeClinicianData(clinicalSummaryRow.structured_data as unknown)) return null;
    return deriveClinicalFocusLabels(
      clinicalSummaryRow.type,
      clinicalSummaryRow.structured_data,
    );
  }, [clinicalSummaryRow]);

  const programDirectionOptions = useMemo(() => {
    if (!clinicalFocusLabels) return [];
    return resolveProgramOptionsForFocus(clinicalFocusLabels, {
      hasRedFlag: clinicalSummary?.hasRedFlag ?? false,
    });
  }, [clinicalFocusLabels, clinicalSummary?.hasRedFlag]);

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

  const rehabilitationTimelineEvents = useMemo(() => {
    return buildPatientTimeline({
      assessments: supabaseAssessmentRows.map((row) => ({
        id: row.id,
        created_at: row.created_at,
        type: row.type,
        status: row.status,
      })),
      plans: patientPlanRows.map((plan) => ({
        id: plan.id,
        created_at: plan.created_at,
        title: plan.title,
        planTitle: plan.title,
        programName: plan.structured_data?.programName ?? plan.title,
        structured_data: plan.structured_data,
      })),
      sessionLogs: (timelineBundle?.timelineSessionLogs ?? []).map((log) => ({
        id: log.id,
        completed_at: log.completed_at,
        pain_score: log.pain_score,
        effort_score: log.effort_score,
        session_number: log.session_number,
        notes: log.notes,
      })),
      reviewAcknowledgments: (timelineBundle?.timelineReviewAcks ?? []).map((ack) => ({
        id: ack.id,
        reviewed_at: ack.reviewed_at,
        review_note: ack.review_note,
      })),
      remoteAssessmentRequests: remoteAssessments.map((req) => ({
        id: req.id,
        createdAt: req.createdAt,
        status: req.status,
        submittedAt: req.submittedAt,
      })),
      cvCaptures: patientCvMetrics
        .filter((row) => row.source === "assessment_movement" || row.source === "patient_session")
        .map((row) => ({
          id: row.id,
          recordedAt: row.recordedAt,
          exerciseId: row.exerciseId,
          exerciseLabel: cvExerciseNameById[row.exerciseId] ?? row.exerciseId,
          sessionDurationS: row.sessionDurationS,
          source: row.source,
        })),
    });
  }, [supabaseAssessmentRows, patientPlanRows, timelineBundle, remoteAssessments, patientCvMetrics, cvExerciseNameById]);

  const clinicalSummaryArabicNotice = useMemo(() => {
    if (!clinicalSummary || !clinicalSummaryRow) return false;
    const values = [
      ...clinicalSummary.metrics.map((metric) => metric.value),
      ...clinicalSummary.rows.map((row) => row.value),
    ];
    return isArabicAssessmentContent(
      getAssessmentLanguage(clinicalSummaryRow.structured_data),
      values,
    );
  }, [clinicalSummary, clinicalSummaryRow]);

  function handleCreateRemoteRequest() {
    if (!patient) return;
    const assessmentId = assessmentsRepository.newAssessmentId();
    assessmentsRepository.create({
      id: assessmentId,
      patientId: String(patient.id),
      mode: "remote",
      selectedTests: [],
      bodyRegion: "Full Body",
      side: "Not Applicable",
      visitType: "Follow-Up",
      sessionLabel: "Remote Assessment Request",
      createdAt: new Date().toISOString(),
    });
    router.push(`/clinician/request?patientId=${patient.id}&assessmentId=${assessmentId}`);
  }

  async function handleCopyLatestLink() {
    if (!latestRemoteAssessment || !patient) { alert("No remote assessment link available"); return; }
    const link = `${window.location.origin}/assessment?patientId=${patient.id}&assessmentId=${latestRemoteAssessment.id}`;
    try { await navigator.clipboard.writeText(link); setCopyFeedback("success"); }
    catch { setCopyFeedback("error"); }
  }

  useEffect(() => {
    if (copyFeedback === "idle") return;
    const t = window.setTimeout(() => setCopyFeedback("idle"), 2500);
    return () => window.clearTimeout(t);
  }, [copyFeedback]);

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!patient) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch(`/api/patients/${patient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: editForm.full_name?.trim(),
          phone: editForm.phone?.trim(),
          age: editForm.age ?? null,
          gender: editForm.gender ?? null,
          sport: editForm.sport ?? null,
          diagnosis: editForm.diagnosis?.trim(),
          status: editForm.status,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Failed to save (${res.status})`);
      }
      const updated = (await res.json()) as PatientRow;
      setPatient(updated);
      setEditOpen(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!patient) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/patients/${patient.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Delete failed (${res.status})`);
      }
      router.push("/clinician/patients");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete patient.");
      setDeleting(false);
      setDeleteModalOpen(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0B1220]">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-[#1E2D42] border-t-[#1D9E75]" />
          <p className="text-sm text-white/35">Loading patient record…</p>
        </div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0B1220] text-white">
        <div className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-8 text-center max-w-sm">
          <p className="text-base font-bold text-white">Patient not found</p>
          <p className="mt-2 text-sm text-white/40">No record exists for this ID, or the backend is unavailable.</p>
          <Link
            href="/clinician/patients"
            className="mt-5 inline-block rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-5 py-2.5 text-sm font-semibold text-white/60 transition hover:text-white"
          >
            ← Back to Patients
          </Link>
        </div>
      </div>
    );
  }

  const submittedRemote = remoteAssessments.filter((r) => r.status === "submitted");
  const pendingRemote   = remoteAssessments.filter((r) => r.status === "pending" || r.status === "in_progress");
  const clinicalSummaryAssessmentId =
    clinicalSummaryRow && clinicalSummaryRow.type !== "upper_limb_motor_screen"
      ? clinicalSummaryRow.id
      : null;
  const primaryReportHref = clinicalSummaryAssessmentId
    ? `/clinician/assessment/report?patientId=${patient.id}&assessmentId=${clinicalSummaryAssessmentId}`
    : `/clinician/assessment/report?patientId=${patient.id}`;
  const overviewLatestAssessment = clinicalSummary
    ? `${clinicalSummary.title} · ${new Date(clinicalSummary.submittedAt).toLocaleDateString()}`
    : ulmsBatterySummary
      ? `${ulmsBatterySummary.title} · ${new Date(ulmsBatterySummary.submittedAt).toLocaleDateString()}`
      : "—";
  const overviewCurrentPlan = treatmentPlan?.programName ?? "—";
  const overviewProgressSnapshot = planProgress
    ? `${planProgress.sessionsCompleted}/${planProgress.totalSessions} sessions · ${planProgress.progressPct}%`
    : adherence
      ? `${adherence.sessionsCompleted}/${adherence.totalSessions} sessions · ${adherence.adherenceRatePct}%`
      : "—";
  const adherenceSessionsCompleted =
    planProgress?.sessionsCompleted ?? adherence?.sessionsCompleted ?? 0;
  const adherenceTotalSessions =
    planProgress?.totalSessions ?? adherence?.totalSessions ?? 0;
  const adherenceLastSessionAt =
    planProgress?.lastCompletedAt ?? adherence?.lastActiveAt ?? null;
  const adherenceSessionsLine = formatSessionsCompletedLine(
    adherenceSessionsCompleted,
    adherenceTotalSessions,
  );
  const adherenceLastSessionLine = treatmentPlan
    ? formatLastSessionCompletedLine(adherenceLastSessionAt)
    : null;
  const showAdherenceQuickSummary =
    Boolean(treatmentPlan) && adherenceTotalSessions > 0;
  const hasAnyAssessment =
    supabaseAssessmentRows.length > 0 || submittedRemote.length > 0 || backendAssessmentHistory.length > 0;

  return (
    <>
    <ConfirmModal
      open={deleteModalOpen}
      title="Delete Patient"
      message={`"${patient?.full_name}" will be permanently removed along with all associated records. This cannot be undone.`}
      confirmLabel="Yes, Delete"
      loading={deleting}
      onConfirm={handleConfirmDelete}
      onCancel={() => setDeleteModalOpen(false)}
    />

    {/* Send Assessment Modal */}
    {sendModalOpen && (
      <SendAssessmentModal
        patientId={patient.id}
        patientName={patient.full_name}
        onClose={() => setSendModalOpen(false)}
        onCreated={() => {
          void listPatientAssessments(patient.id).then(setRemoteAssessments);
          void refreshClinicalAssessments();
        }}
      />
    )}

    <main className="min-h-screen bg-[#0B1220] px-6 py-8 text-white">
      <div className="mx-auto max-w-7xl">
        <DemoOfflineBanner
          visible={demoMode || cvDemoMode}
          notice={demoNotice ?? cvDemoNotice}
        />
        {/* Header */}
        <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/clinician/patients" className="flex items-center gap-1.5 text-sm text-white/35 transition hover:text-white/65 mb-3">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              Patients
            </Link>
            <h1 className="mt-1.5 text-2xl font-bold text-white">{patient.full_name}</h1>
            <p className="mt-1 text-xs font-semibold text-white/45">
              {displayPatientFileHeader(patient.file_number, patient.id)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {patient.phone && (
                <>
                  <span className="text-xs text-white/35">{patient.phone}</span>
                  <span className="text-xs text-white/20">·</span>
                </>
              )}
              <span className="text-xs text-white/35">{patient.diagnosis || "No primary complaint recorded"}</span>
              <span className="text-xs text-white/20">·</span>
              <span className={`text-xs font-semibold ${patient.status?.toLowerCase() === "active" ? "text-[#5DCAA5]" : "text-amber-300"}`}>
                {patient.status}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <a href="#clinical-assessment-summary" className="rounded-[5px] border border-[#1E2D42] bg-[#0B1220] px-2.5 py-1 font-semibold text-white/45 transition hover:border-[#1D9E75]/25 hover:text-[#5DCAA5]">
                Assessment
              </a>
              <a href="#rehabilitation-plan" className="rounded-[5px] border border-[#1E2D42] bg-[#0B1220] px-2.5 py-1 font-semibold text-white/45 transition hover:border-[#1D9E75]/25 hover:text-[#5DCAA5]">
                Treatment plan
              </a>
              <a href="#progress-snapshot" className="rounded-[5px] border border-[#1E2D42] bg-[#0B1220] px-2.5 py-1 font-semibold text-white/45 transition hover:border-[#1D9E75]/25 hover:text-[#5DCAA5]">
                Progress
              </a>
              <Link href={`/clinician/patients/${patient.id}/outcomes`} className="rounded-[5px] border border-[#1E2D42] bg-[#0B1220] px-2.5 py-1 font-semibold text-white/45 transition hover:border-[#1D9E75]/25 hover:text-[#5DCAA5]">
                Outcomes
              </Link>
              <a href="#movement-tracking-sessions" className="rounded-[5px] border border-[#1E2D42] bg-[#0B1220] px-2.5 py-1 font-semibold text-white/45 transition hover:border-[#1D9E75]/25 hover:text-[#5DCAA5]">
                Movement tracking
              </a>
              <Link href="/clinician/results" className="rounded-[5px] border border-[#1E2D42] bg-[#0B1220] px-2.5 py-1 font-semibold text-white/45 transition hover:border-[#1D9E75]/25 hover:text-[#5DCAA5]">
                Results
              </Link>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/clinician/assessment/new?patientId=${patient.id}`}
              className="rounded-[7px] bg-[#1D9E75] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#179165]"
            >
              + New Assessment
            </Link>
            <button
              type="button"
              onClick={() => { setEditForm(patient); setEditOpen((o) => !o); setSaveError(""); }}
              className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-4 py-2.5 text-sm font-semibold text-white/60 transition hover:border-[#1D9E75]/25 hover:text-white"
            >
              {editOpen ? "Cancel" : "Edit Patient"}
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => setDeleteModalOpen(true)}
              className="rounded-[7px] border border-rose-400/20 bg-[#0F1825] px-4 py-2.5 text-sm font-semibold text-rose-400/60 transition hover:border-rose-400/40 hover:text-rose-300 disabled:opacity-40"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>

        {/* ── Pending remote assessment reminder ── */}
        {pendingRemote.length > 0 && submittedRemote.length === 0 && (
          <div className="mb-6 flex items-center gap-4 rounded-[10px] border border-amber-400/20 bg-amber-400/[0.05] px-5 py-3">
            <svg className="h-4 w-4 shrink-0 text-amber-400/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="flex-1 text-xs text-amber-200/80">
              {pendingRemote.length} remote assessment link{pendingRemote.length > 1 ? "s" : ""} awaiting patient completion.
            </p>
          </div>
        )}

        {/* Edit Form */}
        {editOpen && (
          <section className="mb-6 rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6">
            <h2 className="text-base font-bold text-white">Edit Patient</h2>
            <p className="mt-1 text-sm text-white/40">Changes are saved to the database.</p>
            <form onSubmit={handleSaveEdit} className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Full Name" required>
                <input
                  value={editForm.full_name ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))}
                  className={inputCls}
                  required
                />
              </Field>
              <Field label="Phone">
                <input
                  value={editForm.phone ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  className={inputCls}
                />
              </Field>
              <Field label="Age">
                <input
                  type="number"
                  min={0}
                  max={150}
                  value={editForm.age ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, age: e.target.value ? Number(e.target.value) : null }))}
                  className={inputCls}
                />
              </Field>
              <Field label="Gender">
                <select
                  value={editForm.gender ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, gender: e.target.value || null }))}
                  className={inputCls}
                >
                  <option value="">Not specified</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              <Field label="Sport / Activity">
                <input
                  value={editForm.sport ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, sport: e.target.value || null }))}
                  className={inputCls}
                />
              </Field>
              <Field label="Diagnosis / Primary Complaint">
                <input
                  value={editForm.diagnosis ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, diagnosis: e.target.value }))}
                  className={inputCls}
                />
              </Field>
              <Field label="Status">
                <select
                  value={editForm.status ?? "Active"}
                  onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                  className={inputCls}
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                  <option value="Discharged">Discharged</option>
                  <option value="On Hold">On Hold</option>
                </select>
              </Field>
              <div className="col-span-full flex flex-wrap items-center gap-3 pt-2">
                {saveError && <p className="text-sm text-rose-300">{saveError}</p>}
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-[7px] bg-[#1D9E75] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#179165] disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save Changes"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-4 py-2.5 text-sm font-semibold text-white/50 transition hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="grid gap-6 xl:grid-cols-[1.35fr_0.85fr]">
          <div className="space-y-6">
            {/* Clinical Overview */}
            <section className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6">
              <h2 className="text-lg font-bold text-white">Clinical Overview</h2>
              <p className="mt-1 mb-5 text-xs text-white/35">Quick read on where this patient is in rehab.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoCard label="Clinical Status" value={patient.status} />
                <InfoCard label="Latest Assessment" value={overviewLatestAssessment} />
                <InfoCard label="Current Plan" value={overviewCurrentPlan} />
                <InfoCard label="Progress Snapshot" value={overviewProgressSnapshot} />
              </div>
              {showAdherenceQuickSummary && adherenceSessionsLine && adherenceLastSessionLine && (
                <div className="mt-4 rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">
                    Session activity
                  </p>
                  <p className="mt-2 text-sm text-white/75">{adherenceSessionsLine}</p>
                  <p className="mt-1 text-sm text-white/60">{adherenceLastSessionLine}</p>
                  <p className="mt-2 text-[10px] italic text-white/30">{OPERATIONAL_STATUS_ONLY}</p>
                </div>
              )}
            </section>

            {/* Quick actions */}
            <section className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-5">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-white/25">
                Quick actions
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/clinician/plans/new?patientId=${patient.id}`}
                  className="rounded-[7px] border border-[#1D9E75]/25 bg-[#1D9E75]/8 px-3.5 py-2 text-xs font-semibold text-[#5DCAA5] transition hover:bg-[#1D9E75]/14"
                >
                  Create structured treatment plan
                </Link>
                <Link
                  href="/clinician/results"
                  className="rounded-[7px] border border-[#1D9E75]/25 bg-[#1D9E75]/8 px-3.5 py-2 text-xs font-semibold text-[#5DCAA5] transition hover:bg-[#1D9E75]/14"
                >
                  View Results
                </Link>
                <button
                  type="button"
                  onClick={() => setSendModalOpen(true)}
                  className="flex items-center gap-1.5 rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3.5 py-2 text-xs font-semibold text-white/50 transition hover:border-[#1D9E75]/20 hover:text-white"
                >
                  Send Remote Assessment
                </button>
                <button
                  type="button"
                  onClick={handleCopyLatestLink}
                  disabled={!latestRemoteAssessment}
                  className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3.5 py-2 text-xs font-semibold text-white/50 transition hover:border-[#1D9E75]/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Copy assessment link
                </button>
                <Link
                  href={`/therapy?patientId=${patient.id}`}
                  className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3.5 py-2 text-xs font-semibold text-white/50 transition hover:border-[#1D9E75]/20 hover:text-white"
                >
                  Therapy session
                </Link>
              </div>
              {copyFeedback === "success" && (
                <p className="mt-2.5 text-xs text-[#5DCAA5]">Assessment link copied to clipboard.</p>
              )}
              {copyFeedback === "error" && (
                <p className="mt-2.5 text-xs text-rose-300">Could not copy link.</p>
              )}
            </section>

            {/* Assessment saved banner */}
            {showAssessmentBanner && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#1D9E75]/30 bg-[#1D9E75]/8 px-4 py-3">
                <p className="text-sm text-[#5DCAA5]">Assessment saved successfully.</p>
                <div className="flex items-center gap-2">
                  {clinicalSummaryAssessmentId && (
                    <Link
                      href={primaryReportHref}
                      className="rounded-[6px] border border-[#1D9E75]/25 bg-[#1D9E75]/10 px-3 py-1.5 text-xs font-semibold text-[#5DCAA5] transition hover:bg-[#1D9E75]/15"
                    >
                      Review assessment report →
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowAssessmentBanner(false)}
                    className="shrink-0 text-xs text-white/25 transition hover:text-white/60"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* Plan assigned banner */}
            {showPlanAssignedBanner && (
              <div className="flex items-start justify-between gap-3 rounded-[8px] border border-[#1D9E75]/30 bg-[#1D9E75]/8 px-4 py-3">
                <p className="text-sm text-[#5DCAA5]">Treatment plan assigned successfully.</p>
                <button
                  type="button"
                  onClick={() => setShowPlanAssignedBanner(false)}
                  className="mt-0.5 shrink-0 text-xs text-white/25 transition hover:text-white/60"
                >
                  ✕
                </button>
              </div>
            )}

            {ulmsBatterySummary && ulmsBatteryDetail ? (
              <RemoteUpperLimbBatteryResultsCard
                summary={ulmsBatterySummary}
                reportHref={`/clinician/assessment/report?patientId=${encodeURIComponent(patient.id)}&assessmentId=${encodeURIComponent(ulmsBatteryDetail.id)}`}
              />
            ) : null}

            {/* Clinical Assessment Summary */}
            <section id="clinical-assessment-summary" className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6 scroll-mt-6">
              <h2 className="text-lg font-bold text-white">Clinical Assessment Summary</h2>
              <p className="mt-1 mb-5 text-xs text-white/35">
                Remote and in-clinic assessments appear here. Session progress and review flags are on Results.
              </p>

              {clinicalSummary ? (
                <div className="space-y-5">
                  <div className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{clinicalSummary.title}</p>
                        <p className="mt-1 text-xs text-white/45">
                          Submitted {new Date(clinicalSummary.submittedAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {clinicalSummaryDetail?.type === "remote_questionnaire" && (
                          <span className="rounded-[5px] border border-[#1E2D42] bg-[#0F1825] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/45">
                            Remote
                          </span>
                        )}
                        <span className="rounded-[5px] border border-lime-300/20 bg-lime-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-lime-300">
                          Submitted
                        </span>
                      </div>
                    </div>

                    {clinicalSummary.hasRedFlag && (
                      <div className="mt-4 rounded-[7px] border border-amber-300/25 bg-amber-400/10 px-3 py-2.5">
                        <p className="text-xs font-semibold text-amber-200">
                          Patient reported a possible red flag — review before proceeding.
                        </p>
                      </div>
                    )}

                    {clinicalSummaryArabicNotice && (
                      <div className="mt-4 rounded-[7px] border border-amber-300/25 bg-amber-400/10 px-3 py-2.5">
                        <p className="text-xs leading-relaxed text-amber-100/90">
                          {ARABIC_READABILITY_NOTICE}
                        </p>
                      </div>
                    )}

                    {clinicalFocusLabels && (
                      <div className="mt-4 rounded-[8px] border border-cyan-400/20 bg-cyan-400/5 px-4 py-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-300/80">
                          {FOCUS_SECTION_TITLE}
                        </p>
                        <p className="mt-2 text-xs leading-relaxed text-white/45">
                          {FOCUS_PROFILE_DISCLAIMER}
                        </p>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <div className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2.5">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">
                              {FOCUS_AREA_LABEL}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-white">
                              {clinicalFocusLabels.focusArea}
                            </p>
                          </div>
                          <div className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2.5">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">
                              {FOCUS_CATEGORY_LABEL}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-white">
                              {clinicalFocusLabels.clinicalCategory}
                            </p>
                          </div>
                          <div className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2.5">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">
                              {FOCUS_DIRECTION_LABEL}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-white">
                              {FOCUS_DIRECTION_VALUE}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {clinicalFocusLabels && (
                      <div className="mt-4 rounded-[8px] border border-violet-400/20 bg-violet-400/5 px-4 py-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-violet-300/80">
                          {PROGRAM_DIRECTION_PROFILE_TITLE}
                        </p>
                        <p className="mt-2 text-xs leading-relaxed text-white/45">
                          {PROGRAM_DIRECTION_PROFILE_INTRO}
                        </p>
                        {clinicalSummary?.hasRedFlag && (
                          <p className="mt-3 text-xs leading-relaxed text-amber-200/90">
                            {PROGRAM_DIRECTION_RED_FLAG}
                          </p>
                        )}
                        {programDirectionOptions.length === 0 ? (
                          <p className="mt-3 text-sm leading-relaxed text-white/50">
                            {PROGRAM_DIRECTION_NO_OPTIONS}
                          </p>
                        ) : (
                          <ul className="mt-3 space-y-2">
                            {programDirectionOptions.map((option) => (
                              <li
                                key={option.templateId}
                                className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2.5"
                              >
                                <p className="text-sm font-semibold text-white">{option.title}</p>
                                <p className="mt-0.5 text-[11px] text-white/40">
                                  {option.conditionArea} · {option.level}
                                </p>
                              </li>
                            ))}
                          </ul>
                        )}
                        <Link
                          href={`/clinician/plans/new?patientId=${encodeURIComponent(patient.id)}`}
                          className="mt-3 inline-flex text-xs font-semibold text-violet-300 transition hover:text-violet-200"
                        >
                          {PROGRAM_DIRECTION_CTA} →
                        </Link>
                        <p className="mt-3 text-[11px] leading-relaxed text-white/35">
                          {PROGRAM_DIRECTION_FOOTER}
                        </p>
                      </div>
                    )}

                    {remoteQuestionnaireSummary?.clinicalTranslationWarning ? (
                      <div className="mt-4 rounded-[7px] border border-amber-300/25 bg-amber-400/10 px-3 py-2.5">
                        <p className="text-xs leading-relaxed text-amber-100/90">
                          {remoteQuestionnaireSummary.clinicalTranslationWarning}
                        </p>
                      </div>
                    ) : null}

                    {clinicalSummary.metrics.length > 0 && (
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        {clinicalSummary.metrics.map((metric) => {
                          const bilingualMetric =
                            remoteQuestionnaireSummary?.metrics.find(
                              (candidate) => candidate.label === metric.label,
                            ) ?? null;
                          return (
                          <div
                            key={metric.label}
                            className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2.5"
                          >
                            <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">
                              {metric.label}
                            </p>
                            {bilingualMetric?.originalValue &&
                            bilingualMetric.originalValue !== bilingualMetric.value ? (
                              <div className="mt-1">
                                <PatientClinicalTranslationDisplay
                                  originalText={bilingualMetric.originalValue}
                                  clinicalEnglish={
                                    bilingualMetric.clinicalEnglish ?? bilingualMetric.value
                                  }
                                  variant="screen"
                                />
                              </div>
                            ) : (
                              <p
                                dir={valueTextDirection(metric.value)}
                                className="mt-1 text-sm font-semibold text-white"
                              >
                                {metric.value}
                              </p>
                            )}
                            {bilingualMetric?.translationMissing ? (
                              <p className="mt-2 text-[10px] italic text-amber-200/90">
                                Clinical English translation unavailable — therapist review required.
                              </p>
                            ) : null}
                          </div>
                          );
                        })}
                      </div>
                    )}

                    {clinicalSummary.rows.length > 0 && (
                      <dl className="mt-4 divide-y divide-[#1E2D42] rounded-[7px] border border-[#1E2D42]">
                        {clinicalSummary.rows.map((row) => {
                          const bilingualRow =
                            remoteQuestionnaireSummary?.rows.find(
                              (candidate) => candidate.label === row.label,
                            ) ?? null;
                          return (
                          <div key={row.label} className="px-3 py-2.5">
                            <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                              {row.label}
                            </dt>
                            <dd className="mt-0.5">
                              {bilingualRow?.originalValue &&
                              bilingualRow.originalValue !== bilingualRow.value ? (
                                <PatientClinicalTranslationDisplay
                                  originalText={bilingualRow.originalValue}
                                  clinicalEnglish={bilingualRow.clinicalEnglish ?? bilingualRow.value}
                                  variant="screen"
                                />
                              ) : (
                                <p
                                  dir={valueTextDirection(row.value)}
                                  className="text-sm leading-relaxed text-white/80 whitespace-pre-wrap"
                                >
                                  {row.value}
                                </p>
                              )}
                              {bilingualRow?.translationMissing ? (
                                <p className="mt-2 text-[10px] italic text-amber-200/90">
                                  Clinical English translation unavailable — therapist review required.
                                </p>
                              ) : null}
                            </dd>
                          </div>
                          );
                        })}
                      </dl>
                    )}

                  </div>

                  {clinicalSummaryAssessmentId && (
                    <Link
                      href={primaryReportHref}
                      className="inline-flex rounded-[7px] border border-[#1D9E75]/25 bg-[#1D9E75]/10 px-4 py-2.5 text-xs font-semibold text-[#5DCAA5] transition hover:bg-[#1D9E75]/15"
                    >
                      Review assessment report →
                    </Link>
                  )}

                </div>
              ) : ulmsBatterySummary ? (
                <div className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-4 py-4">
                  <p className="text-sm leading-relaxed text-white/50">
                    Remote Upper-Limb Battery results are shown above. Other clinical assessments will appear here when submitted.
                  </p>
                </div>
              ) : (
                <div className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-4 py-4">
                  <p className="text-sm leading-relaxed text-white/50">
                    No submitted assessment yet. Send a remote link or document an in-clinic assessment to begin.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSendModalOpen(true)}
                      className="rounded-[7px] bg-[#1D9E75] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#179165]"
                    >
                      Send remote assessment
                    </button>
                    <Link
                      href={`/clinician/assessment/new?patientId=${patient.id}`}
                      className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-3.5 py-2 text-xs font-semibold text-white/60 transition hover:text-white"
                    >
                      Document in clinic
                    </Link>
                  </div>
                </div>
              )}
            </section>

            {/* Rehabilitation Plan */}
            <TreatmentPlanSection
              patientId={patient.id}
              plan={treatmentPlan}
              loading={planLoading}
            />

            <PreviousPlansSummary plans={previousPlanRows} />

            {/* Progress Snapshot */}
            <ProgressSnapshotSection
              patientId={patient.id}
              plan={treatmentPlan}
              planProgress={planProgress}
              adherence={adherence}
              onReviewAcknowledged={(reviewedAt) => {
                setPlanProgress((prev) =>
                  prev
                    ? { ...prev, reviewAcknowledged: true, reviewedAt }
                    : prev,
                );
              }}
            />

            <AiClinicianSummaryCard
              patientId={patient.id}
              planId={planProgress?.planId ?? treatmentPlan?.id ?? null}
            />

            <XrSessionRecommendationsCard
              patientId={patient.id}
              diagnosis={patient.diagnosis}
            />

            <CvPatientCvMetricsSection patientId={patient.id} />

            {(planProgress || adherence) && treatmentPlan ? (
              <PatientAdherenceSummary
                sessionsCompleted={
                  planProgress?.sessionsCompleted ?? adherence?.sessionsCompleted ?? 0
                }
                totalSessions={planProgress?.totalSessions ?? adherence?.totalSessions ?? 0}
                lastActivityAt={
                  planProgress?.lastCompletedAt ?? adherence?.lastActiveAt ?? null
                }
              />
            ) : null}

            <PatientJourneyTimeline
              events={rehabilitationTimelineEvents}
              patientName={patient.full_name}
            />

            {/* Patient access link */}
            {treatmentPlan?.patientToken && (
              <section className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
                  Patient access
                </p>
                <div className="mt-3 flex items-center gap-3 rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3">
                  <p
                    className="flex-1 truncate text-[13px] text-[#5DCAA5]"
                    style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
                  >
                    {typeof window !== "undefined" ? window.location.origin : ""}/patient/{treatmentPlan.patientToken}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const url = `${window.location.origin}/patient/${treatmentPlan.patientToken}`;
                      navigator.clipboard.writeText(url).then(() => {
                        setCopyFeedback("success");
                        setTimeout(() => setCopyFeedback("idle"), 2000);
                      }).catch(() => setCopyFeedback("error"));
                    }}
                    className="shrink-0 rounded-[6px] border border-[#1E2D42] bg-[#0F1825] px-3 py-1.5 text-[11px] font-semibold text-white/50 transition hover:border-[#1D9E75]/30 hover:text-white"
                  >
                    {copyFeedback === "success" ? "Copied!" : "Copy"}
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-white/25">
                  Share this link with the patient. No login required.
                </p>
              </section>
            )}

            {/* Clinical Documentation */}
            <section className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6">
              <h2 className="text-lg font-bold text-white">Clinical Documentation</h2>
              <p className="mt-1 mb-6 text-xs text-white/35">SOAP notes and assessment archive.</p>

              <div className="mb-6">
                <h3 className="text-sm font-bold text-white">SOAP Documentation</h3>
                <p className="text-xs text-white/45">Structured SOAP templates will be available in a future release.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <SoapPlaceholderCard title="Subjective" />
                  <SoapPlaceholderCard title="Objective" />
                  <SoapPlaceholderCard title="Assessment" />
                  <SoapPlaceholderCard title="Plan" />
                </div>
              </div>

              {(backendAssessmentHistory.length > 0 || assessments.length > 0) && (
                <div className="space-y-5 border-t border-[#1E2D42] pt-6">
                  {backendAssessmentHistory.length > 0 && (
                    <div id="assessment-timeline">
                      <h3 className="text-sm font-bold text-white">Assessment archive</h3>
                      <div className="mt-3 space-y-3">
                        {backendAssessmentHistory.map((row) => {
                          const matchedLocal = assessments.find((a) => a.id === String(row.id));
                          const scoreDisplay =
                            typeof matchedLocal?.score === "number" && Number.isFinite(matchedLocal.score)
                              ? `${matchedLocal.score}%`
                              : "—";
                          return (
                            <div
                              key={`backend-${row.id}`}
                              className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-4"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-white">{row.type || "Assessment"}</p>
                                  <p className="mt-0.5 text-xs text-white/50">
                                    {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
                                  </p>
                                </div>
                                <ResultPill label={`Score: ${scoreDisplay}`} tone="score" />
                              </div>
                              <Link
                                href={`/clinician/assessment/report?patientId=${patient.id}&assessmentId=${row.id}`}
                                className="mt-3 inline-flex text-[11px] font-semibold text-[#5DCAA5] hover:text-[#1D9E75]"
                              >
                                View report →
                              </Link>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {assessments.length > 0 && (
                    <div>
                      <h3 className="text-sm font-bold text-white">Local session archive</h3>
                      <div className="mt-3 space-y-3">
                        {assessments.map((item) => (
                          <div key={item.id} className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-4">
                            <p className="text-sm font-semibold text-white">
                              {item.sessionLabel?.trim() ||
                                (item.mode === "remote" ? "Remote Assessment" : "In-Clinic Assessment")}
                            </p>
                            <p className="mt-0.5 text-xs text-white/50">
                              {new Date(item.createdAt).toLocaleString()}
                            </p>
                            <Link
                              href={`/results?patientId=${patient.id}&assessmentId=${item.id}`}
                              className="mt-3 inline-flex text-[11px] font-semibold text-[#5DCAA5] hover:text-[#1D9E75]"
                            >
                              Open session record →
                            </Link>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6">
              <h2 className="text-lg font-bold text-white">Therapy Session Results</h2>
                <p className="mt-1 text-sm text-white/50">
                  Optional in-browser therapy sessions for this patient.
                </p>

              <div className="mt-6">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-white/25">
                  Care flow
                </p>
                <TherapyProgressFlow nextActionLine={flowNextAction} />
              </div>

              <div className="mt-6">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-white/25">
                  Therapy trends
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <InfoCard
                    label="Latest total steps"
                    value={
                      therapyTrends.latestSteps != null ? String(therapyTrends.latestSteps) : "—"
                    }
                  />
                  <InfoCard
                    label="Latest symmetry"
                    value={
                      therapyTrends.latestSymmetry != null
                        ? `${therapyTrends.latestSymmetry}%`
                        : "—"
                    }
                  />
                  <InfoCard
                    label="Latest movement quality"
                    value={
                      therapyTrends.latestMovementQuality != null
                        ? String(therapyTrends.latestMovementQuality)
                        : "—"
                    }
                  />
                  <InfoCard
                    label="Best session (steps)"
                    value={
                      therapyTrends.bestSession
                        ? `${therapyTrends.bestSession.totalSteps ?? "—"} reps · ${therapyTrends.bestSession.recordedAt ? new Date(therapyTrends.bestSession.recordedAt).toLocaleDateString() : "—"}`
                        : "—"
                    }
                  />
                  <InfoCard
                    label="Logged therapy sessions"
                    value={String(therapyTrends.count)}
                  />
                </div>
              </div>

              {therapyLoading && (
                <div className="mt-5 rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-4 text-sm text-white/40">
                  Loading therapy reports…
                </div>
              )}

              <div className="mt-5 space-y-5">
                {!therapyLoading && therapySessions.length > 0 ? (
                  therapySessions.map((t) => (
                    <TherapySessionHistoryEntry key={t.id} t={t} />
                  ))
                ) : !therapyLoading ? (
                  <div className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-5 text-sm text-white/40">
                    No therapy sessions logged yet.
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          {/* Sidebar */}
          <aside className="space-y-6">
            {/* ── Remote Assessments panel ── */}
            <section className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-5">
              <div className="mb-4 flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-white">Remote assessments</h2>
                  <p className="mt-0.5 text-xs text-white/35">Links sent to this patient.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSendModalOpen(true)}
                  className="flex items-center gap-1.5 rounded-[7px] border border-[#1D9E75]/20 bg-[#1D9E75]/8 px-3 py-1.5 text-xs font-semibold text-[#5DCAA5] transition hover:bg-[#1D9E75]/15"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Send New
                </button>
              </div>

              {remoteAssessments.length === 0 ? (
                <div className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-4 py-5 text-center">
                  <p className="text-xs text-[#6B7280]">No remote assessments sent yet.</p>
                  <button
                    type="button"
                    onClick={() => setSendModalOpen(true)}
                    className="mt-2 text-xs font-semibold text-[#5DCAA5] transition hover:text-[#1D9E75]"
                  >
                    Send first assessment →
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {remoteAssessments.slice(0, 5).map((ra) => {
                    const isSubmitted = ra.status === "submitted";
                    const isPending   = ra.status === "pending";
                    const link = `${typeof window !== "undefined" ? window.location.origin : ""}/assessment/${ra.id}`;
                    return (
                      <div
                        key={ra.id}
                        className={`overflow-hidden rounded-[8px] border ${
                          isSubmitted ? "border-[#1D9E75]/20 bg-[#1D9E75]/[0.04]" :
                          isPending   ? "border-[#1E2D42] bg-[#0B1220]" :
                          "border-amber-400/15 bg-amber-400/[0.03]"
                        }`}
                      >
                        <div className="px-4 py-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="truncate text-xs font-semibold text-white/80">
                                {ASSESSMENT_TYPE_LABELS[ra.assessmentType]}
                              </p>
                              <p className="mt-0.5 text-[11px] text-white/40">
                                {new Date(ra.createdAt).toLocaleDateString()} ·{" "}
                                {ra.includedSections.length} sections
                              </p>
                            </div>
                            <span className={`shrink-0 rounded-[4px] border px-2 py-0.5 text-[10px] font-bold ${
                              isSubmitted ? "border-[#1D9E75]/30 bg-[#1D9E75]/10 text-[#5DCAA5]" :
                              isPending   ? "border-[#1E2D42] bg-[#0B1220] text-white/40" :
                              "border-amber-400/25 bg-amber-400/10 text-amber-300"
                            }`}>
                              {isSubmitted ? "Submitted" : isPending ? "Awaiting Completion" : "In Progress"}
                            </span>
                          </div>

                          {!isSubmitted && (
                            <p className="mt-1 text-[11px] text-white/30">
                              Expires in {daysUntilExpiry(ra)} days
                            </p>
                          )}
                          {isSubmitted && (
                            <p className="mt-2 text-[11px] text-[#5DCAA5]/80">Ready for review in Clinical Assessment Summary.</p>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-px border-t border-[#1E2D42]">
                          {!isSubmitted && (
                            <button
                              type="button"
                              onClick={async () => {
                                try { await navigator.clipboard.writeText(link); } catch { /* ignore */ }
                              }}
                              className="flex-1 px-3 py-2.5 text-center text-[11px] font-semibold text-white/40 transition hover:bg-[#0B1220] hover:text-white/70"
                            >
                              Copy Link
                            </button>
                          )}
                          {isSubmitted && ra.assessmentId ? (
                            <Link
                              href={`/clinician/assessment/report?patientId=${encodeURIComponent(patient.id)}&assessmentId=${encodeURIComponent(ra.assessmentId)}`}
                              className="flex-1 px-3 py-2.5 text-center text-[11px] font-semibold text-[#5DCAA5] transition hover:bg-[#0B1220]"
                            >
                              Review submission
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Recent Results (local) */}
            {recentAssessments.length > 0 && (
              <section className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-5">
                <h2 className="text-base font-bold text-white">Recent sessions</h2>
                <div className="mt-4 space-y-3">
                  {recentAssessments.map((item) => (
                    <div key={`${item.id}-recent`} className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-4">
                      <p className="text-xs text-white/50">{new Date(item.createdAt).toLocaleDateString()}</p>
                      <p className="mt-1 text-sm font-semibold text-white">
                        {item.mode === "remote" ? "Remote" : "In-clinic"} session
                      </p>
                      <Link
                        href={`/results?patientId=${patient.id}&assessmentId=${item.id}`}
                        className="mt-3 inline-flex text-[11px] font-semibold text-[#5DCAA5] hover:text-[#1D9E75]"
                      >
                        Open session record →
                      </Link>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </section>
      </div>
    </main>
    </>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Display-only: kebab slug → clinical title (e.g. strength-activation-session). */
function formatSessionTypeLabel(slug: string): string {
  const s = slug.trim();
  if (!s) return s;
  return s
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function TherapyProgressFlow({ nextActionLine }: { nextActionLine: string }) {
  const steps: { label: string; detail: string }[] = [
    { label: "Assessment", detail: "Structured capture & review" },
    { label: "Recommended therapy", detail: "Program routing from results" },
    { label: "Therapy session", detail: "In-browser stepping session (pilot)" },
    { label: "Therapy result", detail: "Metrics saved to chart" },
    {
      label: "Next action",
      detail: nextActionLine.length > 120 ? `${nextActionLine.slice(0, 117)}…` : nextActionLine,
    },
  ];
  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-[720px] items-stretch gap-1 md:gap-2">
        {steps.map((s, i) => (
          <Fragment key={s.label}>
            <div className="min-w-0 flex-1 rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-3 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/25">
                {s.label}
              </p>
              <p className="mt-1.5 text-xs leading-snug text-white/70">{s.detail}</p>
            </div>
            {i < steps.length - 1 ? (
              <span
                className="flex shrink-0 items-center px-0.5 text-lg font-light text-white/20"
                aria-hidden
              >
                →
              </span>
            ) : null}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function SoapPlaceholderCard({ title }: { title: string }) {
  return (
    <div className="rounded-[8px] border border-dashed border-[#1E2D42] bg-[#0B1220] p-4">
      <p className="text-xs font-semibold text-white/70">{title}</p>
      <p className="mt-2 text-[11px] leading-relaxed text-white/45">Not recorded yet.</p>
    </div>
  );
}

function TherapySessionHistoryEntry({ t }: { t: TherapySessionLog }) {
  const rec = t.therapyRecommendation;
  const programId = t.programId ?? DEFAULT_THERAPY_PROGRAM_ID;
  const phase = t.phase ?? DEFAULT_THERAPY_PHASE;
  const sessionType = t.sessionType ?? DEFAULT_THERAPY_SESSION_TYPE;
  const left = t.leftKneeCount;
  const right = t.rightKneeCount;
  const symDisplay =
    t.symmetryPct != null
      ? `${t.symmetryPct}%`
      : t.symmetry != null
        ? `${t.symmetry}%`
        : "—";

  return (
    <article
      className={`rounded-[10px] border bg-[#0B1220] p-5 ${
        t.assessmentId?.trim() ? "border-[#1D9E75]/20" : "border-[#1E2D42]"
      }`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/8 pb-4">
        <div>
          <p className="text-lg font-semibold text-white">
            {t.exerciseName?.trim() || t.programLabel || "Therapy session"}
          </p>
          <p className="mt-1 text-sm text-white/55">
            {t.recordedAt ? new Date(t.recordedAt).toLocaleString() : "—"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ResultPill label={`Score: ${t.score ?? "—"}`} tone="score" />
        </div>
      </header>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <InfoCard label="Programme" value={t.programLabel?.trim() || programId.replace(/-/g, " ")} />
        <InfoCard label="Phase" value={phase.replace(/-/g, " ")} />
        <InfoCard label="Session type" value={formatSessionTypeLabel(sessionType)} />
      </div>

      <p className="mb-2 mt-5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        Session metrics
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <InfoCard label="Total steps" value={t.totalSteps != null ? String(t.totalSteps) : "—"} />
        <InfoCard
          label="Left / right steps"
          value={`${left != null ? left : "—"} / ${right != null ? right : "—"}`}
        />
        <InfoCard label="Symmetry" value={symDisplay} />
        <InfoCard
          label="Movement quality"
          value={t.movementQuality != null ? String(t.movementQuality) : "—"}
        />
        <InfoCard
          label="Duration (s)"
          value={t.duration != null && Number.isFinite(t.duration) ? String(t.duration) : "—"}
        />
        <InfoCard label="Score" value={t.score != null ? String(t.score) : "—"} />
      </div>

      {rec ? (
        <div className="mt-5 rounded-[8px] border border-[#1D9E75]/20 bg-[#1D9E75]/[0.05] p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">
            Clinical interpretation &amp; therapy guidance
          </p>
          <p className="mt-1 text-[10px] text-white/45">
            Rule-based decision support captured at save time — not a medical diagnosis.
          </p>
          {rec.interpretation.length > 0 ? (
            <div className="mt-3 border-t border-white/10 pt-3">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-slate-400">
                Interpretation
              </p>
              <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-white/70">
                {rec.interpretation.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 text-xs text-white/50">Interpretation: Not recorded.</p>
          )}
          <div className="mt-4 space-y-2 border-t border-white/10 pt-3 text-xs">
            <p className="text-white/65">
              <span className="font-semibold text-white/80">Recommendation — progression: </span>
              {rec.progressionStatus}
            </p>
            <p className="text-white/65">
              <span className="font-semibold text-white/80">Recommendation — next action: </span>
              {rec.nextAction}
            </p>
            <p className="text-[11px] leading-relaxed text-white/60">
              <span className="font-semibold text-white/75">Safety / intensity: </span>
              {rec.intensityNote}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-4 text-xs text-white/40">
          <span className="font-semibold text-white/55">Clinical interpretation: </span>
          Not recorded for this session.
        </div>
      )}

      {t.therapyContextReason ? (
        <p className="mt-4 text-xs leading-relaxed text-white/55">
          <span className="font-medium text-white/65">Therapy context: </span>
          {t.therapyContextReason}
        </p>
      ) : null}

      <p className="mt-4 border-t border-white/8 pt-3 text-[10px] leading-relaxed text-slate-500">
        Safety note: All metrics and guidance above are decision-support only and require qualified clinical judgment.
        They do not constitute a diagnosis or treatment plan.
      </p>
    </article>
  );
}

// ── ProgressSnapshotSection ───────────────────────────────────────────────────

interface ProgressSnapshotSectionProps {
  patientId: string;
  plan: TreatmentPlan | null;
  planProgress: PatientProgressSummary | null;
  adherence: Adherence | null;
  onReviewAcknowledged?: (reviewedAt: string) => void;
}

function ProgressSnapshotSection({
  patientId,
  plan,
  planProgress,
  adherence,
  onReviewAcknowledged,
}: ProgressSnapshotSectionProps) {
  const sessionsDone = planProgress?.sessionsCompleted ?? adherence?.sessionsCompleted ?? 0;

  return (
    <section id="progress-snapshot" className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6 scroll-mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-white">Progress Snapshot</h2>
        {planProgress?.needsReview && planProgress.clinicalAction && (
          <span className="rounded-[5px] border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300">
            {planProgress.clinicalAction.title}
          </span>
        )}
      </div>
      <div className="mt-4">
        {!plan ? (
          <p className="mt-3 rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-4 py-4 text-sm leading-relaxed text-[#6B7280]">
            No progress recorded yet. Progress appears after the patient completes a session.
          </p>
        ) : sessionsDone === 0 ? (
          <p className="mt-3 rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-4 py-4 text-sm leading-relaxed text-[#6B7280]">
            No progress recorded yet. Progress appears after the patient completes a session.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              {
                label: "Sessions",
                value: planProgress
                  ? `${planProgress.sessionsCompleted} / ${planProgress.totalSessions}`
                  : adherence
                    ? `${adherence.sessionsCompleted} / ${adherence.totalSessions}`
                    : "—",
              },
              {
                label: "Progress",
                value: planProgress
                  ? `${planProgress.progressPct}%`
                  : adherence
                    ? `${adherence.adherenceRatePct}%`
                    : "—",
              },
              {
                label: "Effort",
                value: planProgress?.latestEffortScore != null
                  ? `${planProgress.latestEffortScore}/10`
                  : "—",
              },
              {
                label: "Pain response",
                value: planProgress?.latestPainResponse ?? "—",
              },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-3">
                <p className="text-[10px] text-white/35">{label}</p>
                <p
                  className="mt-0.5 text-sm font-bold text-[#5DCAA5]"
                  style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>
        )}

        {planProgress?.clinicalAction && sessionsDone > 0 && (
          <div className="mt-4">
            <ClinicalActionCard
              action={planProgress.clinicalAction}
              patientNote={planProgress.latestPatientNote}
              planSessionsHref={`#rehabilitation-plan`}
              review={
                planProgress.needsReview
                  ? {
                      patientId,
                      planId: planProgress.planId,
                      sessionLogId: planProgress.latestSessionLogId,
                      reviewAcknowledged: planProgress.reviewAcknowledged,
                      reviewedAt: planProgress.reviewedAt,
                      onAcknowledged: onReviewAcknowledged,
                    }
                  : undefined
              }
            />
          </div>
        )}

        {planProgress?.safetyConcernReported && (
          <div className="mt-3 rounded-[8px] border border-amber-400/25 bg-amber-400/10 px-4 py-3">
            <p className="text-xs leading-relaxed text-amber-200">
              Patient reported sharp pain, dizziness, or unusual symptoms before their latest session.
              Review before next session guidance.
            </p>
          </div>
        )}

        {planProgress?.latestPatientNote && !planProgress.clinicalAction && (
          <div className="mt-3 rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/25">
              Patient note from last session
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-white/75 whitespace-pre-wrap">
              {planProgress.latestPatientNote}
            </p>
          </div>
        )}

        {adherence && plan && sessionsDone > 0 && (
          <div className="mt-4 rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-white/25">
              Session adherence
            </p>
            <div className="flex items-end gap-1.5">
              {adherence.weeklyCompletions.map((w) => {
                const fillPct = w.target > 0 ? Math.round((w.completed / w.target) * 100) : 0;
                return (
                  <div key={w.week} className="flex flex-1 flex-col items-center gap-1">
                    <div className="relative h-12 w-full overflow-hidden rounded-[3px] bg-[#1E2D42]">
                      <div
                        className="absolute bottom-0 left-0 right-0 rounded-[3px] bg-[#1D9E75]/70 transition-all"
                        style={{ height: `${fillPct}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-white/30">{w.week}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <Link
          href="/clinician/results"
          className="mt-4 inline-flex rounded-[7px] border border-[#1D9E75]/25 bg-[#1D9E75]/8 px-3.5 py-2 text-xs font-semibold text-[#5DCAA5] transition hover:bg-[#1D9E75]/14"
        >
          Review Results
        </Link>
      </div>
    </section>
  );
}

// ── TreatmentPlanSection ──────────────────────────────────────────────────────

interface TreatmentPlanSectionProps {
  patientId: string;
  plan: TreatmentPlan | null;
  loading: boolean;
}

function clinicianSessionDisplayStatus(
  sessions: Array<{ id: string; status: string }>,
  session: { id: string; status: string },
): "completed" | "in-progress" | "upcoming" {
  if (session.status === "completed") return "completed";
  const first = sessions.find((s) => s.status !== "completed");
  if (first?.id === session.id) return "in-progress";
  return "upcoming";
}

function TreatmentPlanSection({
  patientId,
  plan,
  loading,
}: TreatmentPlanSectionProps) {
  const structuredPlanHref = `/clinician/plans/new?patientId=${encodeURIComponent(patientId)}`;
  const { metrics: cvMetrics } = useCvSessionMetrics({ patientId, limit: 50 });

  const cvMetricsByPlanSessionId = useMemo(
    () => indexCvMetricsByPlanSessionId(cvMetrics),
    [cvMetrics],
  );

  if (loading) {
    return (
      <section className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6">
        <p className="text-sm text-white/40">Loading rehabilitation plan…</p>
      </section>
    );
  }

  return (
    <section id="rehabilitation-plan" className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6 scroll-mt-6">
      <h2 className="text-lg font-bold text-white">Rehabilitation Plan</h2>
      <div className="mt-4 mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-white">
            {plan ? plan.programName : "No plan assigned"}
          </h3>
          {plan && (
            <>
              <p className="mt-0.5 text-sm text-white/40">{plan.phaseName}</p>
              <p className="mt-1 text-xs text-white/35 capitalize">Status: {plan.status}</p>
            </>
          )}
        </div>
        <Link
          href={structuredPlanHref}
          className="shrink-0 rounded-[7px] bg-[#1D9E75] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#179165]"
        >
          {plan ? "Assign updated plan" : "Build treatment plan"}
        </Link>
      </div>

      {!plan && (
        <p className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-4 py-4 text-sm leading-relaxed text-[#6B7280]">
          No rehabilitation plan assigned yet. Use the structured plan builder to select exercises from
          the library, set dose, and share the patient portal link.
        </p>
      )}

      {/* Current plan summary */}
      {plan && (
        <div className="space-y-3">
          <div className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/25">Goal</p>
            <p className="text-sm text-white/70">{plan.phaseGoal}</p>
          </div>

          {plan.clinicianNotes && (
            <div className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-white/25">
                Clinician Notes
              </p>
              <p className="text-sm text-white/60">{plan.clinicianNotes}</p>
            </div>
          )}

          <div className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-white/25">
              Session schedule ({plan.sessions.filter((s) => s.status !== "completed").length} remaining)
            </p>
            <SessionScheduleView
              sessions={plan.sessions.map((s) => ({
                id: s.id,
                sessionNumber: s.sessionNumber,
                title: s.title,
                exercises: s.exercises,
                status: s.status === "completed" ? "completed" : s.status,
                scheduledAt: s.scheduledAt ?? null,
                completedAt: s.completedAt ?? null,
              }))}
              sessionsPerWeek={plan.sessionsPerWeek}
              variant="clinician"
              getDisplayStatus={clinicianSessionDisplayStatus}
              cvMetricsByPlanSessionId={cvMetricsByPlanSessionId}
            />
            <p className="mt-3 text-[10px] leading-relaxed text-white/30">
              Camera status uses saved assistive metrics per session. Therapist review only · not
              clinically validated · reps are assistive only.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

const inputCls =
  "w-full rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3 text-white outline-none placeholder:text-white/25 focus:border-[#1D9E75]/40";

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-white/70">
        {label}{required && <span className="ml-1 text-rose-300">*</span>}
      </span>
      {children}
    </label>
  );
}

function formatTestLabel(test: string) {
  const map: Record<string, string> = {
    posture: "Postural Assessment", gait: "Gait Assessment", balance: "Balance Assessment",
    squat: "Squat Assessment", rom: "ROM Assessment", reach: "Reach Test",
    sit_to_stand: "Sit-to-Stand", compensation: "Compensation Analysis", "ai-vision": "Body Axis AI",
  };
  return map[test] ?? test;
}

function formatStatusLabel(status: string) {
  if (status === "completed") return "Session Completed";
  if (status === "draft") return "Draft";
  if (status === "pending") return "Awaiting Completion";
  return status;
}

function ResultPill({ label, tone }: { label: string; tone: "score" | "good" | "neutral" }) {
  const cls = tone === "good"
    ? "border-[#1D9E75]/30 bg-[#1D9E75]/10 text-[#5DCAA5]"
    : tone === "score"
      ? "border-[#1D9E75]/20 bg-[#1D9E75]/8 text-[#5DCAA5]"
      : "border-[#1E2D42] bg-[#0B1220] text-white/70";
  return <span className={`rounded-[5px] border px-2.5 py-1 text-[11px] font-medium ${cls}`}>{label}</span>;
}

function Badge({ text }: { text: string }) {
  return <span className="rounded-[5px] border border-[#1D9E75]/20 bg-[#1D9E75]/8 px-2.5 py-1 text-[11px] font-medium text-[#5DCAA5]">{text}</span>;
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-[#1E2D42] bg-[#0B1220] p-4">
      <p className="text-xs text-white/40">{label}</p>
      <p
        className="mt-1.5 text-sm font-semibold text-white"
        style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
      >
        {value}
      </p>
    </div>
  );
}
