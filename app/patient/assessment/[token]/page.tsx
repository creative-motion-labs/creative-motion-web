"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { RemoteUpperLimbBatterySession } from "@/app/components/patient/RemoteUpperLimbBatterySession";
import { getInitialPositionInstruction } from "@/app/lib/remote-upper-limb-battery/battery-patient-copy";
import type { RemoteUpperLimbBatteryPayload, RemoteUpperLimbBatterySide } from "@/app/lib/remote-upper-limb-battery/types";
import { submitRemoteUpperLimbBatteryResult } from "@/app/lib/remote-upper-limb-battery/submit-battery-client";

type RemoteAssessmentContext = {
  assignmentId: string;
  testedSide: RemoteUpperLimbBatterySide;
  patientFirstName: string | null;
};

export default function PatientRemoteUlmsAssessmentPage() {
  const params = useParams();
  const router = useRouter();
  const token = String(params.token || "");

  const [context, setContext] = useState<RemoteAssessmentContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sessionKey, setSessionKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [completedPayload, setCompletedPayload] = useState<RemoteUpperLimbBatteryPayload | null>(null);
  const submitStartedRef = useRef(false);

  useEffect(() => {
    if (!token) {
      setLoadError("Invalid or expired link.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    void fetch(`/api/patient/assessment/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setLoadError(body?.error ?? "Invalid or expired link.");
          return;
        }
        const data = (await response.json()) as RemoteAssessmentContext;
        setContext(data);
      })
      .catch(() => {
        setLoadError("Could not load this assessment link. Check your connection and try again.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token]);

  const submitBattery = useCallback(
    async (payload: RemoteUpperLimbBatteryPayload) => {
      if (!context) {
        setSubmitError("Assessment context was not ready. Refresh and try again.");
        return;
      }

      setSubmitting(true);
      setSubmitError(null);

      const submitResult = await submitRemoteUpperLimbBatteryResult(token, {
        assignmentId: context.assignmentId,
        battery: payload,
      });

      if (!submitResult.ok) {
        setSubmitError(submitResult.message);
        setCompletedPayload(payload);
        setSubmitting(false);
        return;
      }

      setSubmitting(false);
      router.push(`/patient/assessment/${encodeURIComponent(token)}/complete`);
    },
    [context, router, token],
  );

  const handleBatteryComplete = useCallback(
    (payload: RemoteUpperLimbBatteryPayload) => {
      if (submitStartedRef.current) return;
      submitStartedRef.current = true;
      setCompletedPayload(payload);
      void submitBattery(payload);
    },
    [submitBattery],
  );

  const handleSendAgain = useCallback(() => {
    if (!completedPayload) return;
    void submitBattery(completedPayload);
  }, [completedPayload, submitBattery]);

  const handleCancelAndRestart = useCallback(() => {
    submitStartedRef.current = false;
    setCompletedPayload(null);
    setSubmitError(null);
    setSubmitting(false);
    setSessionKey((current) => current + 1);
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0B1220] px-6 py-8 text-white">
        <div className="mx-auto max-w-3xl text-sm text-white/45">Loading assessment…</div>
      </main>
    );
  }

  if (loadError || !context) {
    return (
      <main className="min-h-screen bg-[#0B1220] px-6 py-8 text-white">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-2xl font-bold text-white">Assessment link unavailable</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/55">{loadError}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0B1220] px-6 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#1D9E75]">
          RASQ · Remote assessment
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">Remote Upper-Limb Assessment</h1>
        {context.patientFirstName ? (
          <p className="mt-2 text-sm text-white/45">Hello, {context.patientFirstName}</p>
        ) : null}

        {!submitError ? (
          <>
            <p className="mt-4 text-sm leading-relaxed text-white/60">
              {getInitialPositionInstruction(context.testedSide)}
            </p>

            <div className="mt-5 rounded-[10px] border border-amber-400/20 bg-amber-400/5 px-4 py-3.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-200/90">
                For therapist review
              </p>
              <p className="mt-2 text-sm leading-relaxed text-white/55">
                These movement checks may support your therapist&apos;s review. They are not
                diagnostic and do not replace clinical examination.
              </p>
            </div>

            <RemoteUpperLimbBatterySession
              key={sessionKey}
              testedSide={context.testedSide}
              disabled={submitting}
              onBatteryComplete={handleBatteryComplete}
              onCancel={handleCancelAndRestart}
            />

            {submitting ? (
              <p className="mt-4 text-sm text-white/55">
                Assessment completed. Sending your assessment to your therapist…
              </p>
            ) : null}
          </>
        ) : (
          <section className="mt-6 rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-5">
            <h2 className="text-lg font-bold text-white">Assessment completed</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/55">
              Your assessment could not be sent automatically. You can try again.
            </p>

            <div className="mt-4 rounded-[7px] border border-rose-400/20 bg-rose-400/5 px-4 py-3">
              <p className="text-sm text-rose-200">{submitError}</p>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={handleSendAgain}
                className="rounded-[7px] bg-[#1D9E75] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#178f68] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Send Again"}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleCancelAndRestart}
                className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3 text-sm font-semibold text-white/70 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel Assessment
              </button>
            </div>
          </section>
        )}

        <p className="mt-8 text-[11px] text-white/25">
          Need help? Contact your clinic if this link does not work.
        </p>
      </div>
    </main>
  );
}
