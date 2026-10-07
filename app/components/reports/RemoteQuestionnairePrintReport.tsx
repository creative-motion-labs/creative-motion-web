import type { PatientAssessmentDraft, PatientSectionId } from "@/app/lib/api/remote-assessments";
import { buildFullClinicianReview } from "@/app/lib/patient-assessment-questions";
import type { RemoteQuestionnaireSummary } from "@/app/lib/remote-questionnaire-summary";
import type { AssessmentInterpretationDraft } from "@/app/lib/reports/assessment-interpretation-draft";
import { AssessmentInterpretationDraftSection } from "@/app/components/reports/AssessmentInterpretationDraftSection";
import { PatientClinicalTranslationDisplay } from "@/app/components/reports/PatientClinicalTranslationDisplay";
import {
  CLINICAL_DISCLAIMER_FULL,
  patientReportedLabel,
  RED_FLAG_PATIENT_REPORTED,
  SAFETY_NONE_DOCUMENTED,
  SAFETY_REVIEW_REQUIRED,
  SECTION_OVERVIEW,
  SECTION_PATIENT_REPORTED_SUMMARY,
  SECTION_SAFETY_INDICATORS,
} from "@/app/lib/reports/clinical-report-copy";
import {
  isTranslatablePatientFieldKey,
  readStoredClinicalTranslation,
} from "@/app/lib/reports/patient-clinical-translation";
import { ReportPrintLayout, ReportPrintSection } from "./ReportPrintLayout";

