"use client";

import {
  findBatteryRomTest,
  peakObservedAngleDeg,
} from "@/app/lib/remote-upper-limb-battery/extract-battery-payload";
import {
  formatBatteryArmLabel,
  type RemoteUpperLimbBatteryPayload,
} from "@/app/lib/remote-upper-limb-battery/types";
import { formatCvTrackingSignal } from "@/app/lib/cv/cv-metrics-display";

type RemoteUpperLimbBatteryResultsBlockProps = {
  battery: RemoteUpperLimbBatteryPayload;
};

const ROM_TESTS = [
  { testId: "shoulderAbduction" as const, label: "Shoulder abduction peak angle" },
  { testId: "shoulderFlexion" as const, label: "Shoulder flexion peak angle" },
  { testId: "elbowFlexion" as const, label: "Elbow flexion peak angle" },
];

export function RemoteUpperLimbBatteryResultsBlock({
  battery,
}: RemoteUpperLimbBatteryResultsBlockProps) {
  const sideLabel = formatBatteryArmLabel(battery.testedSide);

  return (
    <section className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6">
      <h2 className="text-base font-bold text-white">Remote Upper-Limb Battery results</h2>
      <p className="mt-1 text-xs leading-relaxed text-white/40">
        Camera-derived peak angles for therapist review. Greater observed angle is not
        automatically improvement. Not a diagnosis or composite score.
      </p>
      <p className="mt-3 text-sm text-white/70">
        Tested side: <span className="font-semibold text-white">{sideLabel}</span>
      </p>

      <div className="mt-4 grid gap-3">
        {ROM_TESTS.map((item) => {
          const test = findBatteryRomTest(battery, item.testId);
          const peak = test ? peakObservedAngleDeg(test.peakAnglesDeg) : null;
          return (
            <div
              key={item.testId}
              className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3"
            >
              <p className="text-sm font-semibold text-white">{item.label}</p>
              <p className="mt-1 font-mono text-lg font-bold text-white">
                {peak != null ? `${peak.toFixed(1)}°` : "Not recorded"}
              </p>
              {test ? (
                <p className="mt-1 text-xs text-white/45">
                  Reps {test.repsCompleted}/{test.repsRequired}
                  {test.peakAnglesDeg.length > 0
                    ? ` · Peaks ${test.peakAnglesDeg.map((angle) => `${angle.toFixed(0)}°`).join(", ")}`
                    : ""}
                  {" · "}
                  {formatCvTrackingSignal(test.trackingQuality)}
                </p>
              ) : (
                <p className="mt-1 text-xs text-white/40">No structured result for this test.</p>
              )}
            </div>
          );
        })}
      </div>

      {battery.tests.some((test) => test.testId === "functionalReach") ? (
        <div className="mt-3 rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3">
          <p className="text-sm font-semibold text-white">Functional Reach</p>
          <p className="mt-1 text-xs leading-relaxed text-white/45">
            Forward reach was included in this battery. A calibrated reach-distance measurement
            is not available in this release, so no distance value is shown.
          </p>
        </div>
      ) : null}
    </section>
  );
}
