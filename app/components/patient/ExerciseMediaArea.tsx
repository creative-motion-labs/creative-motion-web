"use client";

import { useState } from "react";
import type { PatientCvDerivedMetrics } from "@/app/lib/cv/bio-0-contracts";
import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";
import { PatientCvCapture } from "@/app/components/patient/cv/PatientCvCapture";
import { InteractiveShoulderSession } from "@/app/components/patient/interactive-shoulder/InteractiveShoulderSession";
import { isPatientCvCaptureWired, type CvY1ExerciseId } from "@/app/lib/cv/cv-patient-config";
import { isInteractiveShoulderSessionWired } from "@/app/lib/interactive-shoulder/interactive-shoulder-exercise-ids";
import type { CaptureSetupGuidance } from "@/app/lib/cv/patient-cv-capture-readiness";
import type { CvMotionQualityPayload } from "@/app/lib/cv/sts-motion-pilot-record";
import type { PatientCvCameraConsentRecord } from "@/app/lib/cv/patient-cv-consent";
import { patientExerciseGuideImage } from "@/app/lib/exercise-guide-media";
import { exerciseMediaUi } from "@/app/lib/patient-portal-ui";

export type ExerciseMediaAreaProps = {
  exerciseId?: string;
  exerciseName?: string;
  bodyRegion?: string;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  language: PatientExerciseLanguage;
  arClass?: string;
  textDir?: "rtl" | "ltr";
  /** W-0 exercise card step — CV capture only when "active". */
  exerciseStep?: "preview" | "active" | "done";
  /** Server-authored treatment side from GET /api/patient/plan. */
  prescribedSide?: string | null;
  clinicalPrescribedSideRequired?: boolean;
  /** Forces runtime remount when session side identity changes. */
  runtimeInstanceKey?: string;
  onCvMetricsUpdate?: (metrics: PatientCvDerivedMetrics) => void;
  /**
   * Required, not optional: forwarded directly as InteractiveShoulderSession's
   * required `onSkipped`. See orchestrator-cv-session-types.ts for why that prop
   * is required — an optional handler here would silently reopen the same gap.
   */
  onCvSkipped: () => void;
  onRegisterCvMetricsFlush?: (flush: () => void) => void;
  onRegisterStsPilotBeforeSave?: (beforeSave: () => void) => void;
  onRegisterStsPilotRecordFlush?: (flush: () => CvMotionQualityPayload | null) => void;
  onRegisterCaptureConsent?: (getter: () => PatientCvCameraConsentRecord | null) => void;
  onCaptureReadinessChange?: (payload: {
    primaryGuidance: CaptureSetupGuidance;
    canStartTracking: boolean;
    minimumMet: boolean;
    previewActive: boolean;
  }) => void;
};

type VisualRegion =
  | "knee"
  | "hip"
  | "shoulder"
  | "cervical"
  | "lumbar"
  | "ankle"
  | "balance"
  | "general";

function resolveVisualRegion(
  bodyRegion?: string,
  exerciseId?: string,
): VisualRegion {
  const id = (exerciseId ?? "").toLowerCase();
  if (
    id.includes("walking") ||
    id.includes("balance") ||
    id.includes("stance") ||
    id.includes("weight-shift") ||
    id.includes("heel-toe") ||
    id.includes("marching")
  ) {
    return "balance";
  }

  const region = (bodyRegion ?? "").toLowerCase();
  if (region === "knee") return "knee";
  if (region === "hip") return "hip";
  if (region === "shoulder") return "shoulder";
  if (region === "cervical") return "cervical";
  if (region === "lumbar") return "lumbar";
  if (region === "ankle") return "ankle";
  return "general";
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
}

const TEAL = "#1D9E75";
const TEAL_LIGHT = "#9ECDB8";
const TEAL_MIST = "#D1E7DE";
const TEAL_GLOW = "rgba(29, 158, 117, 0.12)";

function FlowMarkers({ rtl }: { rtl: boolean }) {
  const startX = rtl ? 172 : 28;
  const endX = rtl ? 28 : 172;
  return (
    <g aria-hidden>
      <circle cx={startX} cy="118" r="4" fill={TEAL} opacity="0.35" />
      <circle cx={endX} cy="118" r="4" fill={TEAL} opacity="0.85" />
      <path
        d={rtl ? "M 158 118 L 172 118 L 166 114" : "M 42 118 L 28 118 L 34 114"}
        fill="none"
        stroke={TEAL_LIGHT}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.7"
      />
      <path
        className="rasq-flow-arrow"
        d={rtl ? "M 48 118 L 32 118 L 38 114" : "M 158 118 L 172 118 L 166 114"}
        fill="none"
        stroke={TEAL}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
    </g>
  );
}

