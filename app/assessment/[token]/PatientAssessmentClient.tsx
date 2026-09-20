"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getRemoteAssessment,
  updateRemoteAssessmentDraft,
  submitRemoteAssessment,
  isExpired,
  type RemoteAssessmentRequest,
  type PatientAssessmentDraft,
  type PatientSectionId,
  type AssessmentLanguage,
} from "@/app/lib/api/remote-assessments";
import { LanguageToggle, type PatientLang } from "@/app/components/patient/LanguageToggle";
import { VoiceConsentBanner } from "@/app/components/patient/VoiceConsentBanner";
import { VoiceFieldControls } from "@/app/components/patient/VoiceFieldControls";
import { voiceLabel, VOICE_SUBMIT_BLOCK_MESSAGE } from "@/app/components/patient/voice-ui-labels";
import {
  PATIENT_SECTION_QUESTIONS,
  PATIENT_SECTION_TITLES,
  PATIENT_UI,
  buildPatientReviewEntries,
  patientText,
  type PatientQuestionField,
} from "@/app/lib/patient-assessment-questions";
import { TrustFooter } from "@/app/components/trust/TrustFooter";
import { trustFooterUi } from "@/app/lib/patient-portal-ui";
import { patientPortalArabicClass } from "@/app/lib/rasq-typography";
import { StrokeQuestionnaireClient } from "@/app/components/stroke/StrokeQuestionnaireClient";

type Stage = "section" | "review" | "submitting";

const SUPPORT_CONTACT =
  process.env.NEXT_PUBLIC_SUPPORT_CONTACT?.trim() || "contact your clinic";

function PilotConsentPanel({ onAccept }: { onAccept: () => void }) {
  return (
    <div
      className="mx-auto my-10 max-w-[480px] rounded-[10px] border border-[#E2E8E5] bg-white p-6"
      style={{ borderWidth: "0.5px" }}
    >
      <h2
        className="text-base font-medium text-[#0A0F1A]"
        style={{ fontFamily: "var(--rasq-font-display, sans-serif)" }}
      >
        Before you begin
      </h2>
      <div className="mt-4 space-y-4 text-xs leading-6 text-[#0A0F1A]">
        <p>
          This assessment is part of a rehabilitation pilot program by RASQ. Your answers will be shared with your assigned clinician only.
        </p>
        <p>
          This platform is a clinical decision support tool. It does not replace your therapist&apos;s judgment. Your therapist will review all information before making any clinical decisions.
        </p>
        <p>
          If you feel unwell or experience sharp pain at any time, stop and contact your therapist directly.
        </p>
        <p>For questions or support: {SUPPORT_CONTACT}</p>
      </div>
      <button
        type="button"
        onClick={onAccept}
        className="mt-5 w-full rounded-[7px] bg-[#1D9E75] py-3.5 text-sm font-bold text-white transition hover:bg-[#179165]"
      >
        I understand — begin assessment
      </button>
    </div>
  );
}

