"use client";

import { useState } from "react";
import { GuidedSessionRestScreen } from "@/app/components/patient/session/PatientGuidedSessionFlow";

export default function Pr313RestCountdownPage() {
  const [phase, setPhase] = useState<"a" | "b">("a");
  const [seconds, setSeconds] = useState(5);

  const restPhaseKey = `qa-rest-${phase}`;
  const restSeconds = seconds > 0 ? seconds : null;

  return (
    <>
      <h1 className="text-xl font-bold">Rest countdown</h1>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="rest-phase-a"
          className="rounded border border-white/20 px-3 py-1 text-sm"
          onClick={() => setPhase("a")}
        >
          Phase A
        </button>
        <button
          type="button"
          data-testid="rest-phase-b"
          className="rounded border border-white/20 px-3 py-1 text-sm"
          onClick={() => setPhase("b")}
        >
          Phase B
        </button>
        <button
          type="button"
          data-testid="rest-duration-3"
          className="rounded border border-white/20 px-3 py-1 text-sm"
          onClick={() => setSeconds(3)}
        >
          3s duration
        </button>
        <button
          type="button"
          data-testid="rest-duration-off"
          className="rounded border border-white/20 px-3 py-1 text-sm"
          onClick={() => setSeconds(0)}
        >
          No countdown
        </button>
      </div>
      <div className="mt-6" data-testid="rest-countdown-host">
        <GuidedSessionRestScreen
          lang="en"
          arClass=""
          textDir="ltr"
          restSeconds={restSeconds}
          restPhaseKey={restPhaseKey}
          nextExerciseName="Synthetic next exercise"
          nextExerciseIndex={1}
          totalExercises={3}
          onContinue={() => undefined}
        />
      </div>
    </>
  );
}