function RegionVisual({ region, rtl }: { region: VisualRegion; rtl: boolean }) {
  const pathClass = "rasq-motion-path";
  const glowClass = "rasq-motion-glow";

  switch (region) {
    case "knee":
      return (
        <svg viewBox="0 0 200 130" className="h-[120px] w-full max-w-[200px]" aria-hidden>
          <line x1="70" y1="95" x2="130" y2="95" stroke={TEAL_MIST} strokeWidth="2" strokeLinecap="round" />
          <line x1="100" y1="38" x2="100" y2="62" stroke={TEAL_LIGHT} strokeWidth="2.5" strokeLinecap="round" />
          <path
            className={pathClass}
            d="M100 62 L100 78 Q118 88 100 98"
            fill="none"
            stroke={TEAL}
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <path
            className={glowClass}
            d="M100 78 Q112 82 100 88"
            fill="none"
            stroke={TEAL_LIGHT}
            strokeWidth="2"
            strokeLinecap="round"
            style={{ animationDelay: "0.5s" }}
          />
          <FlowMarkers rtl={rtl} />
        </svg>
      );
    case "hip":
      return (
        <svg viewBox="0 0 200 130" className="h-[120px] w-full max-w-[200px]" aria-hidden>
          <line x1="100" y1="32" x2="100" y2="52" stroke={TEAL_LIGHT} strokeWidth="2.5" strokeLinecap="round" />
          <path
            className={pathClass}
            d="M100 52 Q78 68 82 98 L82 108"
            fill="none"
            stroke={TEAL}
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <path
            className={glowClass}
            d="M82 72 Q100 66 108 78"
            fill="none"
            stroke={TEAL_LIGHT}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <FlowMarkers rtl={rtl} />
        </svg>
      );
    case "shoulder":
      return (
        <svg viewBox="0 0 200 130" className="h-[120px] w-full max-w-[200px]" aria-hidden>
          <line x1="88" y1="42" x2="88" y2="100" stroke={TEAL_LIGHT} strokeWidth="2.5" strokeLinecap="round" />
          <path
            className={pathClass}
            d="M88 46 Q128 50 138 72 Q132 92 102 88"
            fill="none"
            stroke={TEAL}
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <circle cx="138" cy="72" r="5" fill="none" stroke={TEAL_LIGHT} strokeWidth="2" className={glowClass} />
          <FlowMarkers rtl={rtl} />
        </svg>
      );
    case "cervical":
      return (
        <svg viewBox="0 0 200 130" className="h-[120px] w-full max-w-[200px]" aria-hidden>
          <circle cx="100" cy="36" r="14" fill="none" stroke={TEAL_LIGHT} strokeWidth="2" />
          <path
            className={pathClass}
            d="M100 50 L100 68 Q92 76 100 84"
            fill="none"
            stroke={TEAL}
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <line x1="100" y1="84" x2="100" y2="102" stroke={TEAL_LIGHT} strokeWidth="2" strokeLinecap="round" />
          <FlowMarkers rtl={rtl} />
        </svg>
      );
    case "lumbar":
      return (
        <svg viewBox="0 0 200 130" className="h-[120px] w-full max-w-[200px]" aria-hidden>
          <path
            className={pathClass}
            d="M100 28 Q112 48 100 68 Q88 88 100 102"
            fill="none"
            stroke={TEAL}
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <path
            className={glowClass}
            d="M82 48 Q100 44 118 48 M80 68 Q100 64 120 68"
            fill="none"
            stroke={TEAL_LIGHT}
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.75"
          />
          <FlowMarkers rtl={rtl} />
        </svg>
      );
    case "ankle":
      return (
        <svg viewBox="0 0 200 130" className="h-[120px] w-full max-w-[200px]" aria-hidden>
          <line x1="100" y1="28" x2="100" y2="72" stroke={TEAL_LIGHT} strokeWidth="2.5" strokeLinecap="round" />
          <path
            className={pathClass}
            d="M100 72 L78 98 L100 108 L122 98 Z"
            fill="none"
            stroke={TEAL}
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <path
            className={glowClass}
            d="M78 98 Q100 90 122 98"
            fill="none"
            stroke={TEAL_LIGHT}
            strokeWidth="2"
          />
          <FlowMarkers rtl={rtl} />
        </svg>
      );
    case "balance":
      return (
        <svg viewBox="0 0 200 130" className="h-[120px] w-full max-w-[200px]" aria-hidden>
          <line x1="100" y1="30" x2="100" y2="48" stroke={TEAL_LIGHT} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="100" y1="48" x2="100" y2="82" stroke={TEAL} strokeWidth="3.5" strokeLinecap="round" />
          <line x1="100" y1="82" x2="86" y2="102" stroke={TEAL} strokeWidth="3" strokeLinecap="round" />
          <line
            x1="100"
            y1="82"
            x2="114"
            y2="102"
            stroke={TEAL_LIGHT}
            strokeWidth="2.5"
            strokeLinecap="round"
            className={glowClass}
          />
          <path
            className={pathClass}
            d="M68 102 Q100 92 132 102"
            fill="none"
            stroke={TEAL_LIGHT}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <FlowMarkers rtl={rtl} />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 200 130" className="h-[120px] w-full max-w-[200px]" aria-hidden>
          <path
            className={pathClass}
            d="M36 68 Q68 48 100 68 T164 68"
            fill="none"
            stroke={TEAL}
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <path
            className={glowClass}
            d="M36 82 Q68 62 100 82 T164 82"
            fill="none"
            stroke={TEAL_LIGHT}
            strokeWidth="2"
            strokeLinecap="round"
            style={{ animationDelay: "0.4s" }}
          />
          <FlowMarkers rtl={rtl} />
        </svg>
      );
  }
}

