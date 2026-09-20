"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RemoteAssessmentRequest } from "@/app/lib/api/remote-assessments";
import { submitRemoteAssessment } from "@/app/lib/api/remote-assessments";
import {
  buildStrokeActiveScreenQueue,
  buildStrokeBranchTrace,
  resolveStrokeSafetyState,
  visibleStrokeQuestions,
  visibleStrokeSections,
} from "@/app/lib/stroke-questionnaire/stroke-branch-engine";
import {
  STROKE_PATHWAY,
  STROKE_QUESTIONNAIRE_KIND,
  STROKE_QUESTIONNAIRE_VERSION,
  STROKE_SECTION_TITLES,
  compactStrokeResponsesForSubmission,
  strokeQuestionById,
  type StrokeQuestionDefinition,
  type StrokeResponse,
} from "@/app/lib/stroke-questionnaire/stroke-questionnaire-schema";
import { LanguageToggle, type PatientLang } from "@/app/components/patient/LanguageToggle";

type Props = {
  token: string;
  request: RemoteAssessmentRequest;
};

function label(question: StrokeQuestionDefinition, lang: PatientLang): string {
  return lang === "ar" ? question.ar : question.en;
}

function displayRawValue(response: StrokeResponse): string {
  return Array.isArray(response.rawValue)
    ? response.rawValue.join(", ")
    : response.rawValue;
}

