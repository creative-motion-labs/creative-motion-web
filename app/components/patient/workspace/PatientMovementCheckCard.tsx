"use client";

import type { PatientMovementCheckView } from "@/app/lib/patient-movement-check";
import type { PatientPortalLanguage } from "@/app/lib/patient-portal-ui";
import { workspaceUi } from "@/app/lib/patient-portal-ui";

type Props = {
  view: PatientMovementCheckView | null;
  lang: PatientPortalLanguage;
  arClass: string;
  textDir: "ltr" | "rtl";
};

function formatValue(
  exerciseId: string,
  value: number,
  ui: ReturnType<typeof workspaceUi>,
): string {
  if (exerciseId === "single-leg-stance") return ui.holdSecondsUnit(value);
  return ui.reachesUnit(value);
}

function exerciseLabel(exerciseId: string, ui: ReturnType<typeof workspaceUi>): string {
  if (exerciseId === "single-leg-stance") return ui.singleLegStanceLabel;
  return ui.functionalReachLabel;
}

export function PatientMovementCheckCard({ view, lang, arClass, textDir }: Props) {
  const ui = workspaceUi(lang);
  const rows = (view?.exercises ?? []).filter((item) => item.latest != null);

  // No Functional Reach / balance-hold results: show nothing rather than an empty promise.
  if (rows.length === 0) return null;

  return (
    <section
      className={`rounded-[20px] border border-[#E2E8E5] bg-white p-5 shadow-[0_8px_30px_rgba(10,15,26,0.06)] ${arClass}`}
      dir={textDir}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#374151]">
        {ui.movementCheckTitle}
      </p>
      <p className="mt-1 text-[12px] text-[#6B7280]">{ui.movementCheckSubtitle}</p>

      <div className="mt-4 space-y-3">
        {rows.map((item) => (
          <div
            key={item.exerciseId}
            className="rounded-[8px] border border-[#E2E8E5] bg-[#F9FAFB] p-4"
          >
            <p className="text-[14px] font-semibold text-[#0A0F1A]">
              {exerciseLabel(item.exerciseId, ui)}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {item.latest ? (
                <div className="rounded-[6px] border border-[#E2E8E5] bg-white px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">
                    {ui.latestResult}
                  </p>
                  <p
                    className="mt-0.5 text-[15px] font-bold text-[#1D9E75]"
                    style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
                  >
                    {formatValue(item.exerciseId, item.latest.value, ui)}
                  </p>
                </div>
              ) : null}
              {item.best ? (
                <div className="rounded-[6px] border border-[#E2E8E5] bg-white px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">
                    {ui.bestResult}
                  </p>
                  <p
                    className="mt-0.5 text-[15px] font-bold text-[#374151]"
                    style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
                  >
                    {formatValue(item.exerciseId, item.best.value, ui)}
                  </p>
                </div>
              ) : null}
            </div>
            {item.hasComparison && item.before && item.latest ? (
              <p className="mt-3 text-[12px] text-[#6B7280]">
                {ui.beforeVsLatest}:{" "}
                <span className="font-semibold text-[#374151]">
                  {formatValue(item.exerciseId, item.before.value, ui)}
                </span>
                {" → "}
                <span className="font-semibold text-[#1D9E75]">
                  {formatValue(item.exerciseId, item.latest.value, ui)}
                </span>
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
