"use client";

import { useCallback, useState } from "react";
import { ReadyCountdownOverlay } from "@/app/components/patient/interactive-shoulder/ReadyCountdownOverlay";

export default function Pr313ReadyCountdownPage() {
  const [mountKey, setMountKey] = useState(0);
  const [completeCount, setCompleteCount] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  const onComplete = useCallback(() => {
    setCompleteCount((value) => value + 1);
  }, []);

  return (
    <>
      <h1 className="text-xl font-bold">Ready countdown</h1>
      <p className="mt-2 text-sm text-white/55" data-testid="ready-complete-count">
        Completions: {completeCount}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="ready-remount"
          className="rounded border border-white/20 px-3 py-1 text-sm"
          onClick={() => {
            setCompleteCount(0);
            setMountKey((value) => value + 1);
          }}
        >
          Remount overlay
        </button>
        <button
          type="button"
          data-testid="ready-reduced-motion"
          className="rounded border border-white/20 px-3 py-1 text-sm"
          onClick={() => setReducedMotion((value) => !value)}
        >
          Toggle reduced motion ({reducedMotion ? "on" : "off"})
        </button>
      </div>
      <div className="relative mt-6 h-48 rounded border border-white/10 bg-[#0F1825]" data-testid="ready-overlay-host">
        <ReadyCountdownOverlay
          key={mountKey}
          language="en"
          reducedMotion={reducedMotion}
          onComplete={onComplete}
        />
      </div>
    </>
  );
}
