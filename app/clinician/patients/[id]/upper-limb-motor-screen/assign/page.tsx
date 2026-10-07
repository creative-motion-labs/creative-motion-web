"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useParams, notFound } from "next/navigation";
import type { PatientRow } from "@/app/lib/validate-patient-ownership";
import { isUuidPatientId } from "@/app/lib/api/patient-id-utils";
import { shouldIgnoreForwardReachAssignmentResult } from "@/app/lib/upper-limb-motor-screen/forward-reach-assignment-panel-lifecycle";
import { ForwardReachAssignmentClient } from "./ForwardReachAssignmentClient";

export default function ForwardReachAssignmentPage() {
  const params = useParams();
  const patientId = String(params.id || "");
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const patientScopeRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    patientScopeRef.current += 1;
    const scopeAtStart = patientScopeRef.current;

    setLoading(true);
    setLoadError(false);
    setPatient(null);

    loadAbortRef.current?.abort();
    const abort = new AbortController();
    loadAbortRef.current = abort;

    if (!patientId) {
      setLoading(false);
      setLoadError(true);
      return () => {
        abort.abort();
      };
    }

    void (async () => {
      try {
        const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}`, {
          cache: "no-store",
          signal: abort.signal,
        });
        if (
          shouldIgnoreForwardReachAssignmentResult({
            scopeAtStart,
            currentScope: patientScopeRef.current,
            generationAtStart: 0,
            currentGeneration: 0,
            aborted: abort.signal.aborted,
          })
        ) {
          return;
        }
        if (response.status === 404) {
          setPatient(null);
          setLoadError(true);
          return;
        }
        if (!response.ok) {
          setLoadError(true);
          return;
        }
        const data = (await response.json()) as PatientRow;
        if (
          shouldIgnoreForwardReachAssignmentResult({
            scopeAtStart,
            currentScope: patientScopeRef.current,
            generationAtStart: 0,
            currentGeneration: 0,
            aborted: abort.signal.aborted,
          })
        ) {
          return;
        }
        setPatient(data);
        setLoadError(false);
      } catch {
        if (
          !shouldIgnoreForwardReachAssignmentResult({
            scopeAtStart,
            currentScope: patientScopeRef.current,
            generationAtStart: 0,
            currentGeneration: 0,
            aborted: abort.signal.aborted,
          })
        ) {
          setLoadError(true);
        }
      } finally {
        if (
          !shouldIgnoreForwardReachAssignmentResult({
            scopeAtStart,
            currentScope: patientScopeRef.current,
            generationAtStart: 0,
            currentGeneration: 0,
            aborted: abort.signal.aborted,
          })
        ) {
          setLoading(false);
        }
      }
    })();

    return () => {
      abort.abort();
    };
  }, [patientId]);

  useEffect(() => {
    return () => {
      loadAbortRef.current?.abort();
    };
  }, []);

  if (!isUuidPatientId(patientId)) {
    return (
      <main className="min-h-screen bg-[#0B1220] px-6 py-8 text-white">
        <div className="mx-auto max-w-3xl">
          <Link
            href={`/clinician/patients/${encodeURIComponent(patientId)}`}
            className="text-xs font-semibold text-[#5DCAA5] transition hover:text-[#1D9E75]"
          >
            ← Back to patient profile
          </Link>
          <h1 className="mt-4 text-2xl font-bold text-white">Forward Reach Baseline assignment</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/55">
            This assignment flow is available for clinician-owned Supabase patient records. Legacy
            demo patients cannot use the Upper-Limb Motor Screen assignment API yet.
          </p>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0B1220] px-6 py-8 text-white">
        <div className="mx-auto max-w-3xl text-sm text-white/45">Loading patient context…</div>
      </main>
    );
  }

  if (loadError || !patient) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#0B1220] px-6 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <Link
          href={`/clinician/patients/${encodeURIComponent(patientId)}`}
          className="text-xs font-semibold text-[#5DCAA5] transition hover:text-[#1D9E75]"
        >
          ← Back to patient profile
        </Link>
        <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-[#1D9E75]">
          Upper-Limb Motor Screen
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">Forward Reach Baseline assignment</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/45">
          Configure a clinician-controlled Forward Reach observation assignment for therapist
          review. Live capture and patient delivery are not part of this release.
        </p>

        <div className="mt-6">
          <ForwardReachAssignmentClient
            key={patient.id}
            patientId={patient.id}
            patientName={patient.full_name}
          />
        </div>
      </div>
    </main>
  );
}
