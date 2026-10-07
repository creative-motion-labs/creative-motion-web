"use client";

import Link from "next/link";
import type { BatteryClinicianSummary } from "@/app/lib/remote-upper-limb-battery/battery-clinician-summary";

type RemoteUpperLimbBatteryResultsCardProps = {
  summary: BatteryClinicianSummary;
  reportHref: string;
};

export function RemoteUpperLimbBatteryResultsCard({
  summary,
  reportHref,
}: RemoteUpperLimbBatteryResultsCardProps) {
  return (
    <section
      id="remote-upper-limb-battery-results"
      className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">{summary.title}</h2>
          <p className="mt-1 text-xs text-white/45">
            {new Date(summary.submittedAt).toLocaleString()} · Tested side: {summary.testedSideLabel}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-[5px] border border-lime-300/20 bg-lime-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-lime-300">
            Completed
          </span>
          <span className="rounded-[5px] border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">
            Therapist review required
          </span>
        </div>
      </div>

      <Link
        href={reportHref}
        className="mt-5 inline-flex rounded-[7px] border border-[#1D9E75]/25 bg-[#1D9E75]/10 px-4 py-2.5 text-xs font-semibold text-[#5DCAA5] transition hover:bg-[#1D9E75]/15"
      >
        View Assessment Report
      </Link>
    </section>
  );
}
