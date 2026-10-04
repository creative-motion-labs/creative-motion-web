"use client";

type RasqDemoReachRightGuideVisualProps = {
  reducedMotion?: boolean;
};

/**
 * Schematic reach-to-right guide — not a photograph or clinical diagram.
 */
export function RasqDemoReachRightGuideVisual({ reducedMotion = false }: RasqDemoReachRightGuideVisualProps) {
  return (
    <div
      className="rounded-[10px] border border-[#C7E8DC] bg-gradient-to-br from-[#F0FDF9] to-[#ECFEFF] p-4"
      aria-hidden
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-[#1D9E75]">Reach to Right</p>
      <svg
        viewBox="0 0 240 140"
        className="mt-2 h-auto w-full max-w-md"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <ellipse cx="72" cy="36" rx="16" ry="18" stroke="#64748B" strokeWidth="1.5" opacity="0.7" />
        <path d="M72 54v52" stroke="#64748B" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
        <path
          d="M72 106 L62 128 M72 106 L82 128"
          stroke="#64748B"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.45"
        />
        <path d="M72 62 L72 62" stroke="#1D9E75" strokeWidth="2" strokeLinecap="round" />
        <path
          d="M72 62 L108 48 L148 38"
          stroke="#1D9E75"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="148" cy="38" r="14" fill="#1D9E75" fillOpacity="0.15" stroke="#1D9E75" strokeWidth="2" />
        <circle cx="148" cy="38" r="5" fill="#1D9E75" fillOpacity="0.85" />
        {!reducedMotion ? (
          <circle cx="148" cy="38" r="14" stroke="#1D9E75" strokeWidth="1" opacity="0.45">
            <animate attributeName="r" values="14;20;14" dur="2.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.45;0;0.45" dur="2.4s" repeatCount="indefinite" />
          </circle>
        ) : null}
        <path
          d="M118 92 H188"
          stroke="#94A3B8"
          strokeWidth="1"
          strokeDasharray="4 4"
          markerEnd="url(#reachArrow)"
        />
        <defs>
          <marker id="reachArrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#94A3B8" />
          </marker>
        </defs>
        <text x="124" y="86" fill="#64748B" fontSize="11" fontFamily="system-ui, sans-serif">
          comfortable reach
        </text>
      </svg>
      <p className="mt-2 text-sm text-[#475569]">
        Lift your arm out to the side and reach toward each target on your right.
      </p>
    </div>
  );
}
