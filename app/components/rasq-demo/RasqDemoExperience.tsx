"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  RASQ_DEMO_NO_RAW_VIDEO_NOTICE,
  RASQ_DEMO_EXPERIENCE_HEADING,
  RASQ_DEMO_EXPERIENCE_KICKER,
  RASQ_DEMO_MOVEMENT_DISCLAIMER,
} from "@/app/lib/rasq-demo/demo-copy";
import type { RasqDemoMovementAnalysisSummary } from "@/app/lib/rasq-demo/demo-movement-summary";
import {
  playRasqDemoGuidanceCue,
  registerRasqDemoVoiceControlsNotifier,
} from "@/app/lib/rasq-demo/demo-voice-play";
import { unlockRasqDemoAudioFromUserGesture } from "@/app/lib/rasq-demo/demo-audio-unlock";
import { resetRasqDemoPnfEndpointPlayedRepetitions } from "@/app/lib/rasq-demo/demo-pnf-endpoint-sfx";
import { resetRasqDemoPnfRepetitionTickPlayed } from "@/app/lib/rasq-demo/demo-pnf-repetition-tick-sfx";
import {
  playRasqDemoSessionCompletionVoice,
  resetRasqDemoSessionCompletionVoice,
} from "@/app/lib/rasq-demo/demo-completion-voice";
import { stopRasqDemoVoicePlayback } from "@/app/lib/rasq-demo/demo-voice-audio";
import {
  createRasqDemoAttemptId,
  getOrCreateRasqDemoVisitorSessionId,
  isRasqDemoAnalyticsTestModeFromSearch,
  trackRasqDemoAnalyticsEvent,
} from "@/app/lib/rasq-demo/demo-analytics-client";
import type { RasqDemoAnalyticsCameraPath } from "@/app/lib/rasq-demo/demo-analytics-types";
import { RasqDemoOptionalLeadForm } from "./RasqDemoOptionalLeadForm";
import { RasqDemoOrchestratorSession } from "./RasqDemoOrchestratorSession";
import { RasqDemoPnfD1GuideVisual } from "./RasqDemoPnfD1GuideVisual";
import { RasqDemoReachRightGuideVisual } from "./RasqDemoReachRightGuideVisual";
import { RasqDemoVoiceControls, notifyRasqDemoVoiceControlsChanged } from "./RasqDemoVoiceControls";
import { RasqDemoMovementAnalysisSummaryPanel } from "./RasqDemoMovementAnalysisSummary";

type RasqDemoPhase = "welcome" | "active" | "summary";

