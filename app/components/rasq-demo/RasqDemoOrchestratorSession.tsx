"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OrchestratorCvSessionCore } from "@/app/components/patient/interactive-shoulder/OrchestratorCvSessionCore";
import type { InteractiveShoulderSessionCompletionSnapshot } from "@/app/lib/interactive-shoulder/orchestrator-cv-session-types";
import type { ShoulderAbductionReachPoseDetectorSnapshot } from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";
import type { TargetAttemptStartEvent, TargetHitEvent } from "@/app/lib/interactive-shoulder/types";
import {
  RASQ_DEMO_PNF_D1_BLOCK_ID,
  RASQ_DEMO_PNF_D1_PRESCRIBED_REPETITIONS,
  RASQ_DEMO_REACH_RIGHT_BLOCK_ID,
  RASQ_TWO_MINUTE_DEMO_SESSION,
} from "@/app/lib/rasq-demo/demo-session-definition";
import {
  buildRasqDemoMovementAnalysisSummary,
  type RasqDemoMovementAnalysisSummary,
} from "@/app/lib/rasq-demo/demo-movement-summary";
import {
  computeDemoReachTargetAggregateMetrics,
  createDemoReachTargetPerformanceSnapshot,
  registerDemoReachTargetCompleted,
  registerDemoReachTargetStarted,
  type DemoReachTargetPerformanceSnapshot,
} from "@/app/lib/rasq-demo/demo-reach-target-performance";
import {
  createEmptyDemoPoseSample,
  ingestDemoPoseSample,
  type DemoPoseSampleSnapshot,
} from "@/app/lib/rasq-demo/demo-pose-metrics";
import { resolveRasqDemoVoiceCueForMovementBlock } from "@/app/lib/rasq-demo/demo-voice-block-cues";
import { playRasqDemoGuidanceCue } from "@/app/lib/rasq-demo/demo-voice-play";
import {
  playRasqDemoPnfFinalRepetitionChimeIfComplete,
  resetRasqDemoPnfEndpointPlayedRepetitions,
  stopAllRasqDemoPnfEndpointPlayback,
} from "@/app/lib/rasq-demo/demo-pnf-endpoint-sfx";
import {
  playRasqDemoPnfRepetitionEndpointTick,
  resetRasqDemoPnfRepetitionTickPlayed,
  stopAllRasqDemoPnfRepetitionTickPlayback,
} from "@/app/lib/rasq-demo/demo-pnf-repetition-tick-sfx";
import { stopAllRasqDemoTargetPopPlayback } from "@/app/lib/rasq-demo/demo-sfx-audio";
import {
  createDemoTargetTrackingVoiceState,
  resolveDemoTargetTrackingVoiceCue,
  type DemoTargetTrackingVoiceState,
} from "@/app/lib/rasq-demo/demo-target-tracking-voice";
import {
  RASQ_DEMO_PUBLIC_MOVEMENT_TARGET_PACING,
  RASQ_DEMO_REACH_TARGET_DURATION_SECONDS,
  shouldPlayDemoReachMidInstruction,
} from "@/app/lib/rasq-demo/demo-reach-pacing";
import {
  playRasqDemoTargetPopForConfirmedHit,
  resetRasqDemoTargetPopPlayedTargets,
} from "@/app/lib/rasq-demo/demo-sfx-audio";
import { unlockRasqDemoAudioFromUserGesture } from "@/app/lib/rasq-demo/demo-audio-unlock";
import { usePrefersReducedMotion } from "@/app/components/patient/interactive-shoulder/usePrefersReducedMotion";
import { RasqDemoPnfD1GuideVisual } from "./RasqDemoPnfD1GuideVisual";
import { RasqDemoReachRightGuideVisual } from "./RasqDemoReachRightGuideVisual";
import { RasqDemoReachTargetPerformanceHud } from "./RasqDemoReachTargetPerformanceHud";
import { RasqDemoUpperLimbMuscleFocusPanel } from "./RasqDemoUpperLimbMuscleFocusPanel";
import { RasqDemoVoiceControls, notifyRasqDemoVoiceControlsChanged } from "./RasqDemoVoiceControls";
import { registerRasqDemoVoiceControlsNotifier } from "@/app/lib/rasq-demo/demo-voice-play";
import { traceDemoReachTargetHit } from "@/app/lib/rasq-demo/demo-reach-target-hit-trace";
import { isRasqDemoSpeechGuidanceEnabled } from "@/app/lib/rasq-demo/demo-page-settings";
import {
  RASQ_DEMO_CONSENT_ALREADY_GRANTED_NOTE,
  RASQ_DEMO_CONSENT_BROWSER_NOTE,
  RASQ_DEMO_CONSENT_CHECKBOX,
  RASQ_DEMO_CONSENT_CONTINUE_BUTTON,
  RASQ_DEMO_CONSENT_DENIED_RECOVERY,
  RASQ_DEMO_CONSENT_DESCRIPTION,
  RASQ_DEMO_CONSENT_RETRY_BUTTON,
  RASQ_DEMO_CONSENT_SKIP_BUTTON,
  RASQ_DEMO_CONSENT_TITLE,
} from "@/app/lib/rasq-demo/demo-consent-copy";

