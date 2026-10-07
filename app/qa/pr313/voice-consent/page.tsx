"use client";

import Link from "next/link";
import { PR313_TOKEN_A } from "../nav-assessment/page";

export default function Pr313VoiceConsentPage() {
  return (
    <>
      <h1 className="text-xl font-bold">Voice consent</h1>
      <p className="mt-2 text-sm text-white/55">
        Open the questionnaire assessment, accept voice consent on the form, reload, and confirm the banner
        stays dismissed when session storage contains consent.
      </p>
      <Link
        data-testid="open-assessment-voice"
        className="mt-4 inline-block rounded bg-[#1D9E75] px-3 py-2 text-sm font-semibold"
        href={`/assessment/${PR313_TOKEN_A}`}
      >
        Open Token A assessment
      </Link>
    </>
  );
}
