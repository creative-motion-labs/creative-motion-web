"use client";

import { useEffect, useRef, useState } from "react";
import {
  createRemoteAssessment,
  daysUntilExpiry,
  ASSESSMENT_TYPE_LABELS,
  DEFAULT_SECTIONS,
  PATIENT_SECTION_LABELS,
  type AssessmentType,
  type PatientSectionId,
  type RemoteAssessmentRequest,
} from "../../../lib/api/remote-assessments";

const ASSESSMENT_TYPES: { value: AssessmentType; label: string; description: string }[] = [
  { value: "general_msk",   label: "General MSK",      description: "Full musculoskeletal assessment — pain, ROM, strength, balance, functional" },
  { value: "sports",        label: "Sports",            description: "Sports-specific — includes gait and return-to-activity screening" },
  { value: "gait",          label: "Gait Assessment",  description: "Walking and movement — pain, gait, and daily activity impact" },
  { value: "pain_function", label: "Pain & Function",  description: "Quick pain intake — symptoms and daily functional limitations only" },
  { value: "stroke_neuro_v1", label: "Neuro / Stroke", description: "Adaptive remote neurorehabilitation intake with a safety gate and upper-limb priority" },
];

const ALL_SECTIONS: PatientSectionId[] = ["pain", "rom", "strength", "balance", "gait", "functional"];

interface Props {
  patientId: string;
  patientName: string;
  onClose: () => void;
  onCreated: (req: RemoteAssessmentRequest) => void;
}

export function SendAssessmentModal({ patientId, patientName, onClose, onCreated }: Props) {
  const [assessmentType, setAssessmentType] = useState<AssessmentType>("general_msk");
  const [sections, setSections] = useState<PatientSectionId[]>(DEFAULT_SECTIONS["general_msk"]);
  const [generated, setGenerated] = useState<RemoteAssessmentRequest | null>(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Update default sections when type changes
  useEffect(() => {
    setSections([...DEFAULT_SECTIONS[assessmentType]]);
  }, [assessmentType]);

  function toggleSection(s: PatientSectionId) {
    setSections((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const req = await createRemoteAssessment({ patientId, patientName, assessmentType, includedSections: sections });
      setGenerated(req);
    } catch (err) {
      setGenerateError(
        err instanceof Error ? err.message : "Could not generate the assessment link. Try again.",
      );
    } finally {
      setGenerating(false);
    }
  }

  function assessmentLink(req: RemoteAssessmentRequest) {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/assessment/${req.id}`;
  }

  async function handleCopy() {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(assessmentLink(generated));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* ignore */ }
  }

  // Close on overlay click
  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-xl overflow-hidden rounded-[28px] border border-white/12 bg-[#0d1f3c] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-300/70">
              Remote Assessment
            </p>
            <h2 className="mt-0.5 text-lg font-bold text-white">Send to Patient</h2>
            <p className="mt-0.5 text-xs text-white/45">{patientName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          {!generated ? (
            <div className="space-y-6">
              {/* Assessment type */}
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/50">
                  Assessment type
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {ASSESSMENT_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setAssessmentType(t.value)}
                      className={`rounded-2xl border p-3.5 text-left transition ${
                        assessmentType === t.value
                          ? "border-cyan-300/40 bg-cyan-400/10"
                          : "border-white/8 bg-white/[0.03] hover:bg-white/[0.06]"
                      }`}
                    >
                      <p className={`text-sm font-bold ${assessmentType === t.value ? "text-cyan-200" : "text-white"}`}>
                        {t.label}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-4 text-white/45">{t.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Section selection */}
              {assessmentType !== "stroke_neuro_v1" ? <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/50">
                  Sections to include
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_SECTIONS.map((s) => {
                    const isOn = sections.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleSection(s)}
                        className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition ${
                          isOn
                            ? "border-cyan-300/30 bg-cyan-400/8 text-cyan-100"
                            : "border-white/8 bg-white/[0.03] text-white/40 hover:bg-white/[0.06]"
                        }`}
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          isOn ? "border-cyan-400 bg-cyan-400" : "border-white/20 bg-transparent"
                        }`}>
                          {isOn && (
                            <svg className="h-2.5 w-2.5 text-slate-950" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                          )}
                        </span>
                        <span className="text-xs font-medium">{PATIENT_SECTION_LABELS[s]}</span>
                      </button>
                    );
                  })}
                </div>
                {sections.length === 0 && (
                  <p className="mt-2 text-xs text-rose-300/80">Select at least one section.</p>
                )}
              </div> : (
                <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/5 px-4 py-3">
                  <p className="text-xs leading-5 text-cyan-100/80">
                    The Stroke v1 pathway adapts its sections from the patient&apos;s answers.
                    It does not ask the patient to perform movement tests.
                  </p>
                </div>
              )}

              {/* Expiry info */}
              <div className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs leading-5 text-white/50">
                  The link expires in <span className="font-semibold text-white/80">7 days</span> and can only be used once.
                  After submission the link is deactivated.
                </p>
              </div>

              {generateError && (
                <div className="rounded-2xl border border-rose-300/25 bg-rose-400/10 px-4 py-3 text-xs leading-5 text-rose-200">
                  {generateError}
                </div>
              )}

              {/* Generate button */}
              <button
                type="button"
                disabled={(assessmentType !== "stroke_neuro_v1" && sections.length === 0) || generating}
                onClick={handleGenerate}
                className="w-full rounded-2xl bg-cyan-400 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {generating ? "Generating link…" : "Generate Assessment Link"}
              </button>
            </div>
          ) : (
            // ── Generated state ──
            <div className="space-y-5">
              <div className="flex items-center gap-3 rounded-2xl border border-lime-300/25 bg-lime-400/8 px-4 py-3">
                <svg className="h-5 w-5 shrink-0 text-lime-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-lime-300">Link generated</p>
                  <p className="text-xs text-white/50">
                    Expires in {daysUntilExpiry(generated)} days ·{" "}
                    {ASSESSMENT_TYPE_LABELS[generated.assessmentType]} ·{" "}
                    {generated.includedSections.length} sections
                  </p>
                </div>
              </div>

              {/* Link display */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">
                  Patient assessment link
                </p>
                <div className="flex items-center gap-2 rounded-2xl border border-white/12 bg-[#0b1e38] px-4 py-3">
                  <p className="flex-1 truncate text-xs text-cyan-300 font-mono">
                    {assessmentLink(generated)}
                  </p>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                      copied
                        ? "bg-lime-400/15 text-lime-300"
                        : "bg-cyan-400/15 text-cyan-300 hover:bg-cyan-400/25"
                    }`}
                  >
                    {copied ? "Copied ✓" : "Copy"}
                  </button>
                </div>
              </div>

              {/* Sections summary */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">Included sections</p>
                <div className="flex flex-wrap gap-1.5">
                  {generated.includedSections.map((s) => (
                    <span
                      key={s}
                      className="rounded-full border border-white/12 bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-white/70"
                    >
                      {PATIENT_SECTION_LABELS[s]}
                    </span>
                  ))}
                </div>
              </div>

              {/* Instructions for clinician */}
              <div className="rounded-2xl border border-amber-300/15 bg-amber-400/[0.06] px-4 py-3 text-xs leading-5 text-amber-200/80">
                Share this link with {patientName} via email, SMS, or your patient communication platform.
                The patient does not need a login — the tokenized link gives them secure access.
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex-1 rounded-2xl bg-cyan-400 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-300"
                >
                  {copied ? "Copied!" : "Copy Link"}
                </button>
                <button
                  type="button"
                  onClick={() => { onCreated(generated); onClose(); }}
                  className="rounded-2xl border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
