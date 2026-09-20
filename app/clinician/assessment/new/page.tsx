"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getClinician } from "@/app/lib/auth";
import { fetchPatientsList } from "@/app/lib/api/demo-fallback-client";
import type { PatientRow } from "@/app/lib/validate-patient-ownership";
import type { AssessmentData, BodyRegion, FunctionalTest } from "@/app/lib/assessment-types";
import { ROM_CONFIG, FUNCTIONAL_TESTS_BY_REGION } from "@/app/lib/rom-config";

/* ─── Constants ─────────────────────────────────────────────────────────── */

const STEP_LABELS = [
  "Body Region",
  "Range of Motion",
  "Pain & Symptoms",
  "Functional Tests",
  "Clinical Observations",
  "Classification",
] as const;

const REGIONS: BodyRegion[] = [
  "Knee",
  "Shoulder",
  "Lumbar",
  "Hip",
  "Ankle",
  "Cervical",
  "Upper limb",
  "Gait/Balance",
];

const AGGRAVATING_OPTIONS = [
  "Walking",
  "Stairs",
  "Sitting",
  "Standing",
  "Lifting",
  "Sport",
  "Rest",
];

const GOAL_OPTIONS = [
  "Reduce pain",
  "Restore ROM",
  "Rebuild strength",
  "Improve balance",
  "Return to sport",
  "Return to work",
  "Functional independence",
];

const ONSET_OPTIONS = [
  { value: "acute" as const, label: "Acute" },
  { value: "subacute" as const, label: "Subacute" },
  { value: "chronic" as const, label: "Chronic" },
];

const REHAB_PHASES = [
  "Acute",
  "Subacute",
  "Rehabilitation",
  "Maintenance",
] as const;
type RehabPhase = (typeof REHAB_PHASES)[number];

/* ─── StepBar ────────────────────────────────────────────────────────────── */

function StepBar({ step }: { step: number }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-white/40">
        Step {step} of 6 —{" "}
        <span className="text-[#5DCAA5]">{STEP_LABELS[step - 1]}</span>
      </p>
      <div className="mt-2 h-0.5 w-full rounded-full bg-[#1E2D42]">
        <div
          className="h-0.5 rounded-full bg-[#1D9E75] transition-all duration-300"
          style={{ width: `${(step / 6) * 100}%` }}
        />
      </div>
    </div>
  );
}

/* ─── Field ─────────────────────────────────────────────────────────────── */

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-white/35">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-white/20">{hint}</p>}
    </div>
  );
}

/* ─── PainScale ─────────────────────────────────────────────────────────── */

function PainScale({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: 11 }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          className={`flex h-10 min-w-[34px] flex-1 items-center justify-center rounded-[6px] border text-xs font-bold transition ${
            value === i
              ? i >= 7
                ? "border-amber-500/60 bg-amber-500/20 text-amber-300"
                : "border-[#1D9E75] bg-[#1D9E75]/15 text-[#5DCAA5]"
              : i >= 7
                ? "border-amber-900/30 bg-[#0B1220] text-white/25 hover:border-amber-500/30 hover:text-amber-300/60"
                : "border-[#1E2D42] bg-[#0B1220] text-white/25 hover:border-[#1D9E75]/30"
          }`}
        >
          {i}
        </button>
      ))}
    </div>
  );
}

/* ─── TagSelector ───────────────────────────────────────────────────────── */

