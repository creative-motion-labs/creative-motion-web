"use client";

import { useCallback, useEffect, useState } from "react";
import type { AssessmentDetailResponse } from "@/app/api/assessments/[id]/route";
import type { BackendPatient } from "@/app/lib/api";
import type { AssessmentData } from "@/app/lib/assessment-types";
import { loadGeneralAssessmentDraft } from "@/app/lib/general-assessment/storage";
import type { GeneralAssessmentDraft } from "@/app/lib/general-assessment/types";
import type { PatientAssessmentDraft, PatientSectionId } from "@/app/lib/api/remote-assessments";
import {
  type AssessmentReportKind,
  resolveAssessmentReportFromDetail,
} from "@/app/lib/reports/assessment-report-resolver";
import type { RemoteUpperLimbBatteryPayload } from "@/app/lib/remote-upper-limb-battery/types";

export type UseAssessmentReportLoadArgs = {
  assessmentId: string | null;
  patientIdParam: string | null;
  isDraftMeaningful: (draft: GeneralAssessmentDraft) => boolean;
};

export type UseAssessmentReportLoadResult = {
  loading: boolean;
  loadError: string;
  reportKind: AssessmentReportKind | null;
  draft: GeneralAssessmentDraft | null;
  remoteQuestionnaireDraft: PatientAssessmentDraft | null;
  remoteSubmissionMeta: Record<string, unknown> | null;
  remoteIncludedSections: PatientSectionId[];
  structuredData: AssessmentData | null;
  remoteUpperLimbBattery: RemoteUpperLimbBatteryPayload | null;
  patient: BackendPatient | null;
  resolvedPatientId: string;
  serverNotes: string | null;
  reportDate: string;
  serverBacked: boolean;
  patientAnsweredInArabic: boolean;
  reload: () => void;
};

const EMPTY: UseAssessmentReportLoadResult = {
  loading: true,
  loadError: "",
  reportKind: null,
  draft: null,
  remoteQuestionnaireDraft: null,
  remoteSubmissionMeta: null,
  remoteIncludedSections: [],
  structuredData: null,
  remoteUpperLimbBattery: null,
  patient: null,
  resolvedPatientId: "",
  serverNotes: null,
  reportDate: "",
  serverBacked: false,
  patientAnsweredInArabic: false,
  reload: () => {},
};

export function useAssessmentReportLoad({
  assessmentId,
  patientIdParam,
  isDraftMeaningful,
}: UseAssessmentReportLoadArgs): UseAssessmentReportLoadResult {
  const [state, setState] = useState<UseAssessmentReportLoadResult>(EMPTY);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState((prev) => ({
        ...prev,
        loading: true,
        loadError: "",
        reportKind: null,
        draft: null,
        remoteQuestionnaireDraft: null,
        remoteSubmissionMeta: null,
        remoteIncludedSections: [],
        structuredData: null,
        remoteUpperLimbBattery: null,
        serverBacked: false,
        patientAnsweredInArabic: false,
        reload,
      }));

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
          setState({
            loading: false,
            loadError: resolved.loadError,
            reportKind: resolved.kind,
            draft: resolved.draft,
            remoteQuestionnaireDraft: resolved.remoteQuestionnaireDraft,
            remoteSubmissionMeta: resolved.remoteSubmissionMeta,
            remoteIncludedSections: resolved.remoteIncludedSections,
            structuredData: resolved.structuredData,
            remoteUpperLimbBattery: resolved.remoteUpperLimbBattery,
            patient: resolved.patient,
            resolvedPatientId: resolved.resolvedPatientId,
            serverNotes: resolved.serverNotes,
            reportDate: resolved.reportDate,
            serverBacked: resolved.serverBacked,
            patientAnsweredInArabic: resolved.patientAnsweredInArabic,
            reload,
          });
        } catch (err) {
          if (!cancelled) {
            setState({
              ...EMPTY,
              loading: false,
              loadError: err instanceof Error ? err.message : "Failed to load assessment.",
              reload,
            });
          }
        }
        return;
      }

      if (!patientIdParam) {
        if (!cancelled) {
          setState({ ...EMPTY, loading: false, reload });
        }
        return;
      }

      const d = loadGeneralAssessmentDraft(patientIdParam);
      if (!cancelled) {
        setState({
          ...EMPTY,
          loading: false,
          reportKind: "general_msk",
          draft: isDraftMeaningful(d) ? d : null,
          resolvedPatientId: patientIdParam,
          reportDate: d.updatedAt,
          reload,
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [assessmentId, patientIdParam, isDraftMeaningful, reload, reloadToken]);

  return state;
}
