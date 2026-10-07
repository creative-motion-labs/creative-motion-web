"use client";

import Link from "next/link";

type MovementCard = {
  name: string;
  description: string;
  href: string;
  scenarioCount: number;
};

const MOVEMENTS: MovementCard[] = [
  {
    name: "Forward Reach",
    description:
      "Screen-space wrist target task with any-direction onset detection. Observes timing and path metrics.",
    href: "/clinician/motor-screen-lab",
    scenarioCount: 6,
  },
  {
    name: "Lateral Reach",
    description:
      "Screen-space wrist target task with horizontal target-facing onset detection. Observes timing and path metrics.",
    href: "/clinician/lateral-reach-lab",
    scenarioCount: 6,
  },
  {
    name: "Elbow Extension",
    description:
      "Screen-space wrist target task with 2D target-facing onset detection. Observes timing, path, and optional 2D elbow angle.",
    href: "/clinician/elbow-extension-lab",
    scenarioCount: 7,
  },
];

export default function MotorScreenHubPage() {
  return (
    <main className="min-h-screen bg-[#0B1220] px-6 py-8 text-[#F9FAFB]">
      <div className="mx-auto max-w-3xl">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#1D9E75]">
          Creative Motion Lab · RASQ
        </p>
        <h1 className="mt-2 text-xl font-medium text-[#F9FAFB]">
          Upper-Limb Motor Screen
        </h1>
        <p className="mt-1 text-xs text-[#EF9F27]">
          Internal development environment — not for clinical use or patient assessment.
        </p>

        <div
          className="mt-5 rounded-[10px] border border-[#EF9F27] p-4"
          style={{ background: "rgba(239,159,39,0.08)", borderWidth: "0.5px" }}
        >
          <p className="text-xs leading-[1.8] text-[#FCD34D]">
            ⚠ Internal Lab Only
            <br />
            <br />
            These are deterministic software demonstrations for therapist and engineering review.
            They use scripted scenarios with pre-defined coordinates and timestamps.
            <br />
            <br />
            <strong>Phase 1 boundaries:</strong>
            <br />
            - No live camera input
            <br />
            - No patient data persistence
            <br />
            - No real-time capture
            <br />
            <br />
            These demos validate software behavior only. They do not constitute clinical
            measurement, patient assessment, or diagnostic evaluation. All observations require
            therapist review.
          </p>
        </div>

        <section className="mt-8">
          <p className="text-[10px] uppercase tracking-[0.06em] text-[#9CA3AF]">
            Deterministic Movement Demonstrations
          </p>
          <p className="mb-4 mt-1 text-[11px] italic text-[#6B7280]">
            Scripted scenarios exercising core engine behaviors. Each demo includes happy path,
            protective pause, clinical stop, and edge-case scenarios.
          </p>

          <div className="space-y-3">
            {MOVEMENTS.map((movement) => (
              <Link
                key={movement.name}
                href={movement.href}
                className="group block rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-5 transition hover:border-[#1D9E75]/30 hover:bg-[#0d1f18]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] font-semibold text-[#F9FAFB]">
                      {movement.name}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-[#9CA3AF]">
                      {movement.description}
                    </p>
                    <p className="mt-3 text-[11px] text-[#6B7280]">
                      {movement.scenarioCount} deterministic scenarios
                    </p>
                  </div>
                  <div className="shrink-0">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5DCAA5] transition group-hover:translate-x-0.5">
                      Open demo
                      <span aria-hidden>→</span>
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <div className="mt-8 rounded-[8px] border border-[#1E2D42] bg-[#0F1825] p-4">
          <p className="text-[11px] leading-relaxed text-[#6B7280]">
            <strong className="text-[#9CA3AF]">Clinical safety boundary:</strong> These
            deterministic demos produce factual timing and path metrics, and — for Elbow Extension
            only — an optional 2D angle observation. None of these measure range of motion, assess
            movement quality, grade impairment, or provide diagnostic information. Live-camera
            integration and clinical validation workflows remain in development.
          </p>
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/clinician/assessments"
            className="inline-flex items-center gap-1.5 text-xs text-[#5DCAA5] hover:text-[#1D9E75]"
          >
            <span aria-hidden>←</span>
            Back to Assessment Center
          </Link>
        </div>
      </div>
    </main>
  );
}
