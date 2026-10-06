"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type AccessRequest = {
  auth_user_id: string;
  email: string;
  full_name: string;
  clinic_name: string | null;
  status: string;
  created_at: string;
};

export default function AdminAccessRequestsPage() {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/provider-access-requests?status=pending", {
        credentials: "include",
      });
      const data = (await res.json()) as {
        requests?: AccessRequest[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Unable to load requests.");
        setRequests([]);
        return;
      }
      setRequests(data.requests ?? []);
    } catch {
      setError("Unable to load requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(authUserId: string, action: "approve" | "reject" | "revoke") {
    setBusyId(authUserId);
    setError("");
    try {
      const res = await fetch("/api/admin/provider-access-requests", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authUserId, action }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Action failed.");
        return;
      }
      await load();
    } catch {
      setError("Action failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#0B1220] px-6 py-10 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold">Provider access requests</h1>
            <p className="mt-1 text-sm text-white/45">
              Founder/admin review for RASQ pilot onboarding.
            </p>
          </div>
          <Link href="/admin" className="text-sm text-white/40 hover:text-white/70">
            Back to admin
          </Link>
        </div>

        {error && (
          <div className="mb-4 rounded-[7px] border border-rose-400/20 bg-rose-400/8 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-white/40">Loading pending requests…</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-white/40">No pending requests.</p>
        ) : (
          <ul className="space-y-3">
            {requests.map((req) => (
              <li
                key={req.auth_user_id}
                className="rounded-[8px] border border-[#1E2D42] bg-[#0F1825] p-4"
              >
                <p className="font-semibold text-white">{req.full_name}</p>
                <p className="text-sm text-white/50">{req.email}</p>
                {req.clinic_name && (
                  <p className="text-sm text-white/40">{req.clinic_name}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === req.auth_user_id}
                    onClick={() => void review(req.auth_user_id, "approve")}
                    className="rounded-[6px] bg-[#1D9E75] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busyId === req.auth_user_id}
                    onClick={() => void review(req.auth_user_id, "reject")}
                    className="rounded-[6px] border border-[#1E2D42] px-3 py-2 text-xs font-semibold text-white/60"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
