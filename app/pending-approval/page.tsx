"use client";

import Link from "next/link";
import { createClient as createSupabaseClient } from "../lib/supabase/browser";

export default function PendingApprovalPage() {
  async function handleSignOut() {
    const supabase = createSupabaseClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#080E14] px-6 py-16 text-white">
      <div className="w-full max-w-md rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-8">
        <h1 className="text-xl font-bold text-white">Access Pending Review</h1>
        <p className="mt-3 text-sm leading-6 text-white/50">
          Your request to access RASQ is currently under review. Our team will contact
          you once access has been approved.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="flex-1 rounded-[7px] border border-[#1E2D42] bg-[#0B1220] py-3 text-sm font-semibold text-white/70 transition hover:text-white"
          >
            Sign out
          </button>
          <Link
            href="/"
            className="flex-1 rounded-[7px] bg-[#1D9E75] py-3 text-center text-sm font-bold text-white transition hover:bg-[#179165]"
          >
            Back to RASQ
          </Link>
        </div>
      </div>
    </main>
  );
}