function MovementPreviewPanel({
  language,
  exerciseId,
  bodyRegion,
  arClass,
}: {
  language: PatientExerciseLanguage;
  exerciseId?: string;
  bodyRegion?: string;
  arClass: string;
}) {
  const ui = exerciseMediaUi(language);
  const visual = resolveVisualRegion(bodyRegion, exerciseId);
  const isArabic = language === "ar";
  const guideImage = patientExerciseGuideImage(exerciseId);
  const [guideImageFailed, setGuideImageFailed] = useState(false);
  const showGuideImage = guideImage != null && !guideImageFailed;

  return (
    <div
      className={`relative min-h-[220px] overflow-hidden ${arClass}`}
      dir={isArabic ? "rtl" : "ltr"}
      lang={language}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 80% 70% at 50% 40%, ${TEAL_GLOW} 0%, transparent 70%)`,
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: `linear-gradient(${TEAL_MIST} 1px, transparent 1px), linear-gradient(90deg, ${TEAL_MIST} 1px, transparent 1px)`,
          backgroundSize: "24px 24px",
        }}
        aria-hidden
      />

      <div className="relative flex flex-col items-center px-5 pb-6 pt-5">
        <p
          className="mb-4 text-[10px] font-bold uppercase tracking-[0.14em] text-[#1D9E75]"
          style={{ letterSpacing: "0.12em" }}
        >
          {ui.movementGuideTitle}
        </p>

        <div
          className="relative w-full max-w-[300px] rounded-[14px] bg-white/75 px-6 py-7 shadow-[0_10px_32px_-12px_rgba(29,158,117,0.28)] ring-1 ring-[#D1E7DE]"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(240,250,246,0.85) 100%)",
          }}
        >
          <div className="flex w-full flex-col items-center justify-center gap-4">
            {showGuideImage && guideImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={guideImage.src}
                alt={guideImage.alt}
                className="h-auto w-full max-w-full object-contain"
                style={{ maxHeight: "min(70vh, 420px)" }}
                onError={() => setGuideImageFailed(true)}
              />
            ) : null}
            {!showGuideImage ? (
              <RegionVisual region={visual} rtl={isArabic} />
            ) : null}
          </div>
        </div>

        <p className="mt-4 max-w-[280px] text-center text-[13px] font-medium leading-snug text-[#374151]">
          {ui.movementGuideSubtitle}
        </p>
        <p className="mt-2 text-center text-[11px] font-medium text-[#1D9E75]">
          {ui.followTherapistInstructions}
        </p>
      </div>

      <style>{`
        .rasq-motion-path {
          stroke-dasharray: 10 8;
          animation: rasqMotionFlow 3.2s ease-in-out infinite;
        }
        .rasq-motion-glow {
          animation: rasqMotionGlow 3.2s ease-in-out infinite;
        }
        .rasq-flow-arrow {
          animation: rasqFlowArrow 3.2s ease-in-out infinite;
        }
        @keyframes rasqMotionFlow {
          0%, 100% { stroke-dashoffset: 18; opacity: 0.55; }
          50% { stroke-dashoffset: 0; opacity: 1; }
        }
        @keyframes rasqMotionGlow {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.95; }
        }
        @keyframes rasqFlowArrow {
          0%, 100% { opacity: 0.45; transform: translateX(0); }
          50% { opacity: 1; transform: translateX(${isArabic ? "-3px" : "3px"}); }
        }
      `}</style>
    </div>
  );
}

/**
 * Exercise media container for patient session cards.
 * Illustrated movement preview or optional static media URL.
 *
 * Future extension points (not implemented):
 * - camera consent slot
 * - camera preview slot
 * - CV overlay slot
 * - rep / timer overlay slot
 * - side-by-side video + CV layout
 */
export function ExerciseMediaArea({
  exerciseId,
  exerciseName = "",
  bodyRegion,
  mediaUrl,
  thumbnailUrl,
  language,
  arClass = "",
  textDir = "ltr",
  exerciseStep,
  prescribedSide,
  clinicalPrescribedSideRequired = false,
  runtimeInstanceKey,
  onCvMetricsUpdate,
  onCvSkipped,
  onRegisterCvMetricsFlush,
  onRegisterStsPilotBeforeSave,
  onRegisterStsPilotRecordFlush,
  onRegisterCaptureConsent,
  onCaptureReadinessChange,
}: ExerciseMediaAreaProps) {
  const ui = exerciseMediaUi(language);
  const resolvedMedia = mediaUrl?.trim() || null;
  const poster = thumbnailUrl?.trim() || undefined;

  const showInteractiveShoulder =
    exerciseStep === "active" && isInteractiveShoulderSessionWired(exerciseId);
  const showPatientCv =
    exerciseStep === "active" &&
    isPatientCvCaptureWired(exerciseId) &&
    !showInteractiveShoulder;
  const cvExerciseId = exerciseId as CvY1ExerciseId | undefined;

  return (
    <div
      className="relative overflow-hidden border-b border-[#D1E7DE] bg-gradient-to-b from-[#E8F5F1] via-[#F0FAF6] to-[#F4F6F5]"
      data-exercise-id={exerciseId ?? undefined}
    >
      {showInteractiveShoulder && (
        <InteractiveShoulderSession
          key={runtimeInstanceKey}
          language={language}
          arClass={arClass}
          textDir={textDir}
          prescribedSide={prescribedSide}
          clinicalPrescribedSideRequired={clinicalPrescribedSideRequired}
          onSkipped={onCvSkipped}
          onRegisterMetricsFlush={onRegisterCvMetricsFlush}
          onRegisterCaptureConsent={onRegisterCaptureConsent}
          onCaptureReadinessChange={onCaptureReadinessChange}
        />
      )}

      {showPatientCv && cvExerciseId && (
        <PatientCvCapture
          exerciseId={cvExerciseId}
          language={language}
          arClass={arClass}
          textDir={textDir}
          onMetricsUpdate={onCvMetricsUpdate}
          onSkipped={onCvSkipped}
          onRegisterMetricsFlush={onRegisterCvMetricsFlush}
          onRegisterStsPilotBeforeSave={onRegisterStsPilotBeforeSave}
          onRegisterStsPilotRecordFlush={onRegisterStsPilotRecordFlush}
          onRegisterCaptureConsent={onRegisterCaptureConsent}
          onCaptureReadinessChange={onCaptureReadinessChange}
        />
      )}

      {!showInteractiveShoulder && (
      <div className="relative">
        {resolvedMedia ? (
          <div className="relative min-h-[220px] w-full bg-[#0A0F1A]/5">
            {isVideoUrl(resolvedMedia) ? (
              <video
                className="max-h-[240px] w-full object-contain"
                src={resolvedMedia}
                poster={poster}
                controls
                playsInline
                preload="metadata"
                aria-label={ui.mediaAlt(exerciseName)}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolvedMedia}
                alt={ui.mediaAlt(exerciseName)}
                className="max-h-[240px] w-full object-contain"
              />
            )}
            {/* future: CV overlay slot */}
            {/* future: rep / timer overlay slot */}
          </div>
        ) : (
          <MovementPreviewPanel
            language={language}
            exerciseId={exerciseId}
            bodyRegion={bodyRegion}
            arClass={arClass}
          />
        )}
      </div>
      )}

      {/* future: side-by-side video + CV layout wrapper */}
    </div>
  );
}
