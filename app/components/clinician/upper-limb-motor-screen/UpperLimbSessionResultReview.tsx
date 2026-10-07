"use client";

import Link from "next/link";
import type { UpperLimbMovementAttemptResult } from "@/app/lib/upper-limb-motor-screen/types";
import type { UpperLimbMotorScreenSessionResultPublic } from "@/app/lib/upper-limb-motor-screen/session-result-persistence";

type UpperLimbSessionResultReviewProps = {
  patientId: string;
  patientName: string;
  attempt: UpperLimbMovementAttemptResult;
  savedResult?: UpperLimbMotorScreenSessionResultPublic | null;
  saveError?: string | null;
  saving?: boolean;
};

function formatNullableBoolean(value: boolean | null): string {
  if (value === null) return "Not recorded";
  return value ? "Yes" : "No";
}

function formatMs(value: number | null): string {
  if (value === null) return "Not recorded";
  return `${value} ms`;
}

export function UpperLimbSessionResultReview({
  patientId,
  patientName,
  attempt,
  savedResult,
  saveError,
  saving = false,
}: UpperLimbSessionResultReviewProps) {
  const planHref = `/clinician/plans/new?patientId=${encodeURIComponent(patientId)}`;
  const outcomesHref = `/clinician/patients/${encodeURIComponent(patientId)}/outcomes`;

  return (
    <section className="mt-6 space-y-5">
      <div className="rounded-[10px] border border-amber-400/20 bg-amber-400/5 px-4 py-3.5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-amber-200/90">
          Therapist review required
        </p>
        <p className="mt-2 text-sm leading-relaxed text-white/55">
          These camera-assisted observations may support therapist review. They are not
          diagnostic and do not replace clinical examination.
        </p>
      </div>

      <div className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-5">
        <h2 className="text-sm font-bold text-white">Lateral reach observation</h2>
        <p className="mt-1 text-xs text-white/40">
          Patient: {patientName} · Tested side: {attempt.testedSide}
        </p>

        {saving ? (
          <p className="mt-4 text-sm text-white/45">Saving observation for therapist review…</p>
        ) : null}
        {saveError ? (
          <p className="mt-4 text-sm text-rose-300">{saveError}</p>
        ) : null}
        {savedResult ? (
          <p className="mt-4 text-sm text-[#5DCAA5]">
            Observation saved for therapist review.
          </p>
        ) : null}

        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-white/35">
              Completion status
            </dt>
            <dd className="mt-1 text-sm text-white">{attempt.completionState}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-white/35">
              Tracking quality
            </dt>
            <dd className="mt-1 text-sm text-white">{attempt.trackingQualitySummary}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-white/35">
              Target reached
            </dt>
            <dd className="mt-1 text-sm text-white">
              {formatNullableBoolean(attempt.targetReached)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-white/35">
              Dwell confirmed
            </dt>
            <dd className="mt-1 text-sm text-white">
              {formatNullableBoolean(attempt.dwellConfirmed)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-white/35">
              Return to start
            </dt>
            <dd className="mt-1 text-sm text-white">
              {formatNullableBoolean(attempt.returnToStartCompleted)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-white/35">
              Protective pauses
            </dt>
            <dd className="mt-1 text-sm text-white">{attempt.protectivePauseCount}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-white/35">
              Reach time
            </dt>
            <dd className="mt-1 text-sm text-white">{formatMs(attempt.reachTimeMs)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-white/35">
              Return time
            </dt>
            <dd className="mt-1 text-sm text-white">{formatMs(attempt.returnTimeMs)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-white/35">
              Total movement time
            </dt>
            <dd className="mt-1 text-sm text-white">{formatMs(attempt.totalMovementTimeMs)}</dd>
          </div>
          {attempt.normalizedPathLength !== null ? (
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wide text-white/35">
                Normalized path length
              </dt>
              <dd className="mt-1 text-sm text-white">{attempt.normalizedPathLength}</dd>
            </div>
          ) : null}
          {attempt.pathEfficiency !== null ? (
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wide text-white/35">
                Path efficiency
              </dt>
              <dd className="mt-1 text-sm text-white">{attempt.pathEfficiency}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href={planHref}
          className="rounded-[7px] bg-[#1D9E75] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#178f68]"
        >
          Assign Interactive Shoulder Program
        </Link>
        <Link
          href={outcomesHref}
          className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-4 py-2.5 text-xs font-semibold text-white/60 transition hover:border-[#1D9E75]/25 hover:text-white"
        >
          View patient outcomes
        </Link>
      </div>
    </section>
  );
}
