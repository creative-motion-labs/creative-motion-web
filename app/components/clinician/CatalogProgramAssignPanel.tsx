"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClinicalPrescribedSide } from "@/app/lib/clinical/clinical-prescribed-side";
import {
  buildCatalogPlanSessionsPayload,
  CATALOG_ASSIGNMENT_IDEMPOTENCY_CONFLICT_MESSAGE,
  formatPrescribedSideForReview,
  isApplicableCatalogSession,
  mapPlanAssignHttpError,
  PRESCRIBED_SIDE_UNAVAILABLE_MESSAGE,
  reconcileCatalogSessionPrescribedSide,
  validateCatalogPrescribedSideDraftForSubmit,
  type CatalogPlanSessionDraftInput,
} from "@/app/lib/clinical/clinical-prescribed-side-plan-draft";
import {
  buildCatalogAssignmentFingerprint,
  createCatalogAssignmentAttemptController,
} from "@/app/lib/clinical/clinical-prescribed-side-catalog-assignment";
import {
  CATALOG_PROGRAMS_LOAD_ERROR_MESSAGE,
  parseCatalogProgramsResponse,
  type CatalogProgramListItem,
} from "@/app/lib/clinical/catalog-programs-list";
import { PrescribedSideSelector } from "@/app/components/clinician/PrescribedSideSelector";

type CatalogProgramAssignPanelProps = {
  patientId: string;
  assessmentId: string | null;
  onAssigned: () => void;
};

type CatalogSessionDraft = CatalogPlanSessionDraftInput;

