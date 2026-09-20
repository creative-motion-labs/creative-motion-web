"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  AFFECTED_ARM_SUPPORT_LEVELS,
  BACK_TRUNK_SUPPORT_LEVELS,
  CAREGIVER_SUPERVISION_REQUIREMENTS,
  STARTING_SITTING_POSITIONS,
  UPPER_LIMB_DELIVERY_MODES,
  UPPER_LIMB_SIDES,
} from "@/app/lib/upper-limb-motor-screen/types";
import {
  FORWARD_REACH_ASSIGNMENT_USER_MESSAGES,
  createEmptyForwardReachAssignmentForm,
  createForwardReachAssignmentSubmitter,
  type ForwardReachAssignmentCreateSuccess,
  type ForwardReachAssignmentFormState,
  type ForwardReachFormFieldError,
} from "@/app/lib/upper-limb-motor-screen/forward-reach-assignment-client";
import {
  shouldIgnoreForwardReachAssignmentResult,
} from "@/app/lib/upper-limb-motor-screen/forward-reach-assignment-panel-lifecycle";

type ForwardReachAssignmentClientProps = {
  patientId: string;
  patientName: string;
};

const SIDE_LABELS: Record<(typeof UPPER_LIMB_SIDES)[number], string> = {
  left: "Left",
  right: "Right",
};

const STARTING_POSITION_LABELS: Record<(typeof STARTING_SITTING_POSITIONS)[number], string> = {
  edge_of_bed: "Edge of bed",
  chair_with_armrests: "Chair with armrests",
  chair_without_armrests: "Chair without armrests",
  wheelchair: "Wheelchair",
};

const BACK_SUPPORT_LABELS: Record<(typeof BACK_TRUNK_SUPPORT_LEVELS)[number], string> = {
  full_back_support: "Full back support",
  partial_back_support: "Partial back support",
  none: "None",
};

const ARM_SUPPORT_LABELS: Record<(typeof AFFECTED_ARM_SUPPORT_LEVELS)[number], string> = {
  armrest: "Armrest",
  lap_support: "Lap support",
  sling: "Sling",
  none: "None",
};

const SUPERVISION_LABELS: Record<(typeof CAREGIVER_SUPERVISION_REQUIREMENTS)[number], string> = {
  required: "Required",
  not_required: "Not required",
};

const DELIVERY_LABELS: Record<(typeof UPPER_LIMB_DELIVERY_MODES)[number], string> = {
  in_clinic: "In clinic",
  remote_supervised: "Remote supervised",
};

function fieldError(
  errors: ForwardReachFormFieldError[],
  field: keyof ForwardReachAssignmentFormState,
): string | undefined {
  return errors.find((entry) => entry.field === field)?.message;
}

function SelectField<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
  labels,
  placeholder,
  error,
}: {
  id: string;
  label: string;
  value: T | "";
  onChange: (value: T) => void;
  options: readonly T[];
  labels: Record<T, string>;
  placeholder: string;
  error?: string;
}) {
  return (
    <label className="block" htmlFor={id}>
      <span className="text-xs font-semibold text-white/70">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="mt-1.5 w-full rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#1D9E75]/40"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </select>
      {error ? <p className="mt-1 text-[11px] text-rose-300">{error}</p> : null}
    </label>
  );
}

