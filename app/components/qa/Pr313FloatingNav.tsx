"use client";

import Link from "next/link";
import { PR313_TOKEN_A, PR313_TOKEN_B } from "@/app/qa/pr313/nav-assessment/page";
import { PR313_ULMS_A, PR313_ULMS_B } from "@/app/qa/pr313/nav-ulms/page";
import {
  PR313_CAPTURE_PATIENT_A,
  PR313_CAPTURE_PATIENT_B,
} from "@/app/qa/pr313/nav-capture/page";

export function Pr313FloatingNav({ variant }: { variant: "assessment" | "ulms" | "capture" }) {
  if (process.env.NEXT_PUBLIC_PR313_QA_NAV !== "1") {
    return null;
  }

  return (
    <div
      className="fixed bottom-3 left-3 z-[9999] flex flex-wrap gap-2 rounded-lg border border-amber-400/40 bg-[#0B1220]/95 px-3 py-2 text-[11px] shadow-lg"
      data-testid="pr313-floating-nav"
    >
      <span className="font-bold text-amber-200">PR313 QA</span>
      {variant === "assessment" ? (
        <>
          <Link data-testid="float-token-a" href={`/assessment/${PR313_TOKEN_A}`}>
            A
          </Link>
          <Link data-testid="float-token-b" href={`/assessment/${PR313_TOKEN_B}`}>
            B
          </Link>
        </>
      ) : null}
      {variant === "ulms" ? (
        <>
          <Link data-testid="float-ulms-a" href={`/patient/assessment/${PR313_ULMS_A}`}>
            A
          </Link>
          <Link data-testid="float-ulms-b" href={`/patient/assessment/${PR313_ULMS_B}`}>
            B
          </Link>
        </>
      ) : null}
      {variant === "capture" ? (
        <>
          <Link
            data-testid="float-capture-a"
            href={`/clinician/patients/${PR313_CAPTURE_PATIENT_A}/upper-limb-motor-screen/capture`}
          >
            A
          </Link>
          <Link
            data-testid="float-capture-b"
            href={`/clinician/patients/${PR313_CAPTURE_PATIENT_B}/upper-limb-motor-screen/capture`}
          >
            B
          </Link>
        </>
      ) : null}
    </div>
  );
}