export function CatalogProgramAssignPanel({
  patientId,
  assessmentId,
  onAssigned,
}: CatalogProgramAssignPanelProps) {
  const [programs, setPrograms] = useState<CatalogProgramListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [sessionDrafts, setSessionDrafts] = useState<CatalogSessionDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const assignmentControllerRef = useRef(createCatalogAssignmentAttemptController());
  const assignAbortRef = useRef<AbortController | null>(null);
  const catalogLoadAbortRef = useRef<AbortController | null>(null);
  const patientScopeRef = useRef(0);

  const resetCatalogAssignmentUi = useCallback(() => {
    assignAbortRef.current?.abort();
    assignAbortRef.current = null;
    assignmentControllerRef.current.resetAll();
    setSelectedProgramId(null);
    setSessionDrafts([]);
    setSaveError("");
    setSaving(false);
  }, []);

  useEffect(() => {
    patientScopeRef.current += 1;
    resetCatalogAssignmentUi();
  }, [patientId, assessmentId, resetCatalogAssignmentUi]);

  useEffect(() => {
    const scopeAtStart = patientScopeRef.current;
    catalogLoadAbortRef.current?.abort();
    const abort = new AbortController();
    catalogLoadAbortRef.current = abort;

    setLoading(true);
    setLoadError("");
    setPrograms([]);

    fetch("/api/plans/catalog-programs", { cache: "no-store", signal: abort.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? CATALOG_PROGRAMS_LOAD_ERROR_MESSAGE);
        }
        return res.json() as Promise<unknown>;
      })
      .then((data) => {
        if (abort.signal.aborted || scopeAtStart !== patientScopeRef.current) return;
        const parsed = parseCatalogProgramsResponse(data);
        if (!parsed.ok) {
          setLoadError(parsed.error);
          return;
        }
        setPrograms(parsed.programs);
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted || scopeAtStart !== patientScopeRef.current) return;
        setLoadError(
          err instanceof Error ? err.message : CATALOG_PROGRAMS_LOAD_ERROR_MESSAGE,
        );
      })
      .finally(() => {
        if (!abort.signal.aborted && scopeAtStart === patientScopeRef.current) {
          setLoading(false);
        }
      });

    return () => {
      abort.abort();
    };
  }, [patientId]);

  useEffect(() => {
    const controller = assignmentControllerRef.current;
    return () => {
      catalogLoadAbortRef.current?.abort();
      assignAbortRef.current?.abort();
      controller.resetAll();
    };
  }, []);

  const selectedProgram = useMemo(
    () => programs.find((program) => program.id === selectedProgramId) ?? null,
    [programs, selectedProgramId],
  );

  const selectProgram = useCallback((program: CatalogProgramListItem) => {
    if (assignmentControllerRef.current.isInFlight()) return;
    assignAbortRef.current?.abort();
    assignAbortRef.current = null;
    assignmentControllerRef.current.resetAssignmentKey();
    setSelectedProgramId(program.id);
    setSessionDrafts(
      program.sessions.map((session) =>
        reconcileCatalogSessionPrescribedSide({
          sessionNumber: session.sessionNumber,
          title: session.title,
          blocks: session.blocks,
          prescribedSide: undefined,
        }),
      ),
    );
    setSaveError("");
  }, []);

  function updateSessionDraft(sessionNumber: number, prescribedSide: ClinicalPrescribedSide) {
    if (assignmentControllerRef.current.isInFlight()) return;
    setSessionDrafts((prev) =>
      prev.map((session) =>
        session.sessionNumber === sessionNumber
          ? reconcileCatalogSessionPrescribedSide({ ...session, prescribedSide })
          : session,
      ),
    );
  }

  async function handleCatalogAssign() {
    if (!selectedProgram || assignmentControllerRef.current.isInFlight()) return;

    const validation = validateCatalogPrescribedSideDraftForSubmit(sessionDrafts);
    if (!validation.ok) {
      setSaveError(validation.error);
      return;
    }

    const sessionPrescriptions = buildCatalogPlanSessionsPayload(sessionDrafts);
    const fingerprint = buildCatalogAssignmentFingerprint({
      patientId,
      treatmentProgramId: selectedProgram.id,
      assessmentId,
      sessionPrescriptions,
    });

    const attempt = assignmentControllerRef.current.beginSubmitAttempt(fingerprint);
    if (!attempt.ok) return;

    const scopeAtStart = patientScopeRef.current;
    const generationAtStart = attempt.generation;

    setSaving(true);
    setSaveError("");

    assignAbortRef.current?.abort();
    const abort = new AbortController();
    assignAbortRef.current = abort;

    try {
      const res = await fetch("/api/plans/from-catalog-program", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: abort.signal,
        body: JSON.stringify({
          patientId,
          treatmentProgramId: selectedProgram.id,
          assessmentId,
          catalogAssignmentRequestId: attempt.requestId,
          sessions: sessionPrescriptions,
        }),
      });

      if (
        abort.signal.aborted ||
        scopeAtStart !== patientScopeRef.current ||
        generationAtStart !== assignmentControllerRef.current.getGeneration()
      ) {
        return;
      }

      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        if (res.status === 409) {
          assignmentControllerRef.current.completeConflict();
          setSaveError(CATALOG_ASSIGNMENT_IDEMPOTENCY_CONFLICT_MESSAGE);
          setSaving(false);
          return;
        }
        assignmentControllerRef.current.completeFailure();
        throw new Error(mapPlanAssignHttpError(res.status, body));
      }

      assignmentControllerRef.current.completeSuccess(fingerprint);
      if (scopeAtStart === patientScopeRef.current) {
        onAssigned();
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      if (
        scopeAtStart !== patientScopeRef.current ||
        generationAtStart !== assignmentControllerRef.current.getGeneration()
      ) {
        return;
      }
      assignmentControllerRef.current.completeFailure();
      setSaveError(err instanceof Error ? err.message : "Failed to assign catalog program.");
      setSaving(false);
    }
  }

  const controlsDisabled = saving;
  const applicableSessions = sessionDrafts.filter((session) => isApplicableCatalogSession(session));

  return (
    <div className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6 space-y-4">
      <div>
        <h2 className="text-sm font-bold text-white">Rehabilitation catalog program</h2>
        <p className="mt-1 text-xs text-white/35">
          Assign a published catalog program. Interactive Shoulder sessions require an explicit
          prescribed treatment side before submission.
        </p>
      </div>

      {loading && <p className="text-xs text-white/40">Loading catalog programs…</p>}
      {loadError && <p className="text-xs text-red-400/90">{loadError}</p>}

      {!loading && programs.length === 0 && !loadError && (
        <p className="text-xs text-white/40">No published catalog programs are available.</p>
      )}

      {programs.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {programs.map((program) => (
            <button
              key={program.id}
              type="button"
              onClick={() => selectProgram(program)}
              disabled={controlsDisabled}
              className={`rounded-[7px] border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                selectedProgramId === program.id
                  ? "border-[#1D9E75]/40 bg-[#1D9E75]/8"
                  : "border-[#1E2D42] bg-[#0B1220] hover:border-[#1D9E75]/20"
              }`}
            >
              <p className="text-sm font-semibold text-white">{program.name}</p>
              <p className="mt-0.5 text-xs text-white/30">
                {program.sessions.length} session{program.sessions.length === 1 ? "" : "s"}
              </p>
            </button>
          ))}
        </div>
      )}

      {selectedProgram && (
        <div className="space-y-4 border-t border-[#1E2D42] pt-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-white/30">
            Review before assignment
          </p>

          {applicableSessions.length > 0 && (
            <ul className="space-y-1 text-sm text-white/75">
              {applicableSessions.map((session) => (
                <li key={session.sessionNumber}>
                  Session {session.sessionNumber} — {formatPrescribedSideForReview(session.prescribedSide)}
                </li>
              ))}
            </ul>
          )}

          {sessionDrafts.map((session) =>
            isApplicableCatalogSession(session) ? (
              <PrescribedSideSelector
                key={session.sessionNumber}
                groupIdPrefix="catalog"
                sessionLabel={`Session ${session.sessionNumber}`}
                value={session.prescribedSide}
                onChange={(side) => updateSessionDraft(session.sessionNumber, side)}
                disabled={controlsDisabled}
              />
            ) : null,
          )}

          {saveError && (
            <p className="text-xs text-red-400/90" role="alert">
              {saveError === PRESCRIBED_SIDE_UNAVAILABLE_MESSAGE ? saveError : saveError}
            </p>
          )}

          <button
            type="button"
            onClick={handleCatalogAssign}
            disabled={controlsDisabled}
            className="rounded-[7px] bg-[#1D9E75] px-5 py-2.5 text-sm font-bold text-[#0B1220] transition hover:bg-[#5DCAA5] disabled:opacity-50"
          >
            {saving ? "Assigning…" : "Assign catalog program"}
          </button>
        </div>
      )}
    </div>
  );
}
