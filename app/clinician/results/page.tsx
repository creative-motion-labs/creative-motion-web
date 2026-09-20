"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ClinicianResultCard, ClinicianResultsResponse } from "@/app/api/clinician/results/route";
import type { AssessmentSnapshot } from "@/app/lib/assessment-snapshot";
import type { PatientRow } from "@/app/lib/validate-patient-ownership";
import { ClinicalActionCard } from "@/app/components/clinician/ClinicalActionCard";
import { ClinicalReviewActions } from "@/app/components/clinician/ClinicalReviewActions";
import { DemoOfflineBanner } from "@/app/components/clinician/DemoOfflineBanner";
import { ClinicianInlineError } from "@/app/components/clinician/ClinicianInlineError";
import {
  collectDemoMeta,
  fetchClinicianResults,
  fetchPatientsList,
} from "@/app/lib/api/demo-fallback-client";
import {
  clinicalActionNeedsTherapistReview,
  type ClinicalActionResult,
  type ClinicalActionSeverity,
} from "@/app/lib/clinical-action-engine";

type PipelineFilter = "all" | "assessment" | "in_rehab" | "completed" | "needs_review";

type PipelineState =
  | { kind: "in_rehab"; completed: number; total: number }
  | { kind: "plan_assigned" }
  | { kind: "assessment_submitted" };

type AssessmentSnapshotView = AssessmentSnapshot;

type RehabSnapshot = {
  planId: string;
  planTitle: string;
  sessionsCompleted: number;
  totalSessions: number;
  progressPct: number;
  latestEffortScore: number | null;
  latestPainResponse: string | null;
  needsReview: boolean;
  clinicalAction: ClinicalActionResult;
  latestPatientNote: string | null;
  lastCompletedAt: string | null;
  latestSessionLogId: string | null;
  reviewAcknowledged: boolean;
  reviewedAt: string | null;
};

type PatientPipelineCard = {
  patientId: string;
  patientName: string;
  condition: string | null;
  lastActivityAt: string | null;
  state: PipelineState;
  assessment: AssessmentSnapshotView | null;
  rehab: RehabSnapshot | null;
};

function assessmentTypeLabel(type: string): string {
  if (type === "general_msk") return "General MSK Assessment";
  if (type === "structured") return "Structured Assessment";
  if (type === "remote_questionnaire") return "Remote Questionnaire Assessment";
  if (type === "upper_limb_motor_screen") return "Upper Limb Motor Screen";
  if (type === "questionnaire") return "Questionnaire";
  return type;
}

function reportHref(patientId: string, assessmentId: string): string {
  const params = new URLSearchParams({ patientId, assessmentId });
  return `/clinician/assessment/report?${params.toString()}`;
}

function pickPrimaryRehabPlan(plans: ClinicianResultCard[]): ClinicianResultCard | null {
  if (plans.length === 0) return null;
  const active = plans.filter((plan) => plan.sessionsCompleted > 0);
  if (active.length > 0) {
    return [...active].sort((a, b) => {
      const aTime = a.lastCompletedAt ? new Date(a.lastCompletedAt).getTime() : 0;
      const bTime = b.lastCompletedAt ? new Date(b.lastCompletedAt).getTime() : 0;
      return bTime - aTime;
    })[0]!;
  }
  return plans[0]!;
}

function derivePipelineState(
  assessment: AssessmentSnapshotView | null,
  rehab: RehabSnapshot | null,
): PipelineState {
  if (rehab) {
    if (rehab.sessionsCompleted > 0) {
      return {
        kind: "in_rehab",
        completed: rehab.sessionsCompleted,
        total: rehab.totalSessions,
      };
    }
    return { kind: "plan_assigned" };
  }
  if (assessment) return { kind: "assessment_submitted" };
  return { kind: "assessment_submitted" };
}

function stateBadge(state: PipelineState): { label: string; className: string } {
  if (state.kind === "in_rehab") {
    return {
      label: `In rehab · ${state.completed} of ${state.total} sessions`,
      className: "border-[#1D9E75]/30 bg-[#1D9E75]/10 text-[#5DCAA5]",
    };
  }
  if (state.kind === "plan_assigned") {
    return {
      label: "Plan assigned",
      className: "border-cyan-300/25 bg-cyan-400/10 text-cyan-200",
    };
  }
  return {
    label: "Assessment submitted",
    className: "border-lime-300/20 bg-lime-400/10 text-lime-300",
  };
}