function PrintFieldRows({
  rows,
}: {
  rows: {
    label: string;
    value: string;
    originalValue?: string;
    clinicalEnglish?: string;
    translationMissing?: boolean;
  }[];
}) {
  if (rows.length === 0) return null;
  return (
    <dl className="divide-y divide-gray-200 border border-gray-200">
      {rows.map((row) => {
        const showBilingual = Boolean(row.originalValue && row.originalValue !== row.value);
        return (
          <div key={row.label} className="px-3 py-2.5">
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{row.label}</dt>
            <dd className="mt-0.5">
              {showBilingual ? (
                <PatientClinicalTranslationDisplay
                  originalText={row.originalValue!}
                  clinicalEnglish={row.clinicalEnglish ?? row.value}
                  variant="print"
                />
              ) : (
                <p className="text-sm leading-relaxed text-gray-900 whitespace-pre-wrap">{row.value}</p>
              )}
              {row.translationMissing ? (
                <p className="mt-2 text-[10px] italic text-amber-800">
                  Clinical English translation unavailable — therapist review required.
                </p>
              ) : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function PrintMetricGrid({
  metrics,
}: {
  metrics: {
    label: string;
    value: string;
    originalValue?: string;
    clinicalEnglish?: string;
    translationMissing?: boolean;
  }[];
}) {
  if (metrics.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {metrics.map((metric) => {
        const showBilingual = Boolean(metric.originalValue && metric.originalValue !== metric.value);
        return (
          <div key={metric.label} className="border border-gray-200 bg-gray-50 px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{metric.label}</p>
            {showBilingual ? (
              <div className="mt-1">
                <PatientClinicalTranslationDisplay
                  originalText={metric.originalValue!}
                  clinicalEnglish={metric.clinicalEnglish ?? metric.value}
                  variant="print"
                />
              </div>
            ) : (
              <p className="mt-1 text-sm font-semibold text-gray-900">{metric.value}</p>
            )}
            {metric.translationMissing ? (
              <p className="mt-1 text-[10px] italic text-amber-800">
                Clinical English translation unavailable — therapist review required.
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PrintSubmittedAnswers({
  patientDraft,
  includedSections,
  submissionMeta,
  assessmentLanguage,
}: {
  patientDraft: PatientAssessmentDraft;
  includedSections: PatientSectionId[];
  submissionMeta?: Record<string, unknown> | null;
  assessmentLanguage?: "en" | "ar" | null;
}) {
  const blocks = buildFullClinicianReview(patientDraft, includedSections);
  if (blocks.length === 0) return null;

  return (
    <div className="space-y-4">
      {blocks.map((block) => (
        <div key={block.section} className="print-document-section border border-gray-200">
          <h3 className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-700">
            {block.sectionTitle}
          </h3>
          <dl className="divide-y divide-gray-200">
            {block.entries.map((entry) => {
              const fieldKey = entry.fieldKey;
              const showBilingual =
                assessmentLanguage === "ar" && isTranslatablePatientFieldKey(fieldKey);
              const clinicalEnglish = showBilingual && fieldKey
                ? readStoredClinicalTranslation(submissionMeta, fieldKey)
                : "";

              return (
                <div key={`${block.section}-${entry.label}`} className="px-3 py-2.5">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    {patientReportedLabel(entry.label)}
                  </dt>
                  <dd className="mt-0.5">
                    {showBilingual ? (
                      <PatientClinicalTranslationDisplay
                        originalText={entry.value}
                        clinicalEnglish={clinicalEnglish}
                        variant="print"
                      />
                    ) : (
                      <p className="text-sm leading-relaxed text-gray-900 whitespace-pre-wrap">
                        {entry.value}
                      </p>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </div>
  );
}

type Props = {
  summary: RemoteQuestionnaireSummary;
  interpretationDraft: AssessmentInterpretationDraft;
  patientName: string;
  patientId: string;
  assessmentId?: string;
  clinicianNotes?: string | null;
  submissionMeta?: Record<string, unknown> | null;
  assessmentLanguage?: "en" | "ar" | null;
};

export function RemoteQuestionnairePrintReport({
  summary,
  interpretationDraft,
  patientName,
  patientId,
  assessmentId,
  clinicianNotes,
  submissionMeta = null,
  assessmentLanguage = null,
}: Props) {
  const notes = clinicianNotes?.trim() ?? "";
  const hasSummaryContent =
    summary.metrics.length > 0 || summary.rows.length > 0;
  const hasAnswers = summary.includedSections.length > 0;

  return (
    <ReportPrintLayout
      meta={{
        assessmentTypeLabel: "Remote questionnaire",
        sourceLabel: "Patient-reported",
        patientName,
        patientId,
        assessmentId,
        submittedDate: summary.submittedAt,
      }}
    >
      <ReportPrintSection title={SECTION_OVERVIEW}>
        {summary.clinicalTranslationWarning ? (
          <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
            {summary.clinicalTranslationWarning}
          </p>
        ) : null}
        <PrintMetricGrid metrics={summary.metrics} />
        {hasSummaryContent ? <PrintFieldRows rows={summary.rows} /> : null}
      </ReportPrintSection>

      <ReportPrintSection title={SECTION_SAFETY_INDICATORS}>
        {summary.hasRedFlag ? (
          <div className="rounded border border-amber-400 bg-amber-50 px-3 py-2.5 space-y-2">
            <p className="text-sm font-semibold text-amber-900">{RED_FLAG_PATIENT_REPORTED}</p>
            <p className="text-sm text-amber-900">{SAFETY_REVIEW_REQUIRED}</p>
          </div>
        ) : (
          <p className="text-sm text-gray-800">{SAFETY_NONE_DOCUMENTED}</p>
        )}
      </ReportPrintSection>

      {hasAnswers ? (
        <ReportPrintSection title={SECTION_PATIENT_REPORTED_SUMMARY}>
          <PrintSubmittedAnswers
            patientDraft={summary.patientDraft}
            includedSections={summary.includedSections}
            submissionMeta={submissionMeta}
            assessmentLanguage={assessmentLanguage}
          />
        </ReportPrintSection>
      ) : null}

      <AssessmentInterpretationDraftSection draft={interpretationDraft} variant="print" />

      {notes ? (
        <ReportPrintSection title="Therapist-entered clinical note">
          <p className="text-sm leading-relaxed text-gray-900 whitespace-pre-wrap">{notes}</p>
        </ReportPrintSection>
      ) : null}

      <section className="print-document-section">
        <p className="rounded border border-gray-300 bg-gray-50 px-3 py-2.5 text-[11px] leading-relaxed text-gray-700">
          {CLINICAL_DISCLAIMER_FULL}
        </p>
      </section>
    </ReportPrintLayout>
  );
}
