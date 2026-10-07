"use client";

import { resolveCoolDownCoachingPhase } from "@/app/lib/interactive-shoulder/resolve-cool-down-coaching";

type CoolDownMotionGuideProps = {
  reducedMotion: boolean;
  elapsedSeconds?: number;
};

function resolveSupportBlend(elapsedSeconds: number, reducedMotion: boolean): number {
  const phase = resolveCoolDownCoachingPhase(elapsedSeconds);
  if (phase === "complete") return 0;
  if (phase === "restOnSupport" || phase === "supportedStillness") return 1;
  if (reducedMotion) return 0;
  const returnProgress = Math.min(1, Math.max(0, (elapsedSeconds - 5) / 12));
  return returnProgress;
}

/**
 * Presentation-only supported-return guide. Communicates direction toward a
 * visible support surface and a final forearm-supported rest — not an exact
 * trajectory, neutral position, or measured movement.
 */
export function CoolDownMotionGuide({ reducedMotion, elapsedSeconds = 0 }: CoolDownMotionGuideProps) {
  const supportBlend = resolveSupportBlend(elapsedSeconds, reducedMotion);
  const onSupport = supportBlend >= 0.92;
  const raisedOpacity = 1 - supportBlend;
  const supportedOpacity = supportBlend;

  return (
    <div
      className="pointer-events-none absolute inset-y-0 left-3 z-20 flex w-[28%] max-w-[140px] items-center sm:left-4 sm:max-w-[152px]"
      aria-hidden
    >
      <svg
        viewBox="0 0 120 200"
        className="h-auto w-full opacity-[0.28]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <ellipse cx="60" cy="30" rx="14" ry="16" stroke="#8CB4FF" strokeWidth="1.25" opacity="0.65" />
        <path d="M60 46v48" stroke="#8CB4FF" strokeWidth="1.25" strokeLinecap="round" opacity="0.5" />
        <path
          d="M60 94 L52 168 M60 94 L68 168"
          stroke="#8CB4FF"
          strokeWidth="1.25"
          strokeLinecap="round"
          opacity="0.4"
        />

        {/* Padded support surface — armrest / lap / table-like */}
        <rect
          x="14"
          y="126"
          width="92"
          height="16"
          rx="6"
          fill="#5B8DEF"
          fillOpacity="0.18"
          stroke="#8CB4FF"
          strokeWidth="1.35"
        />
        <rect x="18" y="130" width="84" height="8" rx="4" fill="#8CB4FF" fillOpacity="0.16" />

        {/* Reaching / elevated arm — starting position only */}
        <g opacity={raisedOpacity} style={{ transition: reducedMotion ? undefined : "opacity 0.8s ease" }}>
          <path d="M60 58 L74 68" stroke="#A8C7FF" strokeWidth="2" strokeLinecap="round" />
          <path d="M74 68 L88 52" stroke="#A8C7FF" strokeWidth="2" strokeLinecap="round" />
        </g>

        {/* Forearm supported on surface — destination only */}
        <g opacity={supportedOpacity} style={{ transition: reducedMotion ? undefined : "opacity 0.8s ease" }}>
          <path d="M60 58 L48 96" stroke="#A8C7FF" strokeWidth="2" strokeLinecap="round" />
          <path
            d="M48 96 L30 131 L78 131"
            stroke="#A8C7FF"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <ellipse cx="54" cy="131" rx="26" ry="4" fill="#8CB4FF" fillOpacity="0.42" />
        </g>

        {onSupport ? (
          <g className={reducedMotion ? undefined : "motion-safe:animate-[cooldown-breath_4s_ease-in-out_infinite]"}>
            <rect x="18" y="130" width="84" height="8" rx="4" fill="#8CB4FF" fillOpacity="0.1" />
          </g>
        ) : null}
      </svg>
    </div>
  );
}