function buildPipelineCards(
  patients: PatientRow[],
  assessmentsByPatient: Map<string, AssessmentSnapshotView>,
  rehabByPatient: Map<string, RehabSnapshot>,
): PatientPipelineCard[] {
  const patientIds = new Set<string>([
    ...patients.map((patient) => patient.id),
    ...assessmentsByPatient.keys(),
    ...rehabByPatient.keys(),
  ]);

  const cards: PatientPipelineCard[] = [];

  for (const patientId of patientIds) {
    const assessment = assessmentsByPatient.get(patientId) ?? null;
    const rehab = rehabByPatient.get(patientId) ?? null;
    if (!assessment && !rehab) continue;

    const patient = patients.find((row) => row.id === patientId);
    const state = derivePipelineState(assessment, rehab);
    const lastActivityAt =
      rehab?.lastCompletedAt ??
      assessment?.submittedAt ??
      null;

    const condition =
      patient?.diagnosis?.trim() ||
      assessment?.bodyRegion?.trim() ||
      rehab?.planTitle?.trim() ||
      null;

    cards.push({
      patientId,
      patientName: patient?.full_name ?? "Patient",
      condition,
      lastActivityAt,
      state,
      assessment,
      rehab,
    });
  }

  return cards.sort((a, b) => {
    const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
    const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
    return bTime - aTime;
  });
}

const REVIEW_SEVERITY_ORDER: Record<ClinicalActionSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function compareReviewQueueCards(a: ClinicianResultCard, b: ClinicianResultCard): number {
  const severityDiff =
    REVIEW_SEVERITY_ORDER[a.clinicalAction.severity] -
    REVIEW_SEVERITY_ORDER[b.clinicalAction.severity];
  if (severityDiff !== 0) return severityDiff;
  const aTime = a.lastCompletedAt ? new Date(a.lastCompletedAt).getTime() : 0;
  const bTime = b.lastCompletedAt ? new Date(b.lastCompletedAt).getTime() : 0;
  return bTime - aTime;
}

function buildReviewQueue(rehabResults: ClinicianResultCard[]): ClinicianResultCard[] {
  const urgent = rehabResults.filter(
    (card) =>
      clinicalActionNeedsTherapistReview(card.clinicalAction.status) &&
      !card.reviewAcknowledged,
  );
  const byPatient = new Map<string, ClinicianResultCard>();
  for (const card of urgent) {
    const existing = byPatient.get(card.patientId);
    if (!existing || compareReviewQueueCards(card, existing) < 0) {
      byPatient.set(card.patientId, card);
    }
  }
  return Array.from(byPatient.values()).sort(compareReviewQueueCards);
}

