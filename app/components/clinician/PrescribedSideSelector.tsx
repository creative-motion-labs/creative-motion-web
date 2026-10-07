"use client";

import { useId } from "react";
import type { ClinicalPrescribedSide } from "@/app/lib/clinical/clinical-prescribed-side";
import { buildPrescribedSideRadioIds } from "@/app/lib/clinical/prescribed-side-selector-ids";

type PrescribedSideSelectorProps = {
  /** Distinguishes guided vs catalog (and other) selector instances on one page. */
  groupIdPrefix: string;
  sessionLabel: string;
  value: ClinicalPrescribedSide | null | undefined;
  onChange: (side: ClinicalPrescribedSide) => void;
  disabled?: boolean;
};

const OPTIONS: { value: ClinicalPrescribedSide; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

/**
 * Clinician-authored prescribed treatment side for an Interactive Shoulder session.
 * No default selection — clinician must choose explicitly.
 */
export function PrescribedSideSelector({
  groupIdPrefix,
  sessionLabel,
  value,
  onChange,
  disabled = false,
}: PrescribedSideSelectorProps) {
  const reactId = useId();
  const { groupName, leftInputId, rightInputId } = buildPrescribedSideRadioIds(
    groupIdPrefix,
    reactId,
  );

  return (
    <fieldset
      className="rounded-[6px] border border-[#1E2D42] bg-[#0F1825] px-3 py-3"
      disabled={disabled}
    >
      <legend className="px-1 text-[10px] font-bold uppercase tracking-wider text-white/40">
        Prescribed treatment side for {sessionLabel}
      </legend>
      <p className="mb-2 text-[11px] leading-snug text-white/45">
        Choose which side this session&apos;s movement treatment is prescribed for. This is the
        therapist-authored plan side, not an assessment observation.
      </p>
      <div className="flex flex-wrap gap-3" role="radiogroup" aria-label={`Prescribed treatment side for ${sessionLabel}`}>
        {OPTIONS.map((option) => {
          const checked = value === option.value;
          const inputId = option.value === "left" ? leftInputId : rightInputId;
          return (
            <label
              key={option.value}
              htmlFor={inputId}
              className={`flex min-w-[7rem] cursor-pointer items-center gap-2 rounded-[6px] border px-3 py-2 text-sm transition ${
                checked
                  ? "border-[#1D9E75]/50 bg-[#1D9E75]/10 text-white"
                  : "border-[#1E2D42] bg-[#0B1220] text-white/75 hover:border-[#1D9E75]/25"
              } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                id={inputId}
                type="radio"
                name={groupName}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="h-4 w-4 accent-[#1D9E75]"
              />
              <span className="font-medium">{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
