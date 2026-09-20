"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PatientRow } from "@/app/lib/validate-patient-ownership";
import { isUuidPatientId } from "@/app/lib/api/patient-id-utils";
import {
  lateralReachCapturePatientRoute,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-assignment-client";
import {
  absoluteRemoteUlmsLink,
  createRemoteUlmsAssessmentLink,
} from "@/app/lib/upper-limb-motor-screen/remote-link-client";
import type { UpperLimbSide } from "@/app/lib/upper-limb-motor-screen/types";

export default function UpperLimbMotorScreenEntryPage() {
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [remotePatientId, setRemotePatientId] = useState<string | null>(null);
  const [remoteSide, setRemoteSide] = useState<UpperLimbSide>("right");
  const [remoteLink, setRemoteLink] = useState<string | null>(null);
  const [remoteExpiresAt, setRemoteExpiresAt] = useState<string | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    setLoadError(false);
    void fetch("/api/patients", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          setLoadError(true);
          return;
        }
        const data = (await response.json()) as PatientRow[];
        setPatients(data.filter((patient) => isUuidPatientId(patient.id)));
      })
      .catch(() => {
        setLoadError(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  async function handleGenerateRemoteLink(patientId: string) {
    setRemotePatientId(patientId);
    setRemoteLoading(true);
    setRemoteError(null);
    setRemoteLink(null);
    setRemoteExpiresAt(null);
    setCopied(false);

    const result = await createRemoteUlmsAssessmentLink(patientId, remoteSide);
    setRemoteLoading(false);

    if (!result.ok) {
      setRemoteError(result.message);
      return;
    }

    setRemoteLink(absoluteRemoteUlmsLink(result.link.url));
    setRemoteExpiresAt(result.link.expiresAt);
  }

  async function handleCopyLink() {
    if (!remoteLink) return;
    try {
      await navigator.clipboard.writeText(remoteLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0B1220] px-6 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/clinician/assessments"
          className="text-xs font-semibold text-[#5DCAA5] transition hover:text-[#1D9E75]"
        >
          ← Assessment Center
        </Link>

        <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-[#1D9E75]">
          RASQ · Upper Limb Motor Screen
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">Upper Limb Motor Screen</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/45">
          Start in-clinic capture or send a secure remote link for lateral reach camera observation.
          Movement observations are saved for therapist review and may inform rehabilitation planning.
        </p>

        <div className="mt-5 rounded-[10px] border border-amber-400/20 bg-amber-400/5 px-4 py-3.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-200/90">
            Therapist review required
          </p>
          <p className="mt-2 text-sm leading-relaxed text-white/55">
            Camera-assisted observations may support therapist review. They are not diagnostic
            and do not replace clinical examination.
          </p>
        </div>

        <section className="mt-8 rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-4">
          <h2 className="text-sm font-bold text-white">Remote assessment link</h2>
          <p className="mt-1 text-xs text-white/40">
            Generate a secure patient link for remote lateral reach capture. Links expire after 7 days.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(["right", "left"] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => setRemoteSide(side)}
                className={`rounded-[7px] px-4 py-2 text-xs font-semibold capitalize transition ${
                  remoteSide === side
                    ? "bg-[#1D9E75] text-white"
                    : "border border-[#1E2D42] bg-[#0B1220] text-white/60 hover:text-white"
                }`}
              >
                {side}
              </button>
            ))}
          </div>
          {remoteError ? <p className="mt-3 text-sm text-rose-300">{remoteError}</p> : null}
          {remoteLink ? (
            <div className="mt-4 rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">
                Patient link
              </p>
              <p className="mt-1 break-all text-sm text-[#5DCAA5]">{remoteLink}</p>
              {remoteExpiresAt ? (
                <p className="mt-2 text-xs text-white/40">
                  Expires {new Date(remoteExpiresAt).toLocaleString()}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void handleCopyLink()}
                className="mt-3 rounded-[7px] border border-[#1D9E75]/25 bg-[#1D9E75]/10 px-3 py-2 text-xs font-semibold text-[#5DCAA5] transition hover:bg-[#1D9E75]/15"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          ) : null}
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-bold text-white">Select patient</h2>
          <p className="mt-1 text-xs text-white/40">
            In-clinic capture and remote links are available for clinician-owned Supabase patient records.
          </p>

          {loading ? (
            <p className="mt-4 text-sm text-white/45">Loading patients…</p>
          ) : loadError ? (
            <p className="mt-4 text-sm text-rose-300">
              Could not load patients. Try again from the dashboard.
            </p>
          ) : patients.length === 0 ? (
            <p className="mt-4 text-sm text-white/45">
              No eligible patients found. Create a Supabase patient record first.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {patients.map((patient) => (
                <li
                  key={patient.id}
                  className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm font-medium text-white">{patient.full_name}</span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={remoteLoading && remotePatientId === patient.id}
                        onClick={() => void handleGenerateRemoteLink(patient.id)}
                        className="rounded-[7px] border border-[#1D9E75]/25 bg-[#1D9E75]/10 px-3 py-2 text-xs font-semibold text-[#5DCAA5] transition hover:bg-[#1D9E75]/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {remoteLoading && remotePatientId === patient.id
                          ? "Generating…"
                          : "Send remote assessment"}
                      </button>
                      <Link
                        href={lateralReachCapturePatientRoute(patient.id)}
                        className="rounded-[7px] bg-[#1D9E75] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#178f68]"
                      >
                        Start capture →
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-8 text-[11px] text-white/25">
          Remote results appear in Results after the patient completes the observation.
        </p>
      </div>
    </main>
  );
}
