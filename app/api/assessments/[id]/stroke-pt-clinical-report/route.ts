import { NextResponse, type NextRequest } from "next/server";
import { AI_ERROR_CODES } from "@/app/lib/ai/ai-errors";
import {
  aiErrorJson,
  loadRemoteQuestionnaireAssessment,
  saveAssessmentStructuredData,
} from "@/app/lib/reports/assessment-workflow-route-auth";
import {
  buildStrokePtClinicalReport,
  type StrokePtClinicalReport,
} from "@/app/lib/stroke-questionnaire/stroke-pt-clinical-report";
import {
  isStrokeQuestionnaireData,
  type StrokeQuestionnaireSubmission,
} from "@/app/lib/stroke-questionnaire/stroke-questionnaire-schema";

type Body = {
  finalize?: unknown;
  saveDraftEdits?: unknown;
};

function isStrokeReport(value: unknown): value is StrokePtClinicalReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  return report.schemaVersion === 1 && Array.isArray(report.sections);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id?.trim()) return aiErrorJson(AI_ERROR_CODES.AI_INVALID_INPUT);
  const loaded = await loadRemoteQuestionnaireAssessment(id);
  if (!loaded.ok) return loaded.response;
  const { assessment, adminClient } = loaded;
  if (!isStrokeQuestionnaireData(assessment.structured_data)) {
    return aiErrorJson(AI_ERROR_CODES.AI_CONTEXT_INVALID);
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }
  const submission: StrokeQuestionnaireSubmission = {
    ...assessment.structured_data,
    responses: { ...assessment.structured_data.responses },
  };
  if (submission.strokeWorkflow.translation.status !== "approved") {
    return NextResponse.json(
      { error: "Approved Clinical English is required before report generation." },
      { status: 400 },
    );
  }
  if (
    submission.strokeWorkflow.report.status === "finalized" &&
    body.finalize !== true
  ) {
    return NextResponse.json(
      { error: "The finalized Stroke PT report is read-only." },
      { status: 400 },
    );
  }

  const existingDraft = (submission as unknown as Record<string, unknown>)
    .strokePtClinicalReportDraft;
  let report: StrokePtClinicalReport;
  let status: "draft_ready" | "finalized";
  const now = new Date().toISOString();

  if (body.finalize === true) {
    if (!isStrokeReport(existingDraft)) {
      return NextResponse.json({ error: "No Stroke PT report draft exists." }, { status: 400 });
    }
    report = {
      ...existingDraft,
      lifecycleNote: "Clinician-reviewed/finalized report.",
    };
    status = "finalized";
  } else if (isStrokeReport(body.saveDraftEdits)) {
    report = body.saveDraftEdits;
    status = "draft_ready";
  } else {
    report = buildStrokePtClinicalReport(submission);
    status = "draft_ready";
  }

  const nextData = {
    ...submission,
    strokeWorkflow: {
      ...submission.strokeWorkflow,
      report: { status },
    },
    strokePtClinicalReportDraft: report,
    ...(status === "finalized"
      ? { strokePtClinicalReportFinal: report, strokePtClinicalReportFinalizedAt: now }
      : { strokePtClinicalReportGeneratedAt: report.generatedAt }),
  };
  const saved = await saveAssessmentStructuredData(
    adminClient,
    assessment.id,
    assessment.provider_id,
    nextData,
  );
  if (!saved.ok) return saved.response;
  return NextResponse.json({ report, status });
}
