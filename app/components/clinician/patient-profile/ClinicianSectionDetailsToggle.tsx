"use client";

import { useId, useState, type ReactNode } from "react";

type ClinicianSectionDetailsToggleProps = {
  summaryLabel?: string;
  children: ReactNode;
  defaultOpen?: boolean;
};

export function ClinicianSectionDetailsToggle({
  summaryLabel = "View details",
  children,
  defaultOpen = false,
}: ClinicianSectionDetailsToggleProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className="mt-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        className="rounded-[6px] border border-[#1E2D42] bg-[#0B1220] px-3.5 py-2 text-xs font-semibold text-[#5DCAA5] transition hover:border-[#1D9E75]/30 hover:bg-[#1D9E75]/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]/50"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide details" : summaryLabel}
      </button>
      <div
        id={panelId}
        hidden={!open}
        className={open ? "mt-4 space-y-4" : undefined}
      >
        {children}
      </div>
    </div>
  );
}
