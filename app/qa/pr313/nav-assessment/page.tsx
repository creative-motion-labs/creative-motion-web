"use client";

import Link from "next/link";

export const PR313_TOKEN_A = "11111111-1111-4111-8111-111111111111";
export const PR313_TOKEN_B = "22222222-2222-4222-8222-222222222222";

export default function Pr313NavAssessmentPage() {
  return (
    <>
      <h1 className="text-xl font-bold">Questionnaire token navigation</h1>
      <p className="mt-2 text-sm text-white/55">Use Next.js client links (no full document reload).</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          data-testid="nav-token-a"
          className="rounded bg-[#1D9E75] px-3 py-2 text-sm font-semibold"
          href={`/assessment/${PR313_TOKEN_A}`}
        >
          Token A (Alpha)
        </Link>
        <Link
          data-testid="nav-token-b"
          className="rounded bg-[#1D9E75] px-3 py-2 text-sm font-semibold"
          href={`/assessment/${PR313_TOKEN_B}`}
        >
          Token B (Beta)
        </Link>
        <Link
          data-testid="nav-token-invalid"
          className="rounded border border-white/20 px-3 py-2 text-sm"
          href="/assessment/not-a-valid-token"
        >
          Invalid token
        </Link>
      </div>
    </>
  );
}
