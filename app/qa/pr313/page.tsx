import Link from "next/link";

export default function Pr313QaHubPage() {
  return (
    <>
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#1D9E75]">PR #313 verification</p>
      <h1 className="mt-4 text-2xl font-bold">Lifecycle QA harness</h1>
      <ul className="mt-6 space-y-3 text-sm">
        <li>
          <Link className="text-[#5DCAA5] underline" href="/qa/pr313/nav-assessment">
            Client nav — remote questionnaire tokens
          </Link>
        </li>
        <li>
          <Link className="text-[#5DCAA5] underline" href="/qa/pr313/nav-ulms">
            Client nav — remote ULMS tokens
          </Link>
        </li>
        <li>
          <Link className="text-[#5DCAA5] underline" href="/qa/pr313/nav-capture">
            Client nav — clinician capture patient IDs
          </Link>
        </li>
        <li>
          <Link className="text-[#5DCAA5] underline" href="/qa/pr313/voice-consent">
            Voice consent persistence check
          </Link>
        </li>
        <li>
          <Link className="text-[#5DCAA5] underline" href="/qa/pr313/rest-countdown">
            Guided rest countdown
          </Link>
        </li>
        <li>
          <Link className="text-[#5DCAA5] underline" href="/qa/pr313/ready-countdown">
            Ready countdown overlay
          </Link>
        </li>
      </ul>
    </>
  );
}
