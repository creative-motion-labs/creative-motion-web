"use client";

import { useEffect, useMemo, useState } from "react";
import {
  clinicalEnglishForStrokeDisplay,
  STROKE_SECTION_TITLES,
  strokeQuestionById,
  isStrokeQuestionnaireData,
  type StrokeQuestionnaireSubmission,
} from "@/app/lib/stroke-questionnaire/stroke-questionnaire-schema";
import {
  sanitizeStrokeReportForSourceSafety,
  STROKE_PT_REPORT_APPENDIX_SECTION_ID,
  type StrokePtClinicalReport,
} from "@/app/lib/stroke-questionnaire/stroke-pt-clinical-report";

type Props = {
  assessmentId: string;
  structuredData: StrokeQuestionnaireSubmission;
  patientId?: string;
  onStructuredDataUpdated: (next: Record<string, unknown>) => void;
};

export function StrokeQuestionnaireClinicianPanel({
  assessmentId,
  structuredData,
  patientId,
  onStructuredDataUpdated,
}: Props) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [clinicalEnglishEdits, setClinicalEnglishEdits] = useState<Record<string, string>>({});
  const translationStatus = structuredData.strokeWorkflow.translation.status;
  const reportStatus = structuredData.strokeWorkflow.report.status;
  const storedReport = ((structuredData as unknown as Record<string, unknown>)
    .strokePtClinicalReportFinal ??
    (structuredData as unknown as Record<string, unknown>)
      .strokePtClinicalReportDraft) as StrokePtClinicalReport | undefined;
  const report = useMemo(
    () =>
      storedReport
        ? sanitizeStrokeReportForSourceSafety(storedReport, structuredData)
        : undefined,
    [storedReport, structuredData],
  );
  const [reportEdit, setReportEdit] = useState<StrokePtClinicalReport | null>(report ?? null);
  const responseRows = useMemo(
    () =>
      Object.entries(structuredData.responses).filter(([, response]) =>
        Array.isArray(response.rawValue)
          ? response.rawValue.length > 0
          : response.rawValue.trim().length > 0,
      ),
    [structuredData.responses],
  );

  useEffect(() => {
    setClinicalEnglishEdits(
      Object.fromEntries(
        Object.entries(structuredData.responses)
          .filter(([id, response]) =>
            Boolean(clinicalEnglishForStrokeDisplay(id, response)),
          )
          .map(([id, response]) => [
            id,
            clinicalEnglishForStrokeDisplay(id, response) ?? "",
          ]),
      ),
    );
  }, [structuredData.responses]);

  useEffect(() => {
    setReportEdit(report ?? null);
  }, [report]);

  async function run(endpoint: string, body: Record<string, unknown>, action: string) {
    setBusy(action);
    setError("");
    try {
      const response = await fetch(
        `/api/assessments/${encodeURIComponent(assessmentId)}/${endpoint}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        submission?: StrokeQuestionnaireSubmission;
      };
      if (!response.ok) throw new Error(data.error ?? "Action failed.");
      if (data.submission) {
        onStructuredDataUpdated(data.submission as unknown as Record<string, unknown>);
      } else {
        const refreshed = await fetch(`/api/assessments/${encodeURIComponent(assessmentId)}`);
        const detail = (await refreshed.json()) as { structured_data?: Record<string, unknown> };
        if (detail.structured_data) onStructuredDataUpdated(detail.structured_data);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="space-y-4 rounded-[10px] border border-[#1E2D42] bg-[#0B1220] p-5">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#5DCAA5]">
          Remote Neurorehabilitation Intake
        </p>
        <h3 className="mt-1 text-base font-bold text-white">Stroke Questionnaire v1</h3>
        <p className="mt-1 text-xs text-white/45">
          Patient- and caregiver-reported information. Not objective examination findings.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Status label="Safety gate" value={structuredData.safetyState} />
        <Status label="Clinical English" value={translationStatus} />
        <Status label="Stroke PT report" value={reportStatus} />
      </div>

      {structuredData.safetyState !== "PASS" ? (
        <p className="rounded-lg border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          {structuredData.safetyState === "URGENT_ESCALATION"
            ? "Urgent escalation response recorded. Do not authorize performance assessment from this intake."
            : "Clinician safety review is required before considering performance assessment."}
        </p>
      ) : (
        <p className="text-xs text-white/40">
          PASS reflects the intake safety gate only and is not medical clearance for exercise.
        </p>
      )}

      <details open className="border-t border-[#1E2D42] pt-3">
        <summary className="cursor-pointer text-sm font-bold text-white">
          Original responses and Clinical English
        </summary>
        <p className="mt-2 text-[10px] italic text-white/35">
          AI-assisted Clinical English must preserve reporter provenance and requires clinician review.
        </p>
        <div className="mt-3 space-y-3">
          {responseRows.map(([id, response]) => {
            const question = strokeQuestionById(id);
            return (
              <div key={id} className="rounded-lg border border-[#1E2D42] p-3">
                <p className="text-[10px] uppercase tracking-wider text-white/35">
                  {question ? STROKE_SECTION_TITLES[question.sectionId].en : id} · {response.provenance}
                </p>
                <p className="mt-1 text-xs font-semibold text-white/75">{question?.en ?? id}</p>
                <p className="mt-2 text-sm text-white/75">
                  {Array.isArray(response.rawValue)
                    ? response.rawValue.join(", ")
                    : response.rawValue}
                </p>
                {clinicalEnglishForStrokeDisplay(id, response) ? (
                  <textarea
                    aria-label={`Clinical English for ${question?.en ?? id}`}
                    value={
                      clinicalEnglishEdits[id] ??
                      clinicalEnglishForStrokeDisplay(id, response)
                    }
                    disabled={translationStatus === "approved"}
                    onChange={(event) =>
                      setClinicalEnglishEdits((current) => ({
                        ...current,
                        [id]: event.target.value,
                      }))
                    }
                    rows={2}
                    className="mt-2 w-full resize-y rounded-md border border-[#1D9E75]/30 bg-[#07111E] px-3 py-2 text-sm text-[#B8F0DC] disabled:opacity-80"
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </details>

      <div className="flex flex-wrap gap-2">
        {translationStatus !== "approved" ? (
          <>
            <Action
              label={busy === "translate" ? "Generating…" : "Generate Clinical English"}
              disabled={Boolean(busy)}
              onClick={() =>
                void run("translate-stroke-questionnaire", {}, "translate")
              }
            />
            {translationStatus === "review_required" ? (
              <>
                <Action
                  label={busy === "save-translation" ? "Saving…" : "Save Clinical English edits"}
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run(
                      "translate-stroke-questionnaire",
                      {
                        saveFieldEdits: Object.entries(clinicalEnglishEdits).map(
                          ([fieldId, clinicalEnglish]) => ({
                            fieldId,
                            clinicalEnglish,
                          }),
                        ),
                      },
                      "save-translation",
                    )
                  }
                />
                <Action
                  label={busy === "approve" ? "Approving…" : "Approve Clinical English"}
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run(
                      "translate-stroke-questionnaire",
                      { approve: true },
                      "approve",
                    )
                  }
                />
              </>
            ) : null}
          </>
        ) : null}
        {translationStatus === "approved" && reportStatus === "not_generated" ? (
          <Action
            label={busy === "report" ? "Generating…" : "Generate Stroke PT Report"}
            disabled={Boolean(busy)}
            onClick={() =>
              void run("stroke-pt-clinical-report", {}, "report")
            }
          />
        ) : null}
        {reportStatus === "draft_ready" ? (
          <>
            <Action
              label={busy === "save-report" ? "Saving…" : "Save report edits"}
              disabled={Boolean(busy) || !reportEdit}
              onClick={() =>
                void run(
                  "stroke-pt-clinical-report",
                  { saveDraftEdits: reportEdit },
                  "save-report",
                )
              }
            />
            <Action
              label={busy === "finalize" ? "Finalizing…" : "Finalize Stroke PT Report"}
              disabled={Boolean(busy)}
              onClick={() =>
                void run(
                  "stroke-pt-clinical-report",
                  { finalize: true },
                  "finalize",
                )
              }
            />
          </>
        ) : null}
        {reportStatus === "finalized" && patientId ? (
          <a
            href={`/clinician/assessment/report?patientId=${encodeURIComponent(patientId)}&assessmentId=${encodeURIComponent(assessmentId)}`}
            className="rounded-[6px] bg-[#1D9E75] px-3.5 py-[6px] text-[11px] font-medium text-white"
          >
            Export / Print PDF
          </a>
        ) : null}
      </div>

      {reportEdit ? (
        <StrokeReportDisplay
          report={reportEdit}
          editable={reportStatus === "draft_ready"}
          onReportChange={setReportEdit}
          collapseAppendix
        />
      ) : null}
      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
    </section>
  );
}

function Status({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#1E2D42] bg-[#0F1825] px-3 py-2">
      <p className="text-[10px] uppercase text-white/35">{label}</p>
      <p className="mt-1 text-xs font-semibold text-white">{value.replaceAll("_", " ")}</p>
    </div>
  );
}

function Action({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-[6px] bg-[#1D9E75] px-3.5 py-[6px] text-[11px] font-medium text-white disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function compactDisplayedStrokeLine(text: string): string {
  const match = text.match(/^(Patient|Caregiver)-reported response — (.+): (.+)$/);
  if (!match) return text;
  const who = match[1] === "Caregiver" ? "caregiver-reported" : "patient-reported";
  const answer = match[3].replace(/\.$/, "");
  const question = match[2];
  const difficulty = question.match(
    /^How much difficulty (?:is there |does the patient have )?(.+)$/i,
  );
  const topic = difficulty
    ? difficulty[1].replace(/^(with|there) (the )?/i, "")
    : question.replace(/\?$/, "");
  return `${topic}: ${answer} (${who}).`;
}

export function StrokeReportDisplay({
  report,
  editable = false,
  onReportChange,
  collapseAppendix = false,
}: {
  report: StrokePtClinicalReport;
  editable?: boolean;
  onReportChange?: (report: StrokePtClinicalReport) => void;
  collapseAppendix?: boolean;
}) {
  function updateSection(
    sectionIndex: number,
    key: "paragraphs" | "bullets",
    itemIndex: number,
    value: string,
  ) {
    if (!onReportChange) return;
    const sections = report.sections.map((section, index) => {
      if (index !== sectionIndex) return section;
      const items = [...section[key]];
      items[itemIndex] = value;
      return { ...section, [key]: items };
    });
    onReportChange({ ...report, sections });
  }

  const mainSections = report.sections.filter(
    (section) => section.id !== STROKE_PT_REPORT_APPENDIX_SECTION_ID,
  );
  const appendixSection = report.sections.find(
    (section) => section.id === STROKE_PT_REPORT_APPENDIX_SECTION_ID,
  );
  const appendixIndex = report.sections.findIndex(
    (section) => section.id === STROKE_PT_REPORT_APPENDIX_SECTION_ID,
  );

  function renderSectionBody(
    section: StrokePtClinicalReport["sections"][number],
    index: number,
    compact = true,
    twoColumnPrint = false,
  ) {
    const paragraphClass = compact
      ? "mt-0.5 text-[13px] leading-snug text-white/80 print:text-[10pt] print:leading-snug print:text-gray-900"
      : "mt-1 text-sm leading-relaxed text-white/80 print:text-gray-900";
    const listClass = compact
      ? `mt-0.5 list-outside list-disc space-y-0 pl-4 text-[13px] leading-snug text-white/80 print:text-[10pt] print:leading-snug print:text-gray-900${
          twoColumnPrint ? " print:columns-2 print:gap-x-6" : ""
        }`
      : "mt-1 list-inside list-disc text-sm text-white/80 print:text-gray-900";
    const inputClass = compact
      ? "mt-0.5 w-full rounded-md border border-[#1E2D42] bg-[#07111E] px-2 py-1 text-[13px] leading-snug text-white/80 print:text-gray-900"
      : "mt-1 w-full rounded-md border border-[#1E2D42] bg-[#07111E] px-2 py-1.5 text-sm text-white/80 print:text-gray-900";

    return (
      <>
        {section.paragraphs.map((paragraph, paragraphIndex) => (
          editable ? (
            <textarea
              key={`${section.id}-paragraph-${paragraphIndex}`}
              aria-label={`${section.title} paragraph ${paragraphIndex + 1}`}
              value={paragraph}
              onChange={(event) =>
                updateSection(index, "paragraphs", paragraphIndex, event.target.value)
              }
              rows={2}
              className={inputClass}
            />
          ) : (
            <p
              key={`${section.id}-paragraph-${paragraphIndex}`}
              className={paragraphClass}
            >
              {compact ? compactDisplayedStrokeLine(paragraph) : paragraph}
            </p>
          )
        ))}
        {section.bullets.length > 0 ? (
          editable ? (
            <div className="mt-0.5 space-y-1">
              {section.bullets.map((bullet, bulletIndex) => (
                <textarea
                  key={`${section.id}-bullet-${bulletIndex}`}
                  aria-label={`${section.title} item ${bulletIndex + 1}`}
                  value={bullet}
                  onChange={(event) =>
                    updateSection(index, "bullets", bulletIndex, event.target.value)
                  }
                  rows={2}
                  className={inputClass}
                />
              ))}
            </div>
          ) : (
            <ul className={listClass}>
              {section.bullets.map((bullet) => (
                <li key={bullet} className={compact ? "break-inside-avoid print:break-inside-avoid" : undefined}>
                  {compact ? compactDisplayedStrokeLine(bullet) : bullet}
                </li>
              ))}
            </ul>
          )
        ) : section.id === "objective_examination" ? (
          <p className="mt-0.5 text-[13px] italic leading-snug text-white/35 print:text-[10pt] print:text-gray-600">
            No clinician-observed or objectively measured examination data recorded.
          </p>
        ) : null}
      </>
    );
  }

  const appendixBody = appendixSection ? (
    <section className="break-before-page print:break-before-page">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/40 print:text-gray-500">
        {appendixSection.title}
      </h4>
      <p className="mt-1 text-xs text-white/45 print:text-gray-600">
        Complete patient- and caregiver-reported responses for source traceability.
        This appendix is not an objective examination.
      </p>
      {renderSectionBody(appendixSection, appendixIndex, false)}
    </section>
  ) : null;

  const visibleMainSections = mainSections.filter((section) => {
    if (section.id === "objective_examination" || section.id === "clinical_disclaimer") {
      return true;
    }
    return section.paragraphs.length > 0 || section.bullets.length > 0;
  });

  return (
    <div className="border-t border-[#1E2D42] pt-3 print:border-0 print:pt-0">
      <h3 className="text-base font-bold text-white print:text-[13pt] print:text-gray-950">{report.title}</h3>
      <div className="stroke-pt-main mt-2 space-y-2 print:mt-1.5 print:space-y-1.5">
        {visibleMainSections.map((section) => {
          const index = report.sections.findIndex((item) => item.id === section.id);
          const denseFacts =
            section.id === "upper_limb_hand_function" ||
            section.id === "mobility_transfers_balance_falls" ||
            section.id === "sensation_fatigue_pain";
          return (
            <section key={section.id} className={denseFacts ? "" : "print:break-inside-avoid"}>
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/40 print:mb-0.5 print:text-[8.5pt] print:text-gray-500">
                {section.title}
              </h4>
              {renderSectionBody(section, index, true, denseFacts)}
            </section>
          );
        })}
      </div>
      {appendixBody && collapseAppendix ? (
        <details className="mt-3 rounded-lg border border-[#1E2D42] px-3 py-2 print:mt-0 print:border-0 print:p-0">
          <summary className="cursor-pointer text-sm font-bold text-white print:hidden">
            {appendixSection?.title}
          </summary>
          <div className="mt-3 print:mt-0">{appendixBody}</div>
        </details>
      ) : (
        appendixBody
      )}
    </div>
  );
}

export function isStrokeClinicianData(value: unknown): value is StrokeQuestionnaireSubmission {
  return isStrokeQuestionnaireData(value);
}