export function StrokeQuestionnaireClient({ token }: Props) {
  const router = useRouter();
  const [lang, setLang] = useState<PatientLang>("en");
  const [responses, setResponses] = useState<Record<string, StrokeResponse>>({});
  const [screenIndex, setScreenIndex] = useState(0);
  const [displayProgress, setDisplayProgress] = useState(0);
  const [showSecondGoal, setShowSecondGoal] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const screens = useMemo(
    () => buildStrokeActiveScreenQueue(responses),
    [responses],
  );
  const sections = useMemo(() => visibleStrokeSections(responses), [responses]);
  const safeScreenIndex = Math.min(screenIndex, Math.max(0, screens.length - 1));
  const currentScreen = screens[safeScreenIndex] ?? screens[0];
  const questions = useMemo(
    () => {
      const questionIds =
        currentScreen.id === "goals" && showSecondGoal
          ? Array.from(new Set([...currentScreen.questionIds, "goal_second"]))
          : currentScreen.questionIds;
      return questionIds
        .map(strokeQuestionById)
        .filter((question): question is StrokeQuestionDefinition => Boolean(question));
    },
    [currentScreen, showSecondGoal],
  );
  const safetyState = resolveStrokeSafetyState(responses);
  const informationSource = Array.isArray(responses.sc_information_source?.rawValue)
    ? ""
    : responses.sc_information_source?.rawValue;
  const caregiverDefault = informationSource === "caregiver";

  function updateResponse(
    question: StrokeQuestionDefinition,
    rawValue: string | string[],
  ) {
    const reporterRole = caregiverDefault ? "caregiver" : "patient";
    setResponses((current) => ({
      ...current,
      [question.id]: {
        rawValue,
        rawLanguage: lang,
        responseMethod:
          question.kind === "short_text" ||
          question.kind === "long_text" ||
          question.kind === "date"
            ? "text"
            : "selection",
        provenance:
          reporterRole === "caregiver" ? "CAREGIVER_REPORTED" : "PATIENT_REPORTED",
        reporterRole,
        translation: { status: "not_generated" },
      },
    }));
  }

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      await submitRemoteAssessment(
        token,
        {
          questionnaireKind: STROKE_QUESTIONNAIRE_KIND,
          questionnaireVersion: STROKE_QUESTIONNAIRE_VERSION,
          pathway: STROKE_PATHWAY,
          assessmentLanguage: lang,
          safetyState,
          responses: compactStrokeResponsesForSubmission(responses),
          branchTrace: buildStrokeBranchTrace(responses),
        },
        lang,
      );
      router.push(`/assessment/${token}/complete`);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Could not submit the intake.",
      );
      setSubmitting(false);
    }
  }

  if (safetyState === "URGENT_ESCALATION" && currentScreen.id === "safety") {
    return (
      <main
        className="min-h-screen bg-[#071a2f] px-5 py-12 text-white"
        dir={lang === "ar" ? "rtl" : "ltr"}
      >
        <div className="mx-auto max-w-xl rounded-2xl border border-rose-300/30 bg-rose-400/10 p-6">
          <h1 className="text-xl font-bold">
            {lang === "ar" ? "تصعيد عاجل للسلامة" : "Urgent safety escalation"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-rose-50">
            {lang === "ar"
              ? "قد تشير هذه الإجابات إلى الحاجة لمراجعة طبية عاجلة. لا تنفذ اختبارات حركة تأهيلية. تواصل الآن مع خدمات الطوارئ المحلية أو الفريق الطبي المعالج."
              : "These answers may indicate a need for urgent medical review. Do not perform rehabilitation movement tests. Contact local emergency services or the treating medical team now."}
          </p>
          <p className="mt-3 text-xs text-rose-100/75">
            {lang === "ar"
              ? "نتيجة هذا الاستبيان لا تشخّص سكتة جديدة أو أي حالة أخرى."
              : "This intake result does not diagnose a new stroke or any other condition."}
          </p>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            className="mt-5 rounded-lg bg-rose-200 px-4 py-2 text-sm font-bold text-rose-950 disabled:opacity-50"
          >
            {submitting
              ? lang === "ar"
                ? "جارٍ الإرسال…"
                : "Sending…"
              : lang === "ar"
                ? "إرسال إجابات السلامة للعيادة"
                : "Send safety responses to clinic"}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen bg-[#071a2f] px-5 py-8 text-white"
      dir={lang === "ar" ? "rtl" : "ltr"}
    >
      <div className="mx-auto max-w-2xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">
              RASQ
            </p>
            <h1 className="mt-1 text-xl font-bold">
              {lang === "ar"
                ? "استبيان التأهيل العصبي عن بُعد"
                : "Remote Neurorehabilitation Intake"}
            </h1>
          </div>
          <LanguageToggle current={lang} onChange={setLang} />
        </header>

        {!reviewing ? (
          <div className="mb-6">
            <div className="flex items-center justify-between text-[11px] font-semibold text-white/45">
              <span>
                {currentScreen.phase === "core"
                  ? lang === "ar"
                    ? "الملف الوظيفي الأساسي"
                    : "Core functional profile"
                  : lang === "ar"
                    ? "أسئلة مختارة لك"
                    : "Questions selected for you"}
              </span>
              <span>{displayProgress}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-cyan-300 transition-[width] duration-300"
                style={{ width: `${displayProgress}%` }}
              />
            </div>
          </div>
        ) : null}

        {safetyState === "REQUIRES_CLINICIAN_REVIEW" ? (
          <div className="mb-5 rounded-xl border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-50">
            {lang === "ar"
              ? "يجب أن يراجع الطبيب أو المعالج مخاوف السلامة المذكورة. هذا لا يعني أن المريض مصرح له بالتمرين."
              : "A clinician should review the reported safety concern. This does not mean the patient is cleared for exercise."}
          </div>
        ) : null}

        {!reviewing ? (
          <>
            <div className="mb-5">
              <p className="text-xs text-white/45">
                {lang === "ar" ? "الخطوة" : "Step"} {safeScreenIndex + 1} / {screens.length}
              </p>
              <h2 className="mt-1 text-2xl font-bold">
                {currentScreen.title[lang]}
              </h2>
              {currentScreen.id === "safety" ? (
                <p className="mt-2 text-sm text-white/55">
                  {lang === "ar"
                    ? "تعني PASS فقط أنه لم يتم اختيار سبب للتصعيد في هذا الاستبيان. وهي لا تعني تصريحاً طبياً لممارسة التمارين."
                    : "PASS means only that no escalation trigger was selected in this intake. It is not medical clearance for exercise."}
                </p>
              ) : null}
            </div>

            <div className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              {questions.map((question) => (
                <StrokeQuestion
                  key={question.id}
                  question={question}
                  lang={lang}
                  response={responses[question.id]}
                  onChange={(value) => updateResponse(question, value)}
                />
              ))}
              {currentScreen.id === "goals" &&
              !showSecondGoal &&
              !responses.goal_second ? (
                <button
                  type="button"
                  onClick={() => setShowSecondGoal(true)}
                  className="min-h-11 w-full rounded-xl border border-dashed border-cyan-300/30 px-4 py-2.5 text-sm font-semibold text-cyan-100"
                >
                  {lang === "ar" ? "إضافة هدف ثانٍ (اختياري)" : "Add a second goal (optional)"}
                </button>
              ) : null}
            </div>

            <div className="mt-6 flex gap-3">
              {safeScreenIndex > 0 ? (
                <button
                  type="button"
                  onClick={() => setScreenIndex(safeScreenIndex - 1)}
                  className="min-h-12 flex-1 rounded-xl border border-white/15 py-3 text-sm font-semibold"
                >
                  {lang === "ar" ? "السابق" : "Previous"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (safeScreenIndex < screens.length - 1) {
                    const nextIndex = safeScreenIndex + 1;
                    setDisplayProgress((current) =>
                      Math.max(
                        current,
                        Math.min(
                          96,
                          Math.round(((nextIndex + 1) / screens.length) * 100),
                        ),
                      ),
                    );
                    setScreenIndex(nextIndex);
                  } else {
                    setDisplayProgress(100);
                    setReviewing(true);
                  }
                }}
                className="min-h-12 flex-1 rounded-xl bg-cyan-300 py-3 text-sm font-bold text-slate-950"
              >
                {safeScreenIndex < screens.length - 1
                  ? lang === "ar"
                    ? "التالي"
                    : "Next"
                  : lang === "ar"
                    ? "مراجعة الإجابات"
                    : "Review answers"}
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-5">
            <h2 className="text-2xl font-bold">
              {lang === "ar" ? "مراجعة الإجابات" : "Review responses"}
            </h2>
            <p className="text-sm text-white/60">
              {lang === "ar"
                ? "تبقى المعلومات موسومة بأنها من إفادة المريض أو مقدم الرعاية."
                : "Information remains tagged as patient- or caregiver-reported."}
            </p>
            {sections.map((sectionId) => (
              <section
                key={sectionId}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
              >
                <h3 className="font-bold">{STROKE_SECTION_TITLES[sectionId][lang]}</h3>
                <dl className="mt-3 space-y-3">
                  {visibleStrokeQuestions(sectionId, responses)
                    .filter((question) => !question.navigationOnly)
                    .filter((question) => responses[question.id])
                    .map((question) => (
                      <div key={question.id}>
                        <dt className="text-xs text-white/45">{label(question, lang)}</dt>
                        <dd className="mt-1 text-sm text-white/85">
                          {displayRawValue(responses[question.id])}
                          <span className="ml-2 text-[10px] text-cyan-300/70">
                            {responses[question.id].provenance}
                          </span>
                        </dd>
                      </div>
                    ))}
                </dl>
              </section>
            ))}
            {error ? <p className="text-sm text-rose-200">{error}</p> : null}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setReviewing(false)}
                className="flex-1 rounded-xl border border-white/15 py-3 text-sm font-semibold"
              >
                {lang === "ar" ? "تعديل" : "Edit"}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submit()}
                className="flex-1 rounded-xl bg-cyan-300 py-3 text-sm font-bold text-slate-950 disabled:opacity-50"
              >
                {submitting
                  ? lang === "ar"
                    ? "جارٍ الإرسال…"
                    : "Submitting…"
                  : lang === "ar"
                    ? "إرسال الاستبيان"
                    : "Submit intake"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function StrokeQuestion({
  question,
  lang,
  response,
  onChange,
}: {
  question: StrokeQuestionDefinition;
  lang: PatientLang;
  response?: StrokeResponse;
  onChange: (value: string | string[]) => void;
}) {
  const current = response?.rawValue ?? "";
  if (question.kind === "long_text" || question.kind === "short_text") {
    return (
      <label className="block">
        <span className="text-sm font-semibold">{label(question, lang)}</span>
        <textarea
          value={typeof current === "string" ? current : ""}
          onChange={(event) => onChange(event.target.value)}
          rows={question.kind === "long_text" ? 3 : 1}
          className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
        />
      </label>
    );
  }
  if (question.kind === "date") {
    return (
      <label className="block">
        <span className="text-sm font-semibold">{label(question, lang)}</span>
        <input
          type="date"
          value={typeof current === "string" ? current : ""}
          onChange={(event) => onChange(event.target.value)}
          className="mt-2 block w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
        />
      </label>
    );
  }
  if (question.kind === "multi_select") {
    const selected = Array.isArray(current) ? current : [];
    return (
      <fieldset>
        <legend className="text-sm font-semibold">{label(question, lang)}</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {question.options?.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected.includes(option.value)}
              onClick={() => {
                if (selected.includes(option.value)) {
                  onChange(selected.filter((value) => value !== option.value));
                  return;
                }
                if (option.value === "none") {
                  onChange(["none"]);
                  return;
                }
                onChange([
                  ...selected.filter((value) => value !== "none"),
                  option.value,
                ]);
              }}
              className={`min-h-11 rounded-xl border px-4 py-2.5 text-sm transition ${
                selected.includes(option.value)
                  ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-100"
                  : "border-white/10 bg-white/[0.04] text-white/75"
              }`}
            >
              {lang === "ar" ? option.ar : option.en}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }
  if ((question.options?.length ?? 0) > 4) {
    return (
      <label className="block">
        <span className="text-sm font-semibold">{label(question, lang)}</span>
        <select
          value={typeof current === "string" ? current : ""}
          onChange={(event) => onChange(event.target.value)}
          className="mt-3 min-h-12 w-full rounded-xl border border-white/12 bg-[#10253f] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50"
        >
          <option value="">{lang === "ar" ? "اختر إجابة" : "Choose an answer"}</option>
          {question.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {lang === "ar" ? option.ar : option.en}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <fieldset>
      <legend className="text-sm font-semibold">{label(question, lang)}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {question.options?.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={current === option.value}
            onClick={() => onChange(option.value)}
            className={`min-h-11 rounded-xl border px-4 py-2.5 text-start text-sm transition ${
              current === option.value
                ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-100"
                : "border-white/10 bg-white/[0.04] text-white/75"
            }`}
          >
            {lang === "ar" ? option.ar : option.en}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