function PainScale({
  value,
  onChange,
  lang,
}: {
  value: string;
  onChange: (v: string) => void;
  lang: PatientLang;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-white/40">
        <span>{patientText(PATIENT_UI.painScaleMin, lang)}</span>
        <span>{patientText(PATIENT_UI.painScaleMax, lang)}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 11 }, (_, i) => {
          const v = String(i);
          const isActive = value === v;
          const color = i === 0 ? "lime" : i <= 3 ? "lime" : i <= 6 ? "amber" : "rose";
          return (
            <button
              key={i}
              type="button"
              onClick={() => onChange(v)}
              className={`h-9 w-9 rounded-xl border text-sm font-bold transition ${
                isActive
                  ? color === "lime"
                    ? "border-lime-300/40 bg-lime-400/15 text-lime-200"
                    : color === "amber"
                      ? "border-amber-300/40 bg-amber-400/15 text-amber-200"
                      : "border-rose-300/40 bg-rose-400/15 text-rose-200"
                  : "border-white/10 bg-white/[0.04] text-white/50 hover:bg-white/[0.08]"
              }`}
            >
              {i}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function QuestionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-sm font-semibold text-white/90">{children}</p>;
}

function ConfigSectionForm({
  section,
  data,
  onChange,
  lang,
  assessmentToken,
  voiceConsentGiven,
  onConsentNeeded,
  onVoiceTranscript,
  onVoiceTranscriptionFailed,
  voiceTranscribedKeys,
  voiceReviewDismissed,
  onFieldManualEdit,
}: {
  section: PatientSectionId;
  data: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  lang: PatientLang;
  assessmentToken: string;
  voiceConsentGiven: boolean;
  onConsentNeeded: () => void;
  onVoiceTranscript: (fieldKey: string, text: string) => void;
  onVoiceTranscriptionFailed: (fieldKey: string) => void;
  voiceTranscribedKeys: Record<string, "voice">;
  voiceReviewDismissed: Record<string, boolean>;
  onFieldManualEdit: (fieldKey: string, value: string) => void;
}) {
  const fields = PATIENT_SECTION_QUESTIONS[section];

  return (
    <div className="space-y-5">
      {fields.map((field: PatientQuestionField) => {
        const placeholder =
          field.placeholder
            ? patientText(field.placeholder, lang)
            : undefined;
        const value = data[field.key] ?? "";
        const questionText = patientText(field.text, lang);

        return (
          <div key={field.key}>
            <QuestionLabel>{questionText}</QuestionLabel>
            {field.kind === "painScale" ? (
              <>
                <VoiceFieldControls
                  lang={lang}
                  assessmentToken={assessmentToken}
                  questionText={questionText}
                  consentGiven={voiceConsentGiven}
                  onConsentNeeded={onConsentNeeded}
                  onTranscript={() => {}}
                  showRecord={false}
                />
                {field.hint && <Hint>{patientText(field.hint, lang)}</Hint>}
                <PainScale value={value} onChange={(v) => onChange({ ...data, [field.key]: v })} lang={lang} />
              </>
            ) : field.kind === "textarea" ? (
              <>
                <VoiceFieldControls
                  lang={lang}
                  assessmentToken={assessmentToken}
                  questionText={questionText}
                  fieldValue={value}
                  consentGiven={voiceConsentGiven}
                  onConsentNeeded={onConsentNeeded}
                  onTranscript={(text) => onVoiceTranscript(field.key, text)}
                  onTranscriptionFailed={() => onVoiceTranscriptionFailed(field.key)}
                />
                {field.hint && <Hint>{patientText(field.hint, lang)}</Hint>}
                <TextArea
                  value={value}
                  onChange={(v) => {
                    onFieldManualEdit(field.key, v);
                    onChange({ ...data, [field.key]: v });
                  }}
                  placeholder={placeholder}
                  rows={field.rows ?? 3}
                />
                {voiceTranscribedKeys[field.key] === "voice" &&
                value.trim() &&
                !voiceReviewDismissed[field.key] ? (
                  <p className="mt-1 text-[11px] italic text-[#9CA3AF]">
                    {voiceLabel("transcribed", lang)}
                  </p>
                ) : null}
              </>
            ) : field.kind === "text" ? (
              <>
                <VoiceFieldControls
                  lang={lang}
                  assessmentToken={assessmentToken}
                  questionText={questionText}
                  fieldValue={value}
                  consentGiven={voiceConsentGiven}
                  onConsentNeeded={onConsentNeeded}
                  onTranscript={(text) => onVoiceTranscript(field.key, text)}
                  onTranscriptionFailed={() => onVoiceTranscriptionFailed(field.key)}
                />
                {field.hint && <Hint>{patientText(field.hint, lang)}</Hint>}
                <TextInput
                  value={value}
                  onChange={(v) => {
                    onFieldManualEdit(field.key, v);
                    onChange({ ...data, [field.key]: v });
                  }}
                  placeholder={placeholder}
                />
                {voiceTranscribedKeys[field.key] === "voice" &&
                value.trim() &&
                !voiceReviewDismissed[field.key] ? (
                  <p className="mt-1 text-[11px] italic text-[#9CA3AF]">
                    {voiceLabel("transcribed", lang)}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none focus:border-cyan-300/30 focus:bg-white/[0.06]"
    />
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none focus:border-cyan-300/30 focus:bg-white/[0.06]"
    />
  );
}

function emptyDraft(): PatientAssessmentDraft {
  return {
    pain: { chiefComplaint: "", painLocation: "", painScore: "", aggravating: "", easing: "", dailyImpact: "", goals: "" },
    rom: { limitations: "", worseWith: "" },
    strength: { weaknessDescription: "", activitiesAffected: "" },
    balance: { difficultyDescription: "", fallHistory: "" },
    gait: { walkingDescription: "", aids: "" },
    functional: { standingDuration: "", walkingDistance: "", stairsAbility: "", otherNotes: "" },
  };
}

const ALL_PATIENT_SECTIONS: PatientSectionId[] = [
  "pain",
  "rom",
  "strength",
  "balance",
  "gait",
  "functional",
];

function getFieldValueFromDraft(draft: PatientAssessmentDraft, fieldKey: string): string {
  for (const section of ALL_PATIENT_SECTIONS) {
    const block = draft[section];
    if (block && typeof block === "object" && fieldKey in block) {
      return String((block as Record<string, string>)[fieldKey] ?? "");
    }
  }
  return "";
}

function setFieldValueInDraft(
  draft: PatientAssessmentDraft,
  fieldKey: string,
  value: string,
): PatientAssessmentDraft {
  const next: PatientAssessmentDraft = { ...draft };
  for (const section of ALL_PATIENT_SECTIONS) {
    const block = next[section];
    if (block && typeof block === "object" && fieldKey in block) {
      (next as Record<string, Record<string, string>>)[section] = {
        ...(block as Record<string, string>),
        [fieldKey]: value,
      };
      return next;
    }
  }
  return next;
}

function hasCorruptedVoiceText(text: string): boolean {
  const nonSpace = text.replace(/\s/g, "");
  if (nonSpace.length === 0) return false;
  const badChars = [...nonSpace].filter(
    (c) => c === "?" || c === "\uFFFD",
  ).length;
  return badChars / nonSpace.length > 0.5;
}

function sanitizeDraftForSubmit(draft: PatientAssessmentDraft): PatientAssessmentDraft {
  let next = draft;
  for (const section of ALL_PATIENT_SECTIONS) {
    const block = next[section];
    if (!block || typeof block !== "object") continue;
    for (const [fieldKey, value] of Object.entries(block as Record<string, string>)) {
      if (hasCorruptedVoiceText(String(value ?? ""))) {
        next = setFieldValueInDraft(next, fieldKey, "");
      }
    }
  }
  return next;
}

function getSectionData(
  section: PatientSectionId,
  draft: PatientAssessmentDraft,
): Record<string, string> {
  const block = draft[section];
  return (block ?? {}) as Record<string, string>;
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-xs text-white/45">{children}</p>;
}

function ReviewSection({
  section,
  data,
  lang,
}: {
  section: PatientSectionId;
  data: PatientAssessmentDraft;
  lang: PatientLang;
}) {
  const entries = buildPatientReviewEntries(section, data, lang);

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
        <p className="text-xs font-semibold text-white/70">{patientText(PATIENT_SECTION_TITLES[section], lang)}</p>
        <p className="mt-1 text-xs italic text-white/30">{patientText(PATIENT_UI.noInfo, lang)}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10">
      <div className="border-b border-white/8 bg-white/[0.04] px-4 py-3">
        <p className="text-xs font-bold text-white">{patientText(PATIENT_SECTION_TITLES[section], lang)}</p>
      </div>
      <div className="divide-y divide-white/[0.06]">
        {entries.map(({ label, value }) => (
          <div key={label} className="px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">{label}</p>
            <p className="mt-0.5 text-sm text-white/80 whitespace-pre-wrap">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PatientAssessmentClient() {
  const params = useParams();
  const router = useRouter();
  const token = String(params.token ?? "");

  const [req, setReq] = useState<RemoteAssessmentRequest | null>(null);
  const [tokenState, setTokenState] = useState<"loading" | "valid" | "invalid">("loading");
  const [stage, setStage] = useState<Stage>("section");
  const [sectionIdx, setSectionIdx] = useState(0);
  const [consentGiven, setConsentGiven] = useState(false);
  const [draft, setDraft] = useState<PatientAssessmentDraft>(emptyDraft());
  const [lang, setLang] = useState<PatientLang>("en");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [voiceConsentGiven, setVoiceConsentGiven] = useState(false);
  const [showConsentBanner, setShowConsentBanner] = useState(false);
  const [voiceMethods, setVoiceMethods] = useState<Record<string, "voice">>({});
  const [voiceReviewDismissed, setVoiceReviewDismissed] = useState<Record<string, boolean>>({});
  const [voiceTranscriptionFailed, setVoiceTranscriptionFailed] = useState<Record<string, boolean>>({});
  const [submitVoiceError, setSubmitVoiceError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem("rasq_voice_consent") === "1") {
      setVoiceConsentGiven(true);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setTokenState("invalid");
      return;
    }

    let cancelled = false;

    void (async () => {
      const r = await getRemoteAssessment(token);
      if (cancelled) return;
      if (!r || isExpired(r) || r.status === "submitted") {
        setTokenState("invalid");
        return;
      }
      setReq(r);
      if (r.patientDraft) {
        setDraft({ ...emptyDraft(), ...r.patientDraft });
      }
      if (r.assessmentLanguage === "ar" || r.assessmentLanguage === "en") {
        setLang(r.assessmentLanguage);
      }
      setTokenState("valid");
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const autoSave = useCallback(
    (d: PatientAssessmentDraft, language: PatientLang) => {
      if (token) updateRemoteAssessmentDraft(token, d, language);
    },
    [token],
  );

  function handleLangChange(next: PatientLang) {
    setLang(next);
    autoSave(draft, next);
  }

  function updateSection(section: PatientSectionId, sectionData: Record<string, string>) {
    const next = { ...draft, [section]: sectionData } as PatientAssessmentDraft;
    setDraft(next);
    autoSave(next, lang);
  }

  function handleFieldManualEdit(fieldKey: string, value: string) {
    setVoiceReviewDismissed((prev) => ({ ...prev, [fieldKey]: true }));
    setVoiceTranscriptionFailed((prev) => {
      if (!prev[fieldKey]) return prev;
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
    if (!hasCorruptedVoiceText(value)) {
      setSubmitVoiceError(null);
    }
  }

  function findBlockedVoiceFieldKeys(
    currentDraft: PatientAssessmentDraft,
    methods: Record<string, "voice">,
    failed: Record<string, boolean>,
  ): string[] {
    const blocked = new Set<string>();

    for (const [fieldKey, method] of Object.entries(methods)) {
      if (method !== "voice") continue;
      if (hasCorruptedVoiceText(getFieldValueFromDraft(currentDraft, fieldKey))) {
        blocked.add(fieldKey);
      }
    }

    for (const [fieldKey, isFailed] of Object.entries(failed)) {
      if (!isFailed) continue;
      const value = getFieldValueFromDraft(currentDraft, fieldKey);
      if (!value.trim() || hasCorruptedVoiceText(value)) {
        blocked.add(fieldKey);
      }
    }

    return [...blocked];
  }

  function unblockCorruptedVoiceFields(blockedKeys: string[]) {
    if (blockedKeys.length === 0) return;

    let nextDraft = draft;
    let draftChanged = false;
    for (const fieldKey of blockedKeys) {
      const value = getFieldValueFromDraft(nextDraft, fieldKey);
      if (hasCorruptedVoiceText(value)) {
        nextDraft = setFieldValueInDraft(nextDraft, fieldKey, "");
        draftChanged = true;
      }
    }
    if (draftChanged) {
      setDraft(nextDraft);
      autoSave(nextDraft, lang);
    }

    setVoiceMethods((prev) => {
      const next = { ...prev };
      for (const fieldKey of blockedKeys) {
        delete next[fieldKey];
      }
      return next;
    });

    setVoiceTranscriptionFailed((prev) => {
      const next = { ...prev };
      for (const fieldKey of blockedKeys) {
        next[fieldKey] = true;
      }
      return next;
    });

    for (const fieldKey of blockedKeys) {
      setVoiceReviewDismissed((prev) => ({ ...prev, [fieldKey]: true }));
    }
  }

  function blockIfCorruptedVoiceFields(): boolean {
    const blockedKeys = findBlockedVoiceFieldKeys(
      draft,
      voiceMethods,
      voiceTranscriptionFailed,
    );
    if (blockedKeys.length === 0) return false;
    unblockCorruptedVoiceFields(blockedKeys);
    setSubmitVoiceError(VOICE_SUBMIT_BLOCK_MESSAGE);
    return true;
  }

  function dismissSectionReviewNotices(section: PatientSectionId) {
    const fields = PATIENT_SECTION_QUESTIONS[section];
    setVoiceReviewDismissed((prev) => {
      const next = { ...prev };
      for (const field of fields) {
        next[field.key] = true;
      }
      return next;
    });
  }

  function handleVoiceTranscriptionFailed(fieldKey: string) {
    setVoiceTranscriptionFailed((prev) => ({ ...prev, [fieldKey]: true }));
    setVoiceMethods((prev) => {
      if (!(fieldKey in prev)) return prev;
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
    setVoiceReviewDismissed((prev) => ({ ...prev, [fieldKey]: true }));

    const value = getFieldValueFromDraft(draft, fieldKey);
    if (hasCorruptedVoiceText(value)) {
      const nextDraft = setFieldValueInDraft(draft, fieldKey, "");
      setDraft(nextDraft);
      autoSave(nextDraft, lang);
    }
  }

  function handleVoiceTranscript(section: PatientSectionId, fieldKey: string, text: string) {
    if (hasCorruptedVoiceText(text)) {
      handleVoiceTranscriptionFailed(fieldKey);
      return;
    }
    const sectionData = { ...getSectionData(section, draft), [fieldKey]: text };
    updateSection(section, sectionData);
    setVoiceMethods((prev) => ({ ...prev, [fieldKey]: "voice" }));
    setVoiceReviewDismissed((prev) => ({ ...prev, [fieldKey]: false }));
    setVoiceTranscriptionFailed((prev) => {
      if (!prev[fieldKey]) return prev;
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
    setSubmitVoiceError(null);
  }

  function handleVoiceConsentAccept() {
    setVoiceConsentGiven(true);
    setShowConsentBanner(false);
  }

  function buildSubmissionPayload(): Record<string, unknown> {
    const sanitizedDraft = sanitizeDraftForSubmit(draft);
    const methodFields: Record<string, string> = {};

    for (const [fieldKey, method] of Object.entries(voiceMethods)) {
      if (method !== "voice") continue;
      if (voiceTranscriptionFailed[fieldKey]) continue;
      const value = getFieldValueFromDraft(sanitizedDraft, fieldKey);
      if (!value.trim() || hasCorruptedVoiceText(value)) continue;
      methodFields[`${fieldKey}_method`] = method;
    }

    return {
      ...sanitizedDraft,
      assessmentLanguage: lang,
      patientAudioConsent: voiceConsentGiven,
      ...methodFields,
    };
  }

  function handleGoToReview() {
    if (currentSection) dismissSectionReviewNotices(currentSection);
    blockIfCorruptedVoiceFields();
    setStage("review");
  }

  async function handleSubmit() {
    if (!req) return;
    if (blockIfCorruptedVoiceFields()) return;

    setSubmitVoiceError(null);
    setSubmitError(null);
    setSubmitting(true);
    setStage("submitting");
    try {
      await submitRemoteAssessment(token, buildSubmissionPayload(), lang as AssessmentLanguage);
      router.push(`/assessment/${token}/complete`);
    } catch {
      setSubmitting(false);
      setStage("review");
      setSubmitError(
        lang === "ar"
          ? "تعذر إرسال التقييم الآن. تم حفظ إجاباتك محليًا — حاول الإرسال مرة أخرى أو تواصل مع العيادة."
          : "Could not submit right now. Your answers are still saved on this device — try again or contact your clinic.",
      );
    }
  }

  const sections = req?.includedSections ?? [];
  const currentSection = sections[sectionIdx] as PatientSectionId | undefined;
  const totalSections = sections.length;
  const progress = totalSections > 0 ? (sectionIdx / totalSections) * 100 : 0;
  const formDir = lang === "ar" ? "rtl" : "ltr";
  const formLang = lang === "ar" ? "ar" : "en";
  const fontClass = patientPortalArabicClass(lang === "ar");

  if (tokenState === "invalid") {
    return (
      <div className="flex min-h-screen flex-col bg-[#071a2f] px-6 text-center text-white">
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="mx-auto max-w-sm">
            <h1 className="text-xl font-bold text-white">{patientText(PATIENT_UI.linkUnavailable, lang)}</h1>
            <p className="mt-3 text-sm leading-6 text-white/50">{patientText(PATIENT_UI.linkUnavailableBody, lang)}</p>
            <p className="mt-6 text-xs font-semibold tracking-wide text-cyan-400/70">RASQ</p>
          </div>
        </div>
        <TrustFooter variant="dark" labels={trustFooterUi(lang)} className="pb-8" />
      </div>
    );
  }

  if (tokenState === "loading" || !req) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#071a2f]">
        <p className="text-sm text-white/40">{patientText(PATIENT_UI.verifying, lang)}</p>
      </div>
    );
  }

  if (req.assessmentType === "stroke_neuro_v1") {
    return <StrokeQuestionnaireClient token={token} request={req} />;
  }

  if (!consentGiven) {
    return (
      <div className="flex min-h-screen flex-col bg-[#071a2f] text-white">
        <header className="flex h-14 items-center justify-center border-b border-white/8 bg-[#071a2f]/90 px-5 backdrop-blur-md">
          <span className="text-sm font-bold tracking-[-0.03em] text-cyan-300">RASQ</span>
        </header>
        <div className="flex-1">
          <PilotConsentPanel onAccept={() => setConsentGiven(true)} />
        </div>
        <TrustFooter
          variant="dark"
          labels={trustFooterUi(lang)}
          className="mx-auto w-full max-w-xl px-5 pb-8"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#071a2f] text-white">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/8 bg-[#071a2f]/90 px-5 backdrop-blur-md">
        <span className="text-sm font-bold tracking-[-0.03em] text-cyan-300">RASQ</span>
        {stage === "section" && (
          <span className="text-xs text-white/40">
            {sectionIdx + 1} {patientText(PATIENT_UI.sectionOf, lang)} {totalSections}{" "}
            {patientText(PATIENT_UI.sections, lang)}
          </span>
        )}
        <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-medium text-white/50">
          {patientText(PATIENT_UI.remoteAssessment, lang)}
        </span>
      </header>

      {stage === "section" && (
        <div className="h-1 bg-white/[0.06]">
          <div
            className="h-full bg-cyan-400 transition-all duration-500"
            style={{ width: `${progress + (1 / totalSections) * 100}%` }}
          />
        </div>
      )}

      <main className="mx-auto max-w-xl px-5 py-10">
        {/* Language toggle — visible on all stages after load */}
        <div className="mb-6 flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
            {patientText(PATIENT_UI.languageLabel, lang)}
          </p>
          <LanguageToggle current={lang} onChange={handleLangChange} />
        </div>

        {stage === "section" && currentSection && (
          <div className="space-y-7">
            <div dir={formDir} lang={formLang} className={fontClass}>
              <p className="text-xs font-semibold uppercase tracking-widest text-cyan-300/70">
                {patientText(PATIENT_UI.sectionHeader, lang)} {sectionIdx + 1} {patientText(PATIENT_UI.sectionOf, lang)}{" "}
                {totalSections}
              </p>
              <h2 className="mt-1.5 text-2xl font-bold text-white">
                {patientText(PATIENT_SECTION_TITLES[currentSection], lang)}
              </h2>
              <p className="mt-1.5 text-sm text-white/50">{patientText(PATIENT_UI.answerAccurately, lang)}</p>
            </div>

            <div
              className={`rounded-[22px] border border-white/10 bg-white/[0.03] p-5 ${fontClass}`}
              dir={formDir}
              lang={formLang}
            >
              {showConsentBanner && (
                <div className="mb-5">
                  <VoiceConsentBanner lang={lang} onAccept={handleVoiceConsentAccept} />
                </div>
              )}
              <ConfigSectionForm
                section={currentSection}
                data={getSectionData(currentSection, draft)}
                onChange={(d) => updateSection(currentSection, d)}
                lang={lang}
                assessmentToken={token}
                voiceConsentGiven={voiceConsentGiven}
                onConsentNeeded={() => setShowConsentBanner(true)}
                onVoiceTranscript={(fieldKey, text) =>
                  handleVoiceTranscript(currentSection, fieldKey, text)
                }
                onVoiceTranscriptionFailed={handleVoiceTranscriptionFailed}
                voiceTranscribedKeys={voiceMethods}
                voiceReviewDismissed={voiceReviewDismissed}
                onFieldManualEdit={handleFieldManualEdit}
              />
            </div>

            <div className="flex gap-3">
              {sectionIdx > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (currentSection) dismissSectionReviewNotices(currentSection);
                    setSectionIdx((i) => i - 1);
                  }}
                  className="flex-1 rounded-2xl border border-white/12 bg-white/5 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  {patientText(PATIENT_UI.previous, lang)}
                </button>
              )}
              {sectionIdx < totalSections - 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (currentSection) dismissSectionReviewNotices(currentSection);
                    setSectionIdx((i) => i + 1);
                  }}
                  className="flex-1 rounded-2xl bg-cyan-400 py-3.5 text-sm font-bold text-slate-950 transition hover:bg-cyan-300"
                >
                  {patientText(PATIENT_UI.nextSection, lang)}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleGoToReview}
                  className="flex-1 rounded-2xl bg-cyan-400 py-3.5 text-sm font-bold text-slate-950 transition hover:bg-cyan-300"
                >
                  {patientText(PATIENT_UI.reviewAnswers, lang)}
                </button>
              )}
            </div>

            <p className="text-center text-[11px] text-white/25">{patientText(PATIENT_UI.progressSaved, lang)}</p>
          </div>
        )}

        {stage === "review" && (
          <div className={`space-y-6 ${fontClass}`} dir={formDir} lang={formLang}>
            <div>
              <h2 className="text-2xl font-bold text-white">{patientText(PATIENT_UI.reviewTitle, lang)}</h2>
              <p className="mt-1.5 text-sm text-white/50">{patientText(PATIENT_UI.reviewSubtitle, lang)}</p>
            </div>

            {sections.map((s, i) => (
              <div key={s}>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-white/35">
                    {patientText(PATIENT_UI.sectionHeader, lang)} {i + 1}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSectionIdx(i);
                      setStage("section");
                    }}
                    className="text-[11px] text-cyan-400/70 transition hover:text-cyan-300"
                  >
                    {patientText(PATIENT_UI.edit, lang)}
                  </button>
                </div>
                <ReviewSection section={s} data={draft} lang={lang} />
              </div>
            ))}

            <div className="pt-2">
              {submitVoiceError ? (
                <p className="mb-3 rounded-[10px] border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] italic text-amber-100">
                  {submitVoiceError}
                </p>
              ) : null}
              {submitError ? (
                <p className="mb-3 rounded-[10px] border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-[11px] text-rose-100">
                  {submitError}
                </p>
              ) : null}
              <button
                type="button"
                disabled={submitting}
                onClick={handleSubmit}
                className="w-full rounded-2xl bg-cyan-400 py-4 text-sm font-bold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-50"
              >
                {submitting ? patientText(PATIENT_UI.submitting, lang) : patientText(PATIENT_UI.submitAssessment, lang)}
              </button>
              <p className="mt-3 text-center text-xs text-white/30">{patientText(PATIENT_UI.submitOnceNote, lang)}</p>
            </div>
          </div>
        )}

        {stage === "submitting" && (
          <div className="flex flex-col items-center gap-5 px-2 py-16 text-center sm:py-20">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/10 border-t-cyan-400" />
            <div>
              <p className="text-sm font-semibold text-white/75">{patientText(PATIENT_UI.sending, lang)}</p>
              <p className="mt-2 text-xs text-white/40">
                {lang === "ar"
                  ? "يرجى عدم إغلاق هذه الصفحة حتى يكتمل الإرسال."
                  : "Please keep this page open until submission completes."}
              </p>
            </div>
          </div>
        )}
      </main>

      <TrustFooter
        variant="dark"
        labels={trustFooterUi(lang)}
        className="mx-auto w-full max-w-xl px-5 pb-8"
      />
    </div>
  );
}
