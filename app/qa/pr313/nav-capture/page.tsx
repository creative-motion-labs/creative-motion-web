"use client";

import Link from "next/link";

export const PR313_CAPTURE_PATIENT_A = "e2e00000-0000-4000-a000-0000000000a1";
export const PR313_CAPTURE_PATIENT_B = "e2e00000-0000-4000-a000-0000000000b2";

export default function Pr313NavCapturePage() {
  return (
    <>
      <h1 className="text-xl font-bold">Clinician capture patient navigation</h1>
      <p className="mt-2 text-sm text-white/55">Requires dev auth bypass cookie in E2E.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          data-testid="nav-capture-a"
          className="rounded bg-[#1D9E75] px-3 py-2 text-sm font-semibold"
          href={`/clinician/patients/${PR313_CAPTURE_PATIENT_A}/upper-limb-motor-screen/capture`}
        >
          Patient A
        </Link>
        <Link
          data-testid="nav-capture-b"
          className="rounded bg-[#1D9E75] px-3 py-2 text-sm font-semibold"
          href={`/clinician/patients/${PR313_CAPTURE_PATIENT_B}/upper-limb-motor-screen/capture`}
        >
          Patient B
        </Link>
      </div>
    </>
  );
}
