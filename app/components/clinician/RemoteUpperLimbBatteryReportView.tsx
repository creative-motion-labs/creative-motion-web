"use client";

import Link from "next/link";
import type { BatteryClinicianSummary } from "@/app/lib/remote-upper-limb-battery/battery-clinician-summary";

type RemoteUpperLimbBatteryReportViewProps = {
  summary: BatteryClinicianSummary;
  profileHref: string;
};

export function RemoteUpperLimbBatteryReportView({
  summary,
  profileHref,
}: RemoteUpperLimbBatteryReportViewProps) {
  return (
    <div className="space-y-5">
      <Link
        href={profileHref}
        className="inline-flex rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-4 py-2.5 text-xs font-semibold text-white/70 transition hover:text-white"
      >
        Back to Patient Profile
      </Link>

      <div className="rounded-[8px] border border-amber-400/20 bg-amber-400/5 px-4 py-3.5">
        <p className="text-sm leading-relaxed text-amber-100/90">{summary.disclaimer}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30">
            Assessment date
          </p>
          <p className="mt-1.5 text-sm font-semibold text-white">
            {new Date(summary.submittedAt).toLocaleString()}
          </p>
        </div>
        <div className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30">
            Tested side
          </p>
          <p className="mt-1.5 text-sm font-semibold text-white">{summary.testedSideLabel}</p>
        </div>
        <div className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30">Status</p>
          <p className="mt-1.5 text-sm font-semibold text-amber-200">Completed · Therapist review required</p>
        </div>
      </div>

      <div className="space-y-3">
        {summary.rows.map((row) => (
          <div key={row.testTitle} className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-4">
            <p className="text-sm font-semibold text-white">{row.testTitle}</p>
            <p className="mt-1 text-xs text-white/55">{row.completion}</p>
            <p className="mt-2 text-sm text-white/85">{row.observation}</p>
            <p className="mt-2 text-[11px] leading-relaxed text-white/40">{row.metricConvention}</p>
            <p className="mt-1 text-[11px] text-white/40">Tracking quality: {row.trackingQuality}</p>
            {row.reviewNote ? (
              <p className="mt-2 text-xs leading-relaxed text-white/45">{row.reviewNote}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
