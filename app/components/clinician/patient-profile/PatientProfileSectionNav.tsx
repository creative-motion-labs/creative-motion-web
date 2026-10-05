"use client";

import Link from "next/link";
import type { PatientProfileWorkspaceSection } from "@/app/lib/clinician/patient-profile-workspace-sections";
import { PATIENT_PROFILE_SECTION_NAV } from "@/app/lib/clinician/patient-profile-workspace-sections";

type PatientProfileSectionNavProps = {
  activeSection: PatientProfileWorkspaceSection;
  onSelectSection: (section: PatientProfileWorkspaceSection) => void;
  patientId: string;
};

const navButtonBase =
  "rounded-[6px] border px-3 py-1.5 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]/50";

function navButtonClass(active: boolean): string {
  return active
    ? `${navButtonBase} border-[#1D9E75]/35 bg-[#1D9E75]/12 text-[#5DCAA5] shadow-[inset_0_0_0_1px_rgba(29,158,117,0.15)]`
    : `${navButtonBase} border-[#1E2D42] bg-[#0B1220] text-white/45 hover:border-[#1D9E75]/25 hover:text-[#5DCAA5]`;
}

export function PatientProfileSectionNav({
  activeSection,
  onSelectSection,
  patientId,
}: PatientProfileSectionNavProps) {
  return (
    <nav
      className="mt-4 border-b border-[#1E2D42] pb-3"
      aria-label="Patient record sections"
    >
      <div
        role="tablist"
        aria-orientation="horizontal"
        className="-mb-px flex flex-wrap gap-2"
      >
        {PATIENT_PROFILE_SECTION_NAV.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`patient-profile-tab-${id}`}
            aria-selected={activeSection === id}
            aria-controls={`patient-profile-section-${id}`}
            tabIndex={activeSection === id ? 0 : -1}
            className={navButtonClass(activeSection === id)}
            onClick={() => onSelectSection(id)}
            onKeyDown={(e) => {
              const order = PATIENT_PROFILE_SECTION_NAV.map((item) => item.id);
              const idx = order.indexOf(id);
              if (idx < 0) return;
              let nextIdx: number | null = null;
              if (e.key === "ArrowRight") nextIdx = (idx + 1) % order.length;
              if (e.key === "ArrowLeft")
                nextIdx = (idx - 1 + order.length) % order.length;
              if (e.key === "Home") nextIdx = 0;
              if (e.key === "End") nextIdx = order.length - 1;
              if (nextIdx == null) return;
              e.preventDefault();
              onSelectSection(order[nextIdx]!);
              document
                .getElementById(`patient-profile-tab-${order[nextIdx]}`)
                ?.focus();
            }}
          >
            {label}
          </button>
        ))}
        <Link
          href={`/clinician/patients/${patientId}/outcomes`}
          className={`${navButtonBase} border-[#1E2D42] bg-[#0B1220] text-white/45 hover:border-[#1D9E75]/25 hover:text-[#5DCAA5]`}
        >
          Outcomes
        </Link>
        <Link
          href="/clinician/results"
          className={`${navButtonBase} border-[#1E2D42] bg-[#0B1220] text-white/45 hover:border-[#1D9E75]/25 hover:text-[#5DCAA5]`}
        >
          Results
        </Link>
      </div>
    </nav>
  );
}