export function ForwardReachAssignmentClient({
  patientId,
  patientName,
}: ForwardReachAssignmentClientProps) {
  const submitterRef = useRef(createForwardReachAssignmentSubmitter());
  const assignAbortRef = useRef<AbortController | null>(null);
  const patientScopeRef = useRef(0);

  const [form, setForm] = useState<ForwardReachAssignmentFormState>(
    createEmptyForwardReachAssignmentForm,
  );
  const [fieldErrors, setFieldErrors] = useState<ForwardReachFormFieldError[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<ForwardReachAssignmentCreateSuccess | null>(null);

  useEffect(() => {
    const submitter = submitterRef.current;
    return () => {
      assignAbortRef.current?.abort();
      submitter.getController().resetAll();
    };
  }, []);

  function updateField<K extends keyof ForwardReachAssignmentFormState>(
    key: K,
    value: ForwardReachAssignmentFormState[K],
  ) {
    if (submitterRef.current.inFlight) return;
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => current.filter((entry) => entry.field !== key));
    setSubmitError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || submitterRef.current.inFlight || created) return;

    const scopeAtStart = patientScopeRef.current;
    const generationAtStart = submitterRef.current.getController().getGeneration();

    setSubmitting(true);
    setSubmitError(null);
    setFieldErrors([]);

    assignAbortRef.current?.abort();
    const abort = new AbortController();
    assignAbortRef.current = abort;

    const result = await submitterRef.current.submit(patientId, form, {
      signal: abort.signal,
      scopeAtStart,
      currentScope: () => patientScopeRef.current,
      generationAtStart,
      currentGeneration: () => submitterRef.current.getController().getGeneration(),
    });

    if (
      shouldIgnoreForwardReachAssignmentResult({
        scopeAtStart,
        currentScope: patientScopeRef.current,
        generationAtStart,
        currentGeneration: submitterRef.current.getController().getGeneration(),
        aborted: abort.signal.aborted,
      })
    ) {
      return;
    }

    setSubmitting(false);

    if (!result.ok) {
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      setSubmitError(result.message);
      return;
    }

    setCreated(result.assignment);
  }

  if (created) {
    return (
      <div className="rounded-[10px] border border-[#1D9E75]/25 bg-[#1D9E75]/8 px-5 py-5">
        <p className="text-sm font-semibold text-[#5DCAA5]">
          {FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.success}
        </p>
        <p className="mt-2 text-sm text-white/55">
          Assignment status is <span className="font-semibold text-white">assigned</span> and
          awaits capture workflow integration. Observations will require therapist review before use
          in care planning.
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2.5">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-white/35">Assigned</dt>
            <dd className="mt-1 text-sm text-white/80">
              {new Date(created.assignedAt).toLocaleString()}
            </dd>
          </div>
          <div className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2.5">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-white/35">Status</dt>
            <dd className="mt-1 text-sm text-white/80">{created.status}</dd>
          </div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href={`/clinician/patients/${encodeURIComponent(patientId)}`}
            className="rounded-[7px] border border-[#1D9E75]/25 bg-[#1D9E75]/10 px-4 py-2.5 text-xs font-semibold text-[#5DCAA5] transition hover:bg-[#1D9E75]/15"
          >
            Back to patient profile
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div className="rounded-[10px] border border-amber-400/20 bg-amber-400/5 px-4 py-3.5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-amber-200/90">
          Therapist review required
        </p>
        <p className="mt-2 text-sm leading-relaxed text-white/55">
          This assignment configures a Forward Reach Baseline observation task for{" "}
          <span className="font-semibold text-white/75">{patientName}</span>. Camera-assisted
          metrics support therapist review only. They are not diagnostic and do not replace clinical
          examination.
        </p>
      </div>

      {submitError ? (
        <p className="rounded-[7px] border border-rose-400/20 bg-rose-400/5 px-4 py-3 text-sm text-rose-200">
          {submitError}
        </p>
      ) : null}

      <section className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-5">
        <h2 className="text-sm font-bold text-white">Clinical context</h2>
        <p className="mt-1 text-xs text-white/40">
          Affected side and tested side are recorded separately. Bilateral testing requires two
          sequential assignments.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <SelectField
            id="affectedSide"
            label="Clinically affected side"
            value={form.affectedSide}
            onChange={(value) => updateField("affectedSide", value)}
            options={UPPER_LIMB_SIDES}
            labels={SIDE_LABELS}
            placeholder="Select affected side"
            error={fieldError(fieldErrors, "affectedSide")}
          />
          <SelectField
            id="testedSide"
            label="Forward reach tested side"
            value={form.testedSide}
            onChange={(value) => updateField("testedSide", value)}
            options={UPPER_LIMB_SIDES}
            labels={SIDE_LABELS}
            placeholder="Select tested side"
            error={fieldError(fieldErrors, "testedSide")}
          />
        </div>
      </section>

      <section className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-5">
        <h2 className="text-sm font-bold text-white">Session setup</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <SelectField
            id="startingSittingPosition"
            label="Starting sitting position"
            value={form.startingSittingPosition}
            onChange={(value) => updateField("startingSittingPosition", value)}
            options={STARTING_SITTING_POSITIONS}
            labels={STARTING_POSITION_LABELS}
            placeholder="Select position"
            error={fieldError(fieldErrors, "startingSittingPosition")}
          />
          <SelectField
            id="backTrunkSupport"
            label="Back and trunk support"
            value={form.backTrunkSupport}
            onChange={(value) => updateField("backTrunkSupport", value)}
            options={BACK_TRUNK_SUPPORT_LEVELS}
            labels={BACK_SUPPORT_LABELS}
            placeholder="Select support"
            error={fieldError(fieldErrors, "backTrunkSupport")}
          />
          <SelectField
            id="affectedArmSupport"
            label="Affected arm support"
            value={form.affectedArmSupport}
            onChange={(value) => updateField("affectedArmSupport", value)}
            options={AFFECTED_ARM_SUPPORT_LEVELS}
            labels={ARM_SUPPORT_LABELS}
            placeholder="Select arm support"
            error={fieldError(fieldErrors, "affectedArmSupport")}
          />
          <label className="block" htmlFor="baselinePainScore">
            <span className="text-xs font-semibold text-white/70">Baseline pain (0–10)</span>
            <input
              id="baselinePainScore"
              type="number"
              min={0}
              max={10}
              step={1}
              value={form.baselinePainScore}
              onChange={(event) => updateField("baselinePainScore", event.target.value)}
              className="mt-1.5 w-full rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#1D9E75]/40"
              placeholder="Enter 0–10"
            />
            {fieldError(fieldErrors, "baselinePainScore") ? (
              <p className="mt-1 text-[11px] text-rose-300">
                {fieldError(fieldErrors, "baselinePainScore")}
              </p>
            ) : null}
          </label>
          <SelectField
            id="caregiverSupervisionRequirement"
            label="Caregiver supervision"
            value={form.caregiverSupervisionRequirement}
            onChange={(value) => updateField("caregiverSupervisionRequirement", value)}
            options={CAREGIVER_SUPERVISION_REQUIREMENTS}
            labels={SUPERVISION_LABELS}
            placeholder="Select supervision requirement"
            error={fieldError(fieldErrors, "caregiverSupervisionRequirement")}
          />
          <SelectField
            id="deliveryMode"
            label="Delivery mode"
            value={form.deliveryMode}
            onChange={(value) => updateField("deliveryMode", value)}
            options={UPPER_LIMB_DELIVERY_MODES}
            labels={DELIVERY_LABELS}
            placeholder="Select delivery mode"
            error={fieldError(fieldErrors, "deliveryMode")}
          />
        </div>

        <fieldset className="mt-4">
          <legend className="text-xs font-semibold text-white/70">Permitted movement range</legend>
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-white/70">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="permittedMovementRangeKind"
                checked={form.permittedMovementRangeKind === "not_applicable"}
                onChange={() => updateField("permittedMovementRangeKind", "not_applicable")}
              />
              Not applicable
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="permittedMovementRangeKind"
                checked={form.permittedMovementRangeKind === "configured"}
                onChange={() => updateField("permittedMovementRangeKind", "configured")}
              />
              Clinician-described range
            </label>
          </div>
          {fieldError(fieldErrors, "permittedMovementRangeKind") ? (
            <p className="mt-1 text-[11px] text-rose-300">
              {fieldError(fieldErrors, "permittedMovementRangeKind")}
            </p>
          ) : null}
          {form.permittedMovementRangeKind === "configured" ? (
            <label className="mt-3 block" htmlFor="permittedMovementRangeDescription">
              <span className="text-xs font-semibold text-white/70">Movement range description</span>
              <textarea
                id="permittedMovementRangeDescription"
                value={form.permittedMovementRangeDescription}
                onChange={(event) =>
                  updateField("permittedMovementRangeDescription", event.target.value)
                }
                rows={3}
                className="mt-1.5 w-full rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#1D9E75]/40"
                placeholder="Describe the permitted movement boundary for therapist review"
              />
              {fieldError(fieldErrors, "permittedMovementRangeDescription") ? (
                <p className="mt-1 text-[11px] text-rose-300">
                  {fieldError(fieldErrors, "permittedMovementRangeDescription")}
                </p>
              ) : null}
            </label>
          ) : null}
        </fieldset>

        <label className="mt-4 block" htmlFor="patientSpecificStopCriteria">
          <span className="text-xs font-semibold text-white/70">
            Patient-specific stop criteria (optional, one per line)
          </span>
          <textarea
            id="patientSpecificStopCriteria"
            value={form.patientSpecificStopCriteria}
            onChange={(event) => updateField("patientSpecificStopCriteria", event.target.value)}
            rows={3}
            className="mt-1.5 w-full rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#1D9E75]/40"
            placeholder="Leave blank if none apply"
          />
        </label>
      </section>

      <section className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-5">
        <h2 className="text-sm font-bold text-white">Forward Reach Baseline task</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <fieldset>
            <legend className="text-xs font-semibold text-white/70">Task eligible today</legend>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-white/70">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="eligible"
                  checked={form.eligible === true}
                  onChange={() => updateField("eligible", true)}
                />
                Yes
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="eligible"
                  checked={form.eligible === false}
                  onChange={() => updateField("eligible", false)}
                />
                No
              </label>
            </div>
            {fieldError(fieldErrors, "eligible") ? (
              <p className="mt-1 text-[11px] text-rose-300">{fieldError(fieldErrors, "eligible")}</p>
            ) : null}
          </fieldset>
          <label className="block" htmlFor="attempts">
            <span className="text-xs font-semibold text-white/70">Attempts</span>
            <input
              id="attempts"
              type="number"
              min={1}
              step={1}
              value={form.attempts}
              onChange={(event) => updateField("attempts", event.target.value)}
              className="mt-1.5 w-full rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#1D9E75]/40"
              placeholder="e.g. 5"
            />
            {fieldError(fieldErrors, "attempts") ? (
              <p className="mt-1 text-[11px] text-rose-300">{fieldError(fieldErrors, "attempts")}</p>
            ) : null}
          </label>
          <label className="block" htmlFor="restPeriodSeconds">
            <span className="text-xs font-semibold text-white/70">Rest between attempts (seconds)</span>
            <input
              id="restPeriodSeconds"
              type="number"
              min={0}
              step={1}
              value={form.restPeriodSeconds}
              onChange={(event) => updateField("restPeriodSeconds", event.target.value)}
              className="mt-1.5 w-full rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#1D9E75]/40"
              placeholder="e.g. 30"
            />
            {fieldError(fieldErrors, "restPeriodSeconds") ? (
              <p className="mt-1 text-[11px] text-rose-300">
                {fieldError(fieldErrors, "restPeriodSeconds")}
              </p>
            ) : null}
          </label>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block" htmlFor="targetDirection">
            <span className="text-xs font-semibold text-white/70">Target direction</span>
            <input
              id="targetDirection"
              type="text"
              value={form.targetDirection}
              onChange={(event) => updateField("targetDirection", event.target.value)}
              className="mt-1.5 w-full rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#1D9E75]/40"
              placeholder="e.g. forward"
            />
            {fieldError(fieldErrors, "targetDirection") ? (
              <p className="mt-1 text-[11px] text-rose-300">
                {fieldError(fieldErrors, "targetDirection")}
              </p>
            ) : null}
          </label>
          <label className="block" htmlFor="targetHeight">
            <span className="text-xs font-semibold text-white/70">Target height</span>
            <input
              id="targetHeight"
              type="text"
              value={form.targetHeight}
              onChange={(event) => updateField("targetHeight", event.target.value)}
              className="mt-1.5 w-full rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#1D9E75]/40"
              placeholder="e.g. shoulder height"
            />
            {fieldError(fieldErrors, "targetHeight") ? (
              <p className="mt-1 text-[11px] text-rose-300">
                {fieldError(fieldErrors, "targetHeight")}
              </p>
            ) : null}
          </label>
          <label className="block" htmlFor="targetDistance">
            <span className="text-xs font-semibold text-white/70">Target distance</span>
            <input
              id="targetDistance"
              type="text"
              value={form.targetDistance}
              onChange={(event) => updateField("targetDistance", event.target.value)}
              className="mt-1.5 w-full rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#1D9E75]/40"
              placeholder="e.g. arm's length"
            />
            {fieldError(fieldErrors, "targetDistance") ? (
              <p className="mt-1 text-[11px] text-rose-300">
                {fieldError(fieldErrors, "targetDistance")}
              </p>
            ) : null}
          </label>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-[7px] bg-[#1D9E75] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#179165] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Creating assignment…" : "Create assignment"}
        </button>
        <Link
          href={`/clinician/patients/${encodeURIComponent(patientId)}`}
          className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-4 py-2.5 text-sm font-semibold text-white/60 transition hover:text-white"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