export function RasqDemoExperience() {
  const searchParams = useSearchParams();
  const internalTest = isRasqDemoAnalyticsTestModeFromSearch(searchParams.toString());

  const [phase, setPhase] = useState<RasqDemoPhase>("welcome");
  const [visitorSessionId, setVisitorSessionId] = useState(() =>
    getOrCreateRasqDemoVisitorSessionId({ internalTest }),
  );

  useEffect(() => {
    setVisitorSessionId(getOrCreateRasqDemoVisitorSessionId({ internalTest }));
  }, [internalTest]);
  const [demoSessionId, setDemoSessionId] = useState(() =>
    createRasqDemoAttemptId({ internalTest }),
  );
  const [movementSummary, setMovementSummary] = useState<RasqDemoMovementAnalysisSummary | null>(null);
  const welcomeCuePlayedRef = useRef(false);
  const demoSessionIdRef = useRef(demoSessionId);
  const cameraPathRef = useRef<RasqDemoAnalyticsCameraPath | null>(null);
  const completionTrackedRef = useRef(false);

  useEffect(() => {
    demoSessionIdRef.current = demoSessionId;
  }, [demoSessionId]);

  useEffect(() => {
    registerRasqDemoVoiceControlsNotifier(notifyRasqDemoVoiceControlsChanged);
    return () => {
      registerRasqDemoVoiceControlsNotifier(null);
      stopRasqDemoVoicePlayback();
    };
  }, []);

  useEffect(() => {
    trackRasqDemoAnalyticsEvent({
      visitorSessionId,
      attemptId: visitorSessionId,
      eventType: "demo_visit",
      isInternalTest: internalTest,
    });
  }, [visitorSessionId, internalTest]);

  useEffect(() => {
    if (phase !== "welcome") return;
    if (welcomeCuePlayedRef.current) return;
    welcomeCuePlayedRef.current = true;
    playRasqDemoGuidanceCue("welcome");
  }, [phase]);

  const handleCameraPathSelected = useCallback(
    (path: RasqDemoAnalyticsCameraPath) => {
      cameraPathRef.current = path;
      trackRasqDemoAnalyticsEvent({
        visitorSessionId,
        attemptId: demoSessionIdRef.current,
        eventType: "demo_started",
        cameraPath: path,
        isInternalTest: internalTest,
      });
    },
    [visitorSessionId, internalTest],
  );

  const handleStart = useCallback(() => {
    unlockRasqDemoAudioFromUserGesture();
    stopRasqDemoVoicePlayback();
    resetRasqDemoSessionCompletionVoice();
    resetRasqDemoPnfEndpointPlayedRepetitions();
    resetRasqDemoPnfRepetitionTickPlayed();
    const nextAttemptId = createRasqDemoAttemptId({ internalTest });
    demoSessionIdRef.current = nextAttemptId;
    cameraPathRef.current = null;
    completionTrackedRef.current = false;
    setDemoSessionId(nextAttemptId);
    setMovementSummary(null);
    setPhase("active");
  }, [internalTest]);

  const handleSessionComplete = useCallback(
    (summary: RasqDemoMovementAnalysisSummary) => {
      playRasqDemoSessionCompletionVoice();
      setMovementSummary(summary);
      setPhase("summary");
    },
    [],
  );

  useEffect(() => {
    if (phase !== "summary") return;
    if (completionTrackedRef.current) return;
    const cameraPath = cameraPathRef.current;
    if (!cameraPath) return;
    completionTrackedRef.current = true;
    trackRasqDemoAnalyticsEvent({
      visitorSessionId,
      attemptId: demoSessionIdRef.current,
      eventType: "demo_completed",
      cameraPath,
      isInternalTest: internalTest,
    });
  }, [phase, visitorSessionId, internalTest]);

  const summary = useMemo(() => movementSummary, [movementSummary]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#1D9E75]">
          {RASQ_DEMO_EXPERIENCE_KICKER}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-[#0F172A]">{RASQ_DEMO_EXPERIENCE_HEADING}</h1>
        <p
          className="mt-3 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950"
          role="note"
        >
          {RASQ_DEMO_MOVEMENT_DISCLAIMER}
        </p>
      </header>

      {phase === "welcome" ? (
        <section className="rounded-[12px] border border-[#E2E8F0] bg-white p-6 shadow-sm">
          <RasqDemoVoiceControls />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <RasqDemoReachRightGuideVisual />
            <RasqDemoPnfD1GuideVisual />
          </div>
          <h2 className="mt-6 text-lg font-semibold text-[#0F172A]">What you will try</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[#475569]">
            <li>Camera setup and live preview with pose overlay</li>
            <li>Reach to Right — guided targets on your right side (~90–120 seconds)</li>
            <li>Five PNF Diagonal 1 repetitions (demonstration path)</li>
            <li>Movement analysis summary (demonstration metrics)</li>
          </ol>
          <p className="mt-4 text-sm text-[#64748B]">{RASQ_DEMO_NO_RAW_VIDEO_NOTICE}</p>
          <button
            type="button"
            className="mt-6 rounded-[8px] bg-[#1D9E75] px-5 py-2.5 text-sm font-semibold text-white"
            onClick={handleStart}
          >
            Start demo
          </button>
        </section>
      ) : null}

      {phase === "active" ? (
        <section aria-label="Live demonstration session">
          <RasqDemoOrchestratorSession
            onSessionComplete={handleSessionComplete}
            onCameraPathSelected={handleCameraPathSelected}
          />
        </section>
      ) : null}

      {phase === "summary" && summary ? (
        <section className="rounded-[12px] border border-[#E2E8F0] bg-white p-6 shadow-sm">
          <RasqDemoMovementAnalysisSummaryPanel summary={summary} />

          <RasqDemoOptionalLeadForm
            demoSessionId={demoSessionId}
            visitorSessionId={visitorSessionId}
            internalTest={internalTest}
            movementSummary={summary}
            onSubmitted={() => {
              /* optional — user may skip */
            }}
          />

          <button
            type="button"
            className="mt-6 text-sm font-medium text-[#1D9E75] underline-offset-2 hover:underline"
            onClick={() => {
              welcomeCuePlayedRef.current = false;
              setPhase("welcome");
            }}
          >
            Run demo again
          </button>
        </section>
      ) : null}
    </div>
  );
}