const RASQ_DEMO_PUBLIC_CONSENT = {
  consentTitle: RASQ_DEMO_CONSENT_TITLE,
  consentDescription: RASQ_DEMO_CONSENT_DESCRIPTION,
  consentCheckbox: RASQ_DEMO_CONSENT_CHECKBOX,
  continueCamera: RASQ_DEMO_CONSENT_CONTINUE_BUTTON,
  skipCamera: RASQ_DEMO_CONSENT_SKIP_BUTTON,
  browserNote: RASQ_DEMO_CONSENT_BROWSER_NOTE,
  alreadyGrantedNote: RASQ_DEMO_CONSENT_ALREADY_GRANTED_NOTE,
  deniedRecovery: RASQ_DEMO_CONSENT_DENIED_RECOVERY,
  retryCamera: RASQ_DEMO_CONSENT_RETRY_BUTTON,
} as const;

export type RasqDemoOrchestratorSessionProps = {
  onSessionComplete: (summary: RasqDemoMovementAnalysisSummary) => void;
};

export function RasqDemoOrchestratorSession({ onSessionComplete }: RasqDemoOrchestratorSessionProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [activeGuideBlockId, setActiveGuideBlockId] = useState<string | null>(null);
  const [reachPerformance, setReachPerformance] = useState<DemoReachTargetPerformanceSnapshot>(
    () => createDemoReachTargetPerformanceSnapshot(),
  );
  const activeGuideBlockIdRef = useRef<string | null>(null);
  const cameraSetupCuePlayedRef = useRef(false);
  const countdownCuePlayedRef = useRef(false);
  const poseSampleRef = useRef<DemoPoseSampleSnapshot>(createEmptyDemoPoseSample());
  const trackingVoiceRef = useRef<DemoTargetTrackingVoiceState>(createDemoTargetTrackingVoiceState());
  const sessionActiveRef = useRef(false);
  const reachBlockStartedAtMsRef = useRef<number | null>(null);
  const reachBlockEndedAtMsRef = useRef<number | null>(null);
  const reachMidInstructionPlayedRef = useRef(false);
  const reachPerformanceRef = useRef(reachPerformance);
  const pnfRepetitionsCompletedRef = useRef(0);
  const demoRenderCountRef = useRef(0);
  const confirmedReachTargetIdsRef = useRef(new Set<string>());
  const startedReachTargetIdsRef = useRef(new Set<string>());
  demoRenderCountRef.current += 1;

  useEffect(() => {
    reachPerformanceRef.current = reachPerformance;
  }, [reachPerformance]);

  useEffect(() => {
    registerRasqDemoVoiceControlsNotifier(notifyRasqDemoVoiceControlsChanged);
    return () => {
      registerRasqDemoVoiceControlsNotifier(null);
      stopAllRasqDemoTargetPopPlayback();
      stopAllRasqDemoPnfEndpointPlayback();
      stopAllRasqDemoPnfRepetitionTickPlayback();
    };
  }, []);

  const handleCaptureReadinessChange = useCallback(
    (payload: {
      previewActive: boolean;
      minimumMet: boolean;
    }) => {
      if (cameraSetupCuePlayedRef.current) return;
      if (payload.previewActive && !payload.minimumMet) {
        cameraSetupCuePlayedRef.current = true;
        playRasqDemoGuidanceCue("camera-setup");
      }
    },
    [],
  );

  const handleReadyCountdownStarted = useCallback(() => {
    if (countdownCuePlayedRef.current) return;
    countdownCuePlayedRef.current = true;
    sessionActiveRef.current = true;
    playRasqDemoGuidanceCue("countdown");
  }, []);

  const handleMovementBlockActivated = useCallback((blockId: string) => {
    if (
      reachBlockStartedAtMsRef.current !== null &&
      reachBlockEndedAtMsRef.current === null &&
      blockId !== RASQ_DEMO_REACH_RIGHT_BLOCK_ID
    ) {
      reachBlockEndedAtMsRef.current = performance.now();
    }
    activeGuideBlockIdRef.current = blockId;
    setActiveGuideBlockId(blockId);
    trackingVoiceRef.current = createDemoTargetTrackingVoiceState();
    if (blockId === RASQ_DEMO_PNF_D1_BLOCK_ID) {
      pnfRepetitionsCompletedRef.current = 0;
      resetRasqDemoPnfEndpointPlayedRepetitions();
      resetRasqDemoPnfRepetitionTickPlayed();
    }
    if (blockId === RASQ_DEMO_REACH_RIGHT_BLOCK_ID) {
      reachBlockStartedAtMsRef.current = performance.now();
      reachBlockEndedAtMsRef.current = null;
      reachMidInstructionPlayedRef.current = false;
      confirmedReachTargetIdsRef.current.clear();
      startedReachTargetIdsRef.current.clear();
      resetRasqDemoTargetPopPlayedTargets();
      const fresh = createDemoReachTargetPerformanceSnapshot();
      reachPerformanceRef.current = fresh;
      setReachPerformance(fresh);
    }
    const cue = resolveRasqDemoVoiceCueForMovementBlock(blockId);
    if (cue) {
      playRasqDemoGuidanceCue(cue);
    }
  }, []);

  const handleTargetAttemptStarted = useCallback((event: TargetAttemptStartEvent) => {
    if (activeGuideBlockIdRef.current !== RASQ_DEMO_REACH_RIGHT_BLOCK_ID) return;
    if (startedReachTargetIdsRef.current.has(event.targetId)) {
      traceDemoReachTargetHit("handleTargetAttemptStarted-skipped", {
        targetId: event.targetId,
        renderCount: demoRenderCountRef.current,
        reason: "duplicate",
      });
      return;
    }
    startedReachTargetIdsRef.current.add(event.targetId);
    traceDemoReachTargetHit("handleTargetAttemptStarted", {
      targetId: event.targetId,
      renderCount: demoRenderCountRef.current,
    });
    setReachPerformance((current) => {
      const next = registerDemoReachTargetStarted(current, event);
      if (next === current) {
        return current;
      }
      reachPerformanceRef.current = next;
      traceDemoReachTargetHit("setReachPerformance-start", {
        targetId: event.targetId,
        renderCount: demoRenderCountRef.current,
      });
      return next;
    });
    const nowMs = performance.now();
    if (
      shouldPlayDemoReachMidInstruction({
        targetSequence: event.sequence,
        midInstructionAlreadyPlayed: reachMidInstructionPlayedRef.current,
        reachBlockStartedAtMs: reachBlockStartedAtMsRef.current,
        nowMs,
        reachBlockDurationSeconds: RASQ_DEMO_REACH_TARGET_DURATION_SECONDS,
      })
    ) {
      reachMidInstructionPlayedRef.current = true;
      playRasqDemoGuidanceCue("reach-right-instruction");
    }
  }, []);

  const handleTargetReachConfirmed = useCallback((hit: TargetHitEvent) => {
    traceDemoReachTargetHit("handleTargetReachConfirmed", {
      targetId: hit.targetId,
      renderCount: demoRenderCountRef.current,
    });
    if (activeGuideBlockIdRef.current !== RASQ_DEMO_REACH_RIGHT_BLOCK_ID) return;
    if (confirmedReachTargetIdsRef.current.has(hit.targetId)) {
      traceDemoReachTargetHit("handleTargetReachConfirmed-skipped", {
        targetId: hit.targetId,
        renderCount: demoRenderCountRef.current,
        reason: "duplicate",
      });
      return;
    }
    confirmedReachTargetIdsRef.current.add(hit.targetId);
    const nowMs = performance.now();
    setReachPerformance((current) => {
      const next = registerDemoReachTargetCompleted(current, hit, nowMs);
      if (next === current) {
        traceDemoReachTargetHit("setReachPerformance-complete-skipped", {
          targetId: hit.targetId,
          renderCount: demoRenderCountRef.current,
          reason: "no-op",
        });
        return current;
      }
      reachPerformanceRef.current = next;
      traceDemoReachTargetHit("setReachPerformance-complete", {
        targetId: hit.targetId,
        renderCount: demoRenderCountRef.current,
      });
      return next;
    });
    playRasqDemoTargetPopForConfirmedHit(hit);
  }, []);

  const handlePatternReachConfirmed = useCallback(() => {
    if (activeGuideBlockIdRef.current !== RASQ_DEMO_PNF_D1_BLOCK_ID) return;
    pnfRepetitionsCompletedRef.current += 1;
    const repetitionNumber = pnfRepetitionsCompletedRef.current;
    playRasqDemoPnfRepetitionEndpointTick({ repetitionNumber });
    playRasqDemoPnfFinalRepetitionChimeIfComplete({
      repetitionNumber,
      prescribedRepetitions: RASQ_DEMO_PNF_D1_PRESCRIBED_REPETITIONS,
    });
  }, []);

  const handlePoseDetectorSnapshot = useCallback((snap: ShoulderAbductionReachPoseDetectorSnapshot) => {
    poseSampleRef.current = ingestDemoPoseSample(poseSampleRef.current, {
      framesWithPose: snap.framesWithPose,
      framesTotal: snap.framesTotal,
      trackingQuality: snap.trackingQuality,
    });

    const activeTargetBlock = activeGuideBlockIdRef.current === RASQ_DEMO_REACH_RIGHT_BLOCK_ID;
    const resolved = resolveDemoTargetTrackingVoiceCue(trackingVoiceRef.current, {
      nowMs: performance.now(),
      activeTargetBlock,
      sessionActive: sessionActiveRef.current,
      trackingStatus: snap.trackingStatus,
      hasWrist: snap.primaryWristNormalized !== null,
    });
    trackingVoiceRef.current = resolved.nextState;
    if (isRasqDemoSpeechGuidanceEnabled() && resolved.decision.play) {
      playRasqDemoGuidanceCue(resolved.decision.play);
    }
  }, []);

  const handleSessionComplete = useCallback(
    (snapshot: InteractiveShoulderSessionCompletionSnapshot) => {
      sessionActiveRef.current = false;
      if (activeGuideBlockIdRef.current === RASQ_DEMO_REACH_RIGHT_BLOCK_ID) {
        reachBlockEndedAtMsRef.current = performance.now();
      }
      activeGuideBlockIdRef.current = null;
      setActiveGuideBlockId(null);

      const reachAggregate = computeDemoReachTargetAggregateMetrics({
        records: reachPerformanceRef.current.records,
        reachBlockStartedAtMs: reachBlockStartedAtMsRef.current,
        reachBlockEndedAtMs: reachBlockEndedAtMsRef.current,
      });

      onSessionComplete(
        buildRasqDemoMovementAnalysisSummary({
          snapshot,
          poseSample: poseSampleRef.current,
          reachTargetAggregate: reachAggregate,
        }),
      );
    },
    [onSessionComplete],
  );

  const isReachBlock = activeGuideBlockId === RASQ_DEMO_REACH_RIGHT_BLOCK_ID;
  const isPnfBlock = activeGuideBlockId === RASQ_DEMO_PNF_D1_BLOCK_ID;
  const liveMovementBlock = activeGuideBlockId !== null;

  const leadingPreviewCompanion = useMemo(
    () => (liveMovementBlock ? <RasqDemoUpperLimbMuscleFocusPanel /> : undefined),
    [liveMovementBlock],
  );

  const previewMeasurementOverlay = useMemo(
    () =>
      isReachBlock ? <RasqDemoReachTargetPerformanceHud snapshot={reachPerformance} /> : undefined,
    [isReachBlock, reachPerformance],
  );

  return (
    <div>
      <RasqDemoVoiceControls />
      {liveMovementBlock ? (
        <div className="mb-4 lg:hidden">
          <RasqDemoUpperLimbMuscleFocusPanel />
        </div>
      ) : null}
      {isReachBlock ? (
        <div className="mb-4 lg:hidden">
          <RasqDemoReachRightGuideVisual reducedMotion={prefersReducedMotion} />
        </div>
      ) : null}
      {isPnfBlock ? (
        <div className="mb-4 lg:hidden">
          <RasqDemoPnfD1GuideVisual reducedMotion={prefersReducedMotion} />
        </div>
      ) : null}
      <OrchestratorCvSessionCore
        language="en"
        sessionDefinition={RASQ_TWO_MINUTE_DEMO_SESSION}
        orchestratorUiSoundEffectsEnabled={false}
        publicDemoMovementTargetPacing={RASQ_DEMO_PUBLIC_MOVEMENT_TARGET_PACING}
        leadingPreviewCompanion={leadingPreviewCompanion}
        previewMeasurementOverlay={previewMeasurementOverlay}
        onCaptureReadinessChange={handleCaptureReadinessChange}
        onReadyCountdownStarted={handleReadyCountdownStarted}
        onMovementBlockActivated={handleMovementBlockActivated}
        onTargetAttemptStarted={handleTargetAttemptStarted}
        onTargetReachConfirmed={handleTargetReachConfirmed}
        onPatternReachConfirmed={handlePatternReachConfirmed}
        onDemoTargetPopAudioUnlock={unlockRasqDemoAudioFromUserGesture}
        publicDemoConsent={RASQ_DEMO_PUBLIC_CONSENT}
        onPoseDetectorSnapshot={handlePoseDetectorSnapshot}
        onSessionComplete={handleSessionComplete}
      />
    </div>
  );
}
