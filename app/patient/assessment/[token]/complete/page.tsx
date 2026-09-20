"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

export default function PatientRemoteUlmsCompletePage() {
  const params = useParams();
  const token = String(params.token || "");

  return (
    <main className="min-h-screen bg-[#0B1220] px-6 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#1D9E75]">
          RASQ · Remote assessment
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">Thank you</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/55">
          Your assessment has been sent to your therapist. You may close this page.
        </p>

        {token ? (
          <p className="mt-6 text-xs text-white/35">
            Reference: {token.slice(0, 8)}…
          </p>
        ) : null}

        <Link
          href="/"
          className="mt-8 inline-flex rounded-[7px] bg-[#1D9E75] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#178f68]"
        >
          Done
        </Link>
      </div>
    </main>
  );
}