export default function UnifiedResultsPage() {
  const [filter, setFilter] = useState<PipelineFilter>("all");
  const [pipeline, setPipeline] = useState<PatientPipelineCard[]>([]);
  const [rehabResults, setRehabResults] = useState<ClinicianResultCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [demoMode, setDemoMode] = useState(false);
  const [demoNotice, setDemoNotice] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError("");

        const [patientsPayload, resultsPayload] = await Promise.all([
          fetchPatientsList({ strict: true }),
          fetchClinicianResults({ strict: true }),
        ]);

        if (!resultsPayload) {
          throw new Error("Failed to load results.");
        }

        const patients = patientsPayload.patients;
        const rehabResults = resultsPayload.cards;
        const meta = collectDemoMeta(patientsPayload, resultsPayload);
        setDemoMode(meta.demoMode);
        setDemoNotice(meta.demoNotice);

        const assessmentsByPatient = new Map<string, AssessmentSnapshotView>();
        for (const snapshot of resultsPayload.patientAssessments) {
          assessmentsByPatient.set(snapshot.patientId, snapshot);
        }

        const rehabGrouped = new Map<string, ClinicianResultCard[]>();
        for (const result of rehabResults) {
          const group = rehabGrouped.get(result.patientId) ?? [];
          group.push(result);
          rehabGrouped.set(result.patientId, group);
        }

        const rehabByPatient = new Map<string, RehabSnapshot>();
        for (const [patientId, plans] of rehabGrouped) {
          const primary = pickPrimaryRehabPlan(plans);
          if (!primary) continue;
          rehabByPatient.set(patientId, {
            planId: primary.planId,
            planTitle: primary.planTitle,
            sessionsCompleted: primary.sessionsCompleted,
            totalSessions: primary.totalSessions,
            progressPct: primary.progressPct,
            latestEffortScore: primary.latestEffortScore,
            latestPainResponse: primary.latestPainResponse,
            needsReview: primary.needsReview,
            clinicalAction: primary.clinicalAction,
            latestPatientNote: primary.latestPatientNote,
            lastCompletedAt: primary.lastCompletedAt,
            latestSessionLogId: primary.latestSessionLogId,
            reviewAcknowledged: primary.reviewAcknowledged,
            reviewedAt: primary.reviewedAt,
          });
        }

        setPipeline(buildPipelineCards(patients, assessmentsByPatient, rehabByPatient));
        setRehabResults(rehabResults);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load patient pipeline.");
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return pipeline;
    if (filter === "assessment") {
      return pipeline.filter((card) => card.state.kind === "assessment_submitted");
    }
    if (filter === "in_rehab") {
      return pipeline.filter((card) => card.state.kind === "in_rehab" || card.state.kind === "plan_assigned");
    }
    if (filter === "needs_review") {
      return pipeline.filter((card) => card.rehab?.needsReview === true);
    }
    return pipeline.filter(
      (card) =>
        card.state.kind === "in_rehab" &&
        card.rehab != null &&
        card.rehab.totalSessions > 0 &&
        card.rehab.sessionsCompleted >= card.rehab.totalSessions,
    );
  }, [pipeline, filter]);

  const assessmentCount = pipeline.filter((card) => card.state.kind === "assessment_submitted").length;
  const inRehabCount = pipeline.filter((card) => card.state.kind === "in_rehab").length;
  const planAssignedCount = pipeline.filter((card) => card.state.kind === "plan_assigned").length;
  const completedCount = pipeline.filter(
    (card) =>
      card.rehab != null &&
      card.rehab.totalSessions > 0 &&
      card.rehab.sessionsCompleted >= card.rehab.totalSessions,
  ).length;
  const needsReviewCount = pipeline.filter((card) => card.rehab?.needsReview === true).length;

  const reviewQueue = useMemo(() => buildReviewQueue(rehabResults), [rehabResults]);

  function handleReviewAcknowledged(planId: string, reviewedAt: string) {
    setRehabResults((prev) =>
      prev.map((card) =>
        card.planId === planId
          ? { ...card, reviewAcknowledged: true, reviewedAt }
          : card,
      ),
    );
    setPipeline((prev) =>
      prev.map((card) =>
        card.rehab?.planId === planId
          ? {
              ...card,
              rehab: {
                ...card.rehab,
                reviewAcknowledged: true,
                reviewedAt,
              },
            }
          : card,
      ),
    );
  }

  return (
    <main className="min-h-screen bg-[#0B1220] px-6 py-8 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/25">
              Clinician workspace
            </p>
            <h1 className="mt-2 text-2xl font-bold text-white">Results</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/45">
              {reviewQueue.length > 0
                ? `Start with ${reviewQueue.length} patient${reviewQueue.length > 1 ? "s" : ""} in the review queue below, then browse the full pipeline.`
                : "One card per patient — assessment status, rehab progress, and suggested clinician follow-up."}
            </p>
          </div>
          <Link
            href="/clinician"
            className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-4 py-2.5 text-sm font-semibold text-white/70 transition hover:text-white"
          >
            ← Dashboard
          </Link>
        </div>

        <DemoOfflineBanner visible={demoMode} notice={demoNotice} />

        {!loading && !error && reviewQueue.length > 0 && (
          <section className="mb-6 rounded-[10px] border border-amber-400/20 bg-[#0F1825] p-6">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-white">Patients Needing Review</h2>
              <p className="mt-1 text-sm text-white/45">
                Patients with recent responses that may need therapist attention.
              </p>
            </div>
            <div className="grid gap-3">
              {reviewQueue.map((card) => (
                <ReviewQueueCard
                  key={`${card.patientId}-${card.planId}`}
                  card={card}
                  onAcknowledged={(reviewedAt) =>
                    handleReviewAcknowledged(card.planId, reviewedAt)
                  }
                />
              ))}
            </div>
          </section>
        )}

        {!loading && !error && reviewQueue.length === 0 && (
          <section className="mb-6 rounded-[10px] border border-[#1E2D42] bg-[#0F1825] px-6 py-5">
            <h2 className="text-sm font-semibold text-white">Review queue</h2>
            <p className="mt-1 text-sm text-white/45">
              No active review flags. All patient responses are within expected parameters.
            </p>
          </section>
        )}

        <section className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6">
          <div className="mb-6 grid gap-3 sm:grid-cols-4">
            <MiniStat label="Patients in pipeline" value={String(pipeline.length)} />
            <MiniStat label="Assessments to review" value={String(assessmentCount)} />
            <MiniStat label="In rehab" value={String(inRehabCount)} />
            <MiniStat label="Plans awaiting sessions" value={String(planAssignedCount)} />
          </div>

          <div className="mb-6 flex flex-wrap items-center gap-2">
            <FilterButton active={filter === "all"} onClick={() => setFilter("all")} label="All" count={pipeline.length} />
            <FilterButton active={filter === "assessment"} onClick={() => setFilter("assessment")} label="Assessment submitted" count={assessmentCount} />
            <FilterButton active={filter === "in_rehab"} onClick={() => setFilter("in_rehab")} label="In rehab or plan assigned" count={inRehabCount + planAssignedCount} />
            <FilterButton active={filter === "needs_review"} onClick={() => setFilter("needs_review")} label="Needs therapist review" count={needsReviewCount} />
            <FilterButton active={filter === "completed"} onClick={() => setFilter("completed")} label="Completed" count={completedCount} />
          </div>

          {loading ? (
            <div className="flex flex-col items-center gap-3 py-12" aria-busy="true" aria-label="Loading patient pipeline">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1E2D42] border-t-[#1D9E75]" />
              <p className="text-sm text-white/40">Loading patient pipeline…</p>
            </div>
          ) : error ? (
            <ClinicianInlineError message={error} />
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-white/40">
                No patient results yet. Send a remote assessment or assign a treatment plan to start the pipeline.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Link
                  href="/clinician/patients"
                  className="rounded-[7px] bg-[#1D9E75] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#179165]"
                >
                  Open patients
                </Link>
                <Link
                  href="/clinician/plans/new"
                  className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-4 py-2.5 text-sm font-semibold text-white/60 transition hover:text-white"
                >
                  Build plan
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {filtered.map((card) => (
                <PatientPipelineCardView
                  key={card.patientId}
                  card={card}
                  onReviewAcknowledged={handleReviewAcknowledged}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ReviewQueueCard({
  card,
  onAcknowledged,
}: {
  card: ClinicianResultCard;
  onAcknowledged: (reviewedAt: string) => void;
}) {
  const profileHref = `/clinician/patients/${card.patientId}`;
  const outcomesHref = `/clinician/patients/${card.patientId}/outcomes`;
  const planHref = `${profileHref}#rehabilitation-plan`;
  const styles =
    card.clinicalAction.severity === "high"
      ? "border-rose-400/25 bg-rose-400/5"
      : "border-amber-400/20 bg-amber-400/5";

  return (
    <article className={`rounded-[8px] border p-4 ${styles}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">{card.patientName}</p>
          <p className="mt-1 text-xs font-semibold text-amber-200/90">
            {card.clinicalAction.title} · review recommended
          </p>
          <p className="mt-2 text-xs leading-relaxed text-white/60">{card.clinicalAction.reason}</p>
        </div>
        <span className="shrink-0 rounded-[5px] border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
          Therapist attention
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric
          label="Pain response"
          value={card.latestPainResponse ?? (card.latestPainScore != null ? `${card.latestPainScore}/10` : "—")}
        />
        <Metric
          label="Effort"
          value={card.latestEffortScore != null ? `${card.latestEffortScore}/10` : "—"}
        />
        <Metric label="Adherence" value={`${card.progressPct}%`} />
        <Metric
          label="Sessions"
          value={`${card.sessionsCompleted} / ${card.totalSessions}`}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={profileHref}
          className="inline-flex rounded-[7px] border border-[#1D9E75]/20 bg-[#1D9E75]/8 px-3 py-2 text-xs font-semibold text-[#5DCAA5] transition hover:bg-[#1D9E75]/15"
        >
          Review patient chart
        </Link>
        <Link
          href={planHref}
          className="inline-flex rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3 py-2 text-xs font-semibold text-white/70 transition hover:text-white"
        >
          View plan &amp; sessions
        </Link>
        <Link
          href={outcomesHref}
          className="inline-flex rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3 py-2 text-xs font-semibold text-white/70 transition hover:text-white"
        >
          Progress &amp; outcomes
        </Link>
      </div>

      <ClinicalReviewActions
        patientId={card.patientId}
        planId={card.planId}
        sessionLogId={card.latestSessionLogId}
        actionStatus={card.clinicalAction.status}
        reviewAcknowledged={card.reviewAcknowledged}
        reviewedAt={card.reviewedAt}
        onAcknowledged={onAcknowledged}
        compact
      />
    </article>
  );
}

function PatientPipelineCardView({
  card,
  onReviewAcknowledged,
}: {
  card: PatientPipelineCard;
  onReviewAcknowledged: (planId: string, reviewedAt: string) => void;
}) {
  const badge = stateBadge(card.state);
  const showRehabMetrics = card.rehab != null && card.state.kind !== "assessment_submitted";
  const profileHref = `/clinician/patients/${card.patientId}`;
  const outcomesHref = `/clinician/patients/${card.patientId}/outcomes`;

  return (
    <article className="rounded-[10px] border border-[#1E2D42] bg-[#0B1220] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-white">{card.patientName}</p>
          {card.condition && (
            <p className="mt-0.5 truncate text-sm text-white/55">{card.condition}</p>
          )}
          {card.lastActivityAt && (
            <p className="mt-1 text-xs text-white/35">
              Last activity {new Date(card.lastActivityAt).toLocaleString()}
            </p>
          )}
          {card.assessment && (
            <p className="mt-1 text-xs text-white/35">
              {assessmentTypeLabel(card.assessment.assessmentType)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {card.rehab?.needsReview && (
            <span className="rounded-[5px] border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
              {card.rehab.clinicalAction.title}
            </span>
          )}
          <span className={`rounded-[5px] border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badge.className}`}>
            {badge.label}
          </span>
        </div>
      </div>

      {showRehabMetrics && card.rehab ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Metric label="Adherence" value={`${card.rehab.progressPct}%`} />
          <Metric
            label="Effort"
            value={card.rehab.latestEffortScore != null ? `${card.rehab.latestEffortScore}/10` : "—"}
          />
          <Metric
            label="Pain response"
            value={card.rehab.latestPainResponse ?? "—"}
          />
          <Metric
            label="Sessions"
            value={`${card.rehab.sessionsCompleted} / ${card.rehab.totalSessions}`}
          />
        </div>
      ) : card.assessment ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Metric
            label={card.assessment.painOnMovement ? "Pain at rest" : "Pain score (NPRS)"}
            value={card.assessment.painAtRest ?? "—"}
          />
          {card.assessment.painOnMovement ? (
            <Metric label="Pain on movement" value={card.assessment.painOnMovement} />
          ) : null}
          <Metric label="Body region" value={card.assessment.bodyRegion ?? "—"} className={card.assessment.painOnMovement ? "" : "col-span-2"} />
        </div>
      ) : null}

      {showRehabMetrics && card.rehab && (card.rehab.sessionsCompleted > 0 || card.rehab.needsReview) && (
        <div className="mt-4">
          <ClinicalActionCard
            action={card.rehab.clinicalAction}
            patientNote={card.rehab.latestPatientNote}
            planSessionsHref={`${profileHref}#rehabilitation-plan`}
            compact
            review={{
              patientId: card.patientId,
              planId: card.rehab.planId,
              sessionLogId: card.rehab.latestSessionLogId,
              reviewAcknowledged: card.rehab.reviewAcknowledged,
              reviewedAt: card.rehab.reviewedAt,
              onAcknowledged: (reviewedAt) =>
                onReviewAcknowledged(card.rehab!.planId, reviewedAt),
            }}
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {card.assessment && (
          <Link
            href={reportHref(card.patientId, card.assessment.assessmentId)}
            className="inline-flex rounded-[7px] border border-[#1D9E75]/20 bg-[#1D9E75]/8 px-3 py-2 text-xs font-semibold text-[#5DCAA5] transition hover:bg-[#1D9E75]/15"
          >
            Review assessment report
          </Link>
        )}
        {card.rehab && (
          <Link
            href={`${profileHref}#rehabilitation-plan`}
            className="inline-flex rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2 text-xs font-semibold text-white/70 transition hover:text-white"
          >
            View plan &amp; sessions
          </Link>
        )}
        <Link
          href={outcomesHref}
          className="inline-flex rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2 text-xs font-semibold text-white/70 transition hover:text-white"
        >
          Progress &amp; outcomes
        </Link>
        <Link
          href={profileHref}
          className="inline-flex rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2 text-xs font-semibold text-white/70 transition hover:text-white"
        >
          Open patient chart
        </Link>
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2 ${className}`}>
      <p className="text-[10px] text-white/35">{label}</p>
      <p
        className="mt-0.5 truncate text-sm font-semibold text-[#5DCAA5]"
        style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
      >
        {value}
      </p>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[7px] px-3 py-2 text-xs font-semibold transition ${
        active
          ? "bg-[#1D9E75] text-white"
          : "border border-[#1E2D42] bg-[#0B1220] text-white/45 hover:text-white/70"
      }`}
    >
      {label}
      <span className="ml-1.5 opacity-70">({count})</span>
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3">
      <p className="text-[10px] text-white/35">{label}</p>
      <p
        className="mt-1 text-lg font-bold text-[#5DCAA5]"
        style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
      >
        {value}
      </p>
    </div>
  );
}
