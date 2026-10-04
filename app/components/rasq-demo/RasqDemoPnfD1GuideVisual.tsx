"use client";

type RasqDemoPnfD1GuideVisualProps = {
  reducedMotion?: boolean;
};

/**
 * Schematic PNF D1–inspired diagonal — demonstration only, not clinical PNF validation.
 */
export function RasqDemoPnfD1GuideVisual({ reducedMotion = false }: RasqDemoPnfD1GuideVisualProps) {
  return (
    <div
      className="rounded-[10px] border border-[#C7E8DC] bg-gradient-to-br from-[#F0FDF9] to-[#ECFEFF] p-4"
      aria-hidden
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-[#1D9E75]">
        PNF Diagonal 1 (demonstration)
      </p>
      <svg
        viewBox="0 0 240 140"
        className="mt-2 h-auto w-full max-w-md"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <ellipse cx="68" cy="104" rx="16" ry="18" stroke="#64748B" strokeWidth="1.5" opacity="0.7" />
        <path d="M68 86 L68 52" stroke="#64748B" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
        <path
          d="M82 104 L82 118 M54 104 L54 118"
          stroke="#64748B"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.45"
        />
        <path
          d="M82 78 L118 58 L156 28"
          stroke="#1D9E75"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={reducedMotion ? undefined : "6 8"}
        >
          {!reducedMotion ? (
            <animate attributeName="stroke-dashoffset" from="28" to="0" dur="2.2s" repeatCount="indefinite" />
          ) : null}
        </path>
        <circle cx="82" cy="78" r="5" fill="#64748B" fillOpacity="0.5" />
        <circle cx="156" cy="28" r="10" fill="#1D9E75" fillOpacity="0.2" stroke="#1D9E75" strokeWidth="2" />
        <circle cx="156" cy="28" r="4" fill="#1D9E75" />
        <text x="88" y="124" fill="#64748B" fontSize="11" fontFamily="system-ui, sans-serif">
          five smooth repetitions along the path
        </text>
      </svg>
      <p className="mt-2 text-sm text-[#475569]">
        Trace the diagonal with your right arm at a calm, steady pace.
      </p>
    </div>
  );
}