function TagSelector({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onToggle(opt)}
          className={`rounded-[6px] border px-3 py-1.5 text-xs font-semibold transition ${
            selected.includes(opt)
              ? "border-[#1D9E75]/50 bg-[#1D9E75]/10 text-[#5DCAA5]"
              : "border-[#1E2D42] bg-[#0B1220] text-white/40 hover:border-[#1D9E75]/20 hover:text-white/70"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

/* ─── Shared input class ─────────────────────────────────────────────────── */

const inputCls =
  "w-full rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3.5 py-3 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#1D9E75]/40";

/* ─── Main form ─────────────────────────────────────────────────────────── */

function NewAssessmentInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initPatientId = searchParams.get("patientId") || null;

  const [patientId, setPatientId]       = useState<string | null>(initPatientId);
  const [patientSelected, setPatientSelected] = useState(initPatientId !== null);
  const [selectedPatient, setSelectedPatient] = useState<PatientRow | null>(null);
  const [patientList, setPatientList]   = useState<PatientRow[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(false);

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Step 1 — Body Region
  const [bodyRegion, setBodyRegion] = useState<BodyRegion | null>(null);

  // Step 2 — ROM
  const [romValues, setRomValues] = useState<Record<string, number>>({});
  const [romValuesLeft, setRomValuesLeft] = useState<Record<string, number>>({});
  const [leftRightEnabled, setLeftRightEnabled] = useState(false);

  // Step 3 — Pain & Symptoms
  const [painAtRest, setPainAtRest] = useState(0);
  const [painOnMovement, setPainOnMovement] = useState(0);
  const [painLocation, setPainLocation] = useState("");
  const [onset, setOnset] = useState<"acute" | "subacute" | "chronic" | null>(
    null
  );
  const [aggravating, setAggravating] = useState<string[]>([]);

  // Step 4 — Functional Tests
  const [testResults, setTestResults] = useState<
    Record<string, "pass" | "fail" | "limited">
  >({});
  const [testNotes, setTestNotes] = useState<Record<string, string>>({});
  const [customTests, setCustomTests] = useState<string[]>([]);
  const [customTestInput, setCustomTestInput] = useState("");

  // Step 5 — Clinical Observations
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [gaitObs, setGaitObs] = useState("");
  const [posturalFindings, setPosturalFindings] = useState("");

  // Step 6 — Classification
  const [rehabPhase, setRehabPhase] = useState<RehabPhase | null>(null);
  const [rehabGoals, setRehabGoals] = useState<string[]>([]);
  const [customGoal, setCustomGoal] = useState("");

  // Load the pre-selected patient from the API (when patientId is in the URL)
  useEffect(() => {
    if (!patientId) return;
    fetch(`/api/patients/${patientId}`)
      .then(async (res) => {
        if (!res.ok) return;
        const p = (await res.json()) as PatientRow;
        setSelectedPatient(p);
      })
      .catch(() => {});
  }, [patientId]);

  // Load patient list for the patient-selection step (when no patientId in URL)
  useEffect(() => {
    if (patientSelected) return;
    setPatientsLoading(true);
    fetchPatientsList()
      .then(({ patients }) => setPatientList(patients))
      .catch(() => {})
      .finally(() => setPatientsLoading(false));
  }, [patientSelected]);

  const regionFields = bodyRegion ? (ROM_CONFIG[bodyRegion] ?? []) : [];
  const regionTests = bodyRegion
    ? (FUNCTIONAL_TESTS_BY_REGION[bodyRegion] ?? [])
    : [];
  const allTests = [...regionTests, ...customTests];

  function canAdvance(): boolean {
    if (step === 1) return bodyRegion !== null;
    if (step === 3) return onset !== null;
    if (step === 5) return clinicalNotes.trim().length > 0;
    if (step === 6) return rehabPhase !== null;
    return true;
  }

  function toggleAggravating(v: string) {
    setAggravating((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]
    );
  }

  function toggleGoal(v: string) {
    setRehabGoals((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]
    );
  }

  function setTestResult(name: string, result: "pass" | "fail" | "limited") {
    setTestResults((prev) => ({ ...prev, [name]: result }));
  }

  function setTestNote(name: string, note: string) {
    setTestNotes((prev) => ({ ...prev, [name]: note }));
  }

  function addCustomTest() {
    const name = customTestInput.trim();
    if (!name || allTests.includes(name)) return;
    setCustomTests((prev) => [...prev, name]);
    setCustomTestInput("");
  }

  function addCustomGoal() {
    const g = customGoal.trim();
    if (!g || rehabGoals.includes(g)) return;
    setRehabGoals((prev) => [...prev, g]);
    setCustomGoal("");
  }

  async function handleSave() {
    if (!selectedPatient || !bodyRegion || !onset || !rehabPhase) {
      setSaveError("Please complete all required fields.");
      return;
    }
    if (!clinicalNotes.trim()) {
      setSaveError("Clinical notes are required before saving.");
      return;
    }
    setSaving(true);
    setSaveError("");

    const clinician = getClinician();
    const assessedBy = clinician?.full_name ?? "Clinician";

    // Build ROM measurement list from entered values
    const measurements = regionFields
      .filter((f) => romValues[f.label] !== undefined && romValues[f.label] > 0)
      .map((f) => ({
        label: f.label,
        value: romValues[f.label]!,
        normalMin: f.normalMin,
        normalMax: f.normalMax,
        unit: f.unit,
      }));

    const asymmetryPresent =
      leftRightEnabled &&
      measurements.some(
        (m) =>
          Math.abs(
            (romValues[m.label] ?? 0) - (romValuesLeft[m.label] ?? 0)
          ) > 10
      );

    const functionalTests: FunctionalTest[] = allTests
      .filter((n) => testResults[n])
      .map((n) => ({
        testName: n,
        result: testResults[n],
        notes: testNotes[n] ?? "",
      }));

    const assessmentData: AssessmentData = {
      bodyRegion,
      rom: {
        measurements,
        primary: measurements[0] ?? {
          label: "N/A",
          value: 0,
          normalMin: 0,
          normalMax: 0,
        },
        secondary: measurements[1],
        leftRightComparison: leftRightEnabled,
        asymmetryPresent,
      },
      painAtRest,
      painOnMovement,
      painLocation,
      onset,
      aggravatingFactors: aggravating,
      functionalTests,
      clinicalNotes,
      gaitObservations: gaitObs || undefined,
      posturalFindings: posturalFindings || undefined,
      rehabilitationPhase: rehabPhase,
      rehabilitationGoals: rehabGoals,
      assessedAt: new Date().toISOString(),
      assessedBy,
    };

    try {
      const res = await fetch("/api/assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: selectedPatient.id,
          data: assessmentData,
          type: "structured",
          notes: clinicalNotes,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Failed to save assessment (${res.status})`);
      }

      router.push(`/clinician/patients/${selectedPatient.id}?assessmentSaved=true`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save assessment.");
      setSaving(false);
    }
  }

  /* ── Patient selection (shown only when no patientId in URL) ─────────── */

  if (!patientSelected) {
    return (
      <div className="min-h-screen bg-[#0B1220] px-6 py-8 text-white">
        <div className="mx-auto max-w-2xl">
          <Link
            href="/clinician/patients"
            className="mb-6 flex items-center gap-1.5 text-sm text-white/35 transition hover:text-white/65"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
              />
            </svg>
            Patients
          </Link>
          <div className="mb-8">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/25">
              New Assessment
            </p>
            <h1 className="mt-1.5 text-2xl font-bold text-white">
              Select Patient
            </h1>
            <p className="mt-1 text-sm text-white/40">
              Choose the patient this assessment is for.
            </p>
          </div>
          <div className="space-y-2">
            {patientsLoading ? (
              <p className="text-sm text-white/30 py-4">Loading patients…</p>
            ) : patientList.length === 0 ? (
              <div className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-4 py-6 text-center">
                <p className="text-sm text-white/40">No patients found.</p>
                <Link
                  href="/clinician/patients/new"
                  className="mt-2 inline-block text-xs font-semibold text-[#5DCAA5] hover:text-[#1D9E75]"
                >
                  Add your first patient →
                </Link>
              </div>
            ) : (
              patientList.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setPatientId(p.id);
                    setSelectedPatient(p);
                    setPatientSelected(true);
                  }}
                  className={`flex w-full items-center gap-4 rounded-[8px] border px-4 py-3 text-left transition ${
                    patientId === p.id
                      ? "border-[#1D9E75]/40 bg-[#1D9E75]/8"
                      : "border-[#1E2D42] bg-[#0B1220] hover:border-[#1D9E75]/20"
                  }`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[#1D9E75]/10 text-[11px] font-bold text-[#5DCAA5]">
                    {p.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">{p.full_name}</p>
                    <p className="text-xs text-white/35">{p.diagnosis || "No diagnosis"}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ── 6-step form ─────────────────────────────────────────────────────── */

  return (
    <div className="min-h-screen bg-[#0B1220] px-6 py-8 text-white">
      <div className="mx-auto max-w-2xl">
        {/* Back + patient context */}
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/clinician/patients"
            className="flex items-center gap-1.5 text-sm text-white/35 transition hover:text-white/65"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
              />
            </svg>
            Patients
          </Link>
          {selectedPatient && (
            <p className="text-xs text-white/35">{selectedPatient.full_name}</p>
          )}
        </div>

        {/* Page header */}
        <div className="mb-6">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/25">
            New Assessment
          </p>
          <h1 className="mt-1.5 text-2xl font-bold text-white">
            Clinical Assessment
          </h1>
          <p className="mt-1 text-sm text-white/40">
            Structured clinical documentation for{" "}
            {selectedPatient?.full_name ?? "patient"}.
          </p>
          <p className="mt-1.5 text-[11px] text-white/20">
            Clinical documentation support only. No automated diagnosis or treatment decisions are generated.
          </p>
        </div>

        {/* Step indicator */}
        <div className="mb-8">
          <StepBar step={step} />
        </div>

        {/* Form card */}
        <div className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-7">

          {/* ── STEP 1: Body Region ──────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-white">Body Region</h2>
                <p className="mt-1 text-sm text-white/40">
                  Select the primary region being assessed.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-2 sm:grid-cols-4">
                {REGIONS.map((region) => (
                  <button
                    key={region}
                    type="button"
                    onClick={() => {
                      setBodyRegion(region);
                      setRomValues({});
                      setRomValuesLeft({});
                    }}
                    className={`rounded-[8px] border px-3 py-3 text-left text-sm font-semibold transition ${
                      bodyRegion === region
                        ? "border-[#1D9E75]/50 bg-[#1D9E75]/10 text-[#5DCAA5]"
                        : "border-[#1E2D42] bg-[#0B1220] text-white/50 hover:border-[#1D9E75]/20 hover:text-white/80"
                    }`}
                  >
                    {region}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── STEP 2: Range of Motion ─────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-white">
                  Range of Motion
                </h2>
                <p className="mt-1 text-sm text-white/40">
                  Record measured joint ROM values for {bodyRegion}.
                </p>
              </div>

              {bodyRegion === "Gait/Balance" ? (
                <p className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3 text-sm text-white/30 italic">
                  ROM measurement is not applicable for this region. Proceed to
                  the next step.
                </p>
              ) : (
                <div className="space-y-5">
                  {/* Left/Right toggle */}
                  <label className="flex cursor-pointer items-center gap-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={leftRightEnabled}
                      onClick={() => setLeftRightEnabled((v) => !v)}
                      className={`relative h-5 w-9 rounded-full border transition-colors ${
                        leftRightEnabled
                          ? "border-[#1D9E75] bg-[#1D9E75]/20"
                          : "border-[#1E2D42] bg-[#0B1220]"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full transition-transform ${
                          leftRightEnabled
                            ? "translate-x-4 bg-[#1D9E75]"
                            : "bg-[#2A3A52]"
                        }`}
                      />
                    </button>
                    <span className="text-xs text-white/50">
                      Compare left / right sides
                    </span>
                  </label>

                  {regionFields.map((field) => {
                    const val = romValues[field.label] ?? 0;
                    const withinRange =
                      val >= field.normalMin && val <= field.normalMax;
                    const belowRange = val > 0 && val < field.normalMin;
                    const aboveRange = val > field.normalMax;

                    return (
                      <div key={field.label} className="space-y-2">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-white/35">
                          {field.label}{" "}
                          <span className="normal-case font-normal text-white/20">
                            (Normal: {field.normalMin}–{field.normalMax}
                            {field.unit})
                          </span>
                        </p>
                        <div
                          className={`grid gap-2 ${leftRightEnabled ? "grid-cols-2" : "grid-cols-1"}`}
                        >
                          {leftRightEnabled && (
                            <div>
                              <p className="mb-1 text-[10px] text-white/30">
                                Left
                              </p>
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min={0}
                                  max={300}
                                  step={1}
                                  value={romValuesLeft[field.label] ?? ""}
                                  onChange={(e) =>
                                    setRomValuesLeft((prev) => ({
                                      ...prev,
                                      [field.label]: Number(e.target.value),
                                    }))
                                  }
                                  placeholder="—"
                                  className={`${inputCls} font-mono`}
                                />
                                <span className="shrink-0 text-xs text-white/30">
                                  {field.unit}
                                </span>
                              </div>
                            </div>
                          )}
                          <div>
                            {leftRightEnabled && (
                              <p className="mb-1 text-[10px] text-white/30">
                                Right
                              </p>
                            )}
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={0}
                                max={300}
                                step={1}
                                value={romValues[field.label] ?? ""}
                                onChange={(e) =>
                                  setRomValues((prev) => ({
                                    ...prev,
                                    [field.label]: Number(e.target.value),
                                  }))
                                }
                                placeholder="—"
                                className={`${inputCls} font-mono`}
                              />
                              <span className="shrink-0 text-xs text-white/30">
                                {field.unit}
                              </span>
                            </div>
                          </div>
                        </div>
                        {val > 0 && (
                          <span
                            className={`inline-block rounded-[4px] px-2 py-0.5 text-[10px] font-semibold ${
                              withinRange
                                ? "bg-[#1D9E75]/10 text-[#5DCAA5]"
                                : belowRange
                                  ? "bg-amber-500/10 text-amber-400"
                                  : aboveRange
                                    ? "bg-[#1E2D42] text-white/40"
                                    : ""
                            }`}
                          >
                            {withinRange
                              ? "Within normal range"
                              : belowRange
                                ? "Below normal range"
                                : "Above normal range"}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Pain & Symptoms ─────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-bold text-white">
                  Pain & Symptoms
                </h2>
                <p className="mt-1 text-sm text-white/40">
                  Document patient-reported pain and symptom profile.
                </p>
              </div>

              <Field label="Pain at rest  —  0 = no pain · 10 = worst imaginable">
                <PainScale value={painAtRest} onChange={setPainAtRest} />
              </Field>

              <Field label="Pain on movement  —  0 = no pain · 10 = worst imaginable">
                <PainScale
                  value={painOnMovement}
                  onChange={setPainOnMovement}
                />
              </Field>

              <Field label="Pain location">
                <input
                  type="text"
                  value={painLocation}
                  onChange={(e) => setPainLocation(e.target.value)}
                  placeholder="e.g. medial knee, anterior shoulder, L4-L5 level"
                  className={inputCls}
                />
              </Field>

              <Field label="Onset *">
                <div className="flex gap-2">
                  {ONSET_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setOnset(o.value)}
                      className={`flex-1 rounded-[7px] border px-3 py-2.5 text-sm font-semibold transition ${
                        onset === o.value
                          ? "border-[#1D9E75]/50 bg-[#1D9E75]/10 text-[#5DCAA5]"
                          : "border-[#1E2D42] bg-[#0B1220] text-white/40 hover:text-white/70"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Aggravating factors">
                <TagSelector
                  options={AGGRAVATING_OPTIONS}
                  selected={aggravating}
                  onToggle={toggleAggravating}
                />
              </Field>
            </div>
          )}

          {/* ── STEP 4: Functional Tests ─────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-white">
                  Functional Tests
                </h2>
                <p className="mt-1 text-sm text-white/40">
                  Record results for standard {bodyRegion} clinical tests.
                </p>
              </div>

              {allTests.length === 0 && (
                <p className="text-sm italic text-white/30">
                  No standard tests for this region. Add a custom test below.
                </p>
              )}

              {allTests.length > 0 && (
                <div className="space-y-1.5">
                  <div className="grid items-center gap-3 px-1 pb-1"
                    style={{ gridTemplateColumns: "1fr auto 140px" }}>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/25">
                      Test
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/25">
                      Result
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/25">
                      Notes
                    </span>
                  </div>
                  {allTests.map((testName) => (
                    <div
                      key={testName}
                      className="grid items-center gap-3 rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-3 py-2.5"
                      style={{ gridTemplateColumns: "1fr auto 140px" }}
                    >
                      <span className="text-sm text-white/70">{testName}</span>
                      <div className="flex gap-1">
                        {(["pass", "limited", "fail"] as const).map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setTestResult(testName, r)}
                            className={`rounded-[5px] border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                              testResults[testName] === r
                                ? r === "pass"
                                  ? "border-[#1D9E75]/50 bg-[#1D9E75]/15 text-[#5DCAA5]"
                                  : r === "limited"
                                    ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                                    : "border-rose-500/50 bg-rose-500/10 text-rose-400"
                                : "border-[#1E2D42] text-white/25 hover:text-white/50"
                            }`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        value={testNotes[testName] ?? ""}
                        onChange={(e) => setTestNote(testName, e.target.value)}
                        placeholder="Notes"
                        className="rounded-[6px] border border-[#1E2D42] bg-[#0B1220] px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-white/20 focus:border-[#1D9E75]/40"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Add custom test */}
              <div className="flex gap-2 pt-2">
                <input
                  type="text"
                  value={customTestInput}
                  onChange={(e) => setCustomTestInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCustomTest()}
                  placeholder="Add custom test…"
                  className="flex-1 rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#1D9E75]/40"
                />
                <button
                  type="button"
                  onClick={addCustomTest}
                  className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-4 py-2.5 text-sm font-semibold text-white/50 transition hover:border-[#1D9E75]/20 hover:text-white"
                >
                  Add
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 5: Clinical Observations ──────────────────────────────── */}
          {step === 5 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-white">
                  Clinical Observations
                </h2>
                <p className="mt-1 text-sm text-white/40">
                  Document your findings and objective observations.
                </p>
              </div>

              <Field label="Clinical notes *">
                <textarea
                  rows={5}
                  value={clinicalNotes}
                  onChange={(e) => setClinicalNotes(e.target.value)}
                  placeholder="Document your clinical findings and interpretation…"
                  className={`${inputCls} min-h-[80px] resize-none`}
                />
              </Field>

              {(bodyRegion === "Gait/Balance" ||
                bodyRegion === "Lumbar" ||
                bodyRegion === "Hip") && (
                <Field label="Gait observations (optional)">
                  <textarea
                    rows={3}
                    value={gaitObs}
                    onChange={(e) => setGaitObs(e.target.value)}
                    placeholder="Note observed gait deviations, antalgic patterns, or compensations…"
                    className={`${inputCls} min-h-[80px] resize-none`}
                  />
                </Field>
              )}

              <Field label="Postural findings (optional)">
                <textarea
                  rows={3}
                  value={posturalFindings}
                  onChange={(e) => setPosturalFindings(e.target.value)}
                  placeholder="Document static posture, scoliosis, pelvic alignment…"
                  className={`${inputCls} min-h-[80px] resize-none`}
                />
              </Field>
            </div>
          )}

          {/* ── STEP 6: Classification ──────────────────────────────────────── */}
          {step === 6 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-bold text-white">
                  Classification
                </h2>
                <p className="mt-1 text-sm text-white/40">
                  Define rehabilitation phase and treatment goals.
                </p>
              </div>

              <Field label="Rehabilitation phase *">
                <div className="grid grid-cols-2 gap-2">
                  {REHAB_PHASES.map((phase) => (
                    <button
                      key={phase}
                      type="button"
                      onClick={() => setRehabPhase(phase)}
                      className={`rounded-[7px] border px-4 py-3 text-left transition ${
                        rehabPhase === phase
                          ? "border-[#1D9E75]/50 bg-[#1D9E75]/10 text-[#5DCAA5]"
                          : "border-[#1E2D42] bg-[#0B1220] text-white/40 hover:text-white/70"
                      }`}
                    >
                      <p className="text-sm font-semibold">{phase}</p>
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Rehabilitation goals">
                <TagSelector
                  options={GOAL_OPTIONS}
                  selected={rehabGoals}
                  onToggle={toggleGoal}
                />
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={customGoal}
                    onChange={(e) => setCustomGoal(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addCustomGoal()}
                    placeholder="Add custom goal…"
                    className="flex-1 rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#1D9E75]/40"
                  />
                  <button
                    type="button"
                    onClick={addCustomGoal}
                    className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-4 py-2.5 text-sm font-semibold text-white/50 transition hover:border-[#1D9E75]/20 hover:text-white"
                  >
                    Add
                  </button>
                </div>
                {/* Custom goals list */}
                {rehabGoals
                  .filter((g) => !GOAL_OPTIONS.includes(g as typeof GOAL_OPTIONS[number]))
                  .map((g) => (
                    <div key={g} className="mt-2 flex items-center gap-2">
                      <span className="rounded-[6px] border border-[#1D9E75]/50 bg-[#1D9E75]/10 px-3 py-1.5 text-xs font-semibold text-[#5DCAA5]">
                        {g}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setRehabGoals((prev) => prev.filter((x) => x !== g))
                        }
                        className="text-xs text-white/25 hover:text-white/50"
                      >
                        ×
                      </button>
                    </div>
                  ))}
              </Field>

              <div className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3 text-[11px] leading-5 text-white/25">
                This record is clinical documentation only. RASQ does not generate diagnoses, prognoses, or automated treatment decisions. All clinical judgements remain the responsibility of the treating clinician.
              </div>

              {saveError && (
                <p className="text-sm text-rose-400">{saveError}</p>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="mt-5 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(s - 1, 1))}
            disabled={step === 1}
            className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-5 py-2.5 text-sm font-semibold text-white/50 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            ← Back
          </button>

          {step < 6 ? (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(s + 1, 6))}
              disabled={!canAdvance()}
              className="rounded-[7px] bg-[#1D9E75] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#179165] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue →
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !canAdvance()}
              className="rounded-[7px] bg-[#1D9E75] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#179165] disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save assessment"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function NewAssessmentPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#0B1220]">
          <p className="text-sm text-white/30">Loading…</p>
        </div>
      }
    >
      <NewAssessmentInner />
    </Suspense>
  );
}
