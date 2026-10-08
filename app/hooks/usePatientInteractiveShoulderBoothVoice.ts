"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShoulderAbductionReachPoseDetectorSnapshot } from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";
import type { InteractiveShoulderSessionCompletionSnapshot } from "@/app/lib/interactive-shoulder/orchestrator-cv-session-types";
import {
  createPatientBoothVoiceSessionState,
  patientBoothVoiceOnCountdownComplete,
  patientBoothVoiceOnMovementBlockActivated,
  patientBoothVoiceOnSessionComplete,
  patientBoothVoiceOnTargetAttemptStarted,
  patientBoothVoiceOnPatternReachConfirmed,
  patientBoothVoiceOnTargetReachConfirmed,
  patientBoothVoiceOnTherapeuticBlockRest,
  patientBoothVoiceSetMuted,
  patientBoothVoiceTickInactivity,
  readPatientBoothVoiceMutedPreference,
  disposePatientBoothVoiceHookCleanup,
  type PatientBoothVoiceSessionState,
} from "@/app/lib/interactive-shoulder/patient-booth-voice-runtime";
import { unlockPatientBoothVoiceFromUserGesture } from "@/app/lib/interactive-shoulder/patient-booth-voice-unlock";
import type { PatternCompletionEvent } from "@/app/lib/interactive-shoulder/motion-patterns/pattern-lifecycle";
import type { TargetAttemptStartEvent, TargetHitEvent } from "@/app/lib/interactive-shoulder/types";

export type PatientInteractiveShoulderBoothVoiceBindings = {
  orchestratorUiSoundEffectsEnabled: boolean;
  patientBoothVoiceControl: {
    muted: boolean;
    onToggle: () => void;
  };
  onInteractiveShoulderAudioUnlockFromGesture: () => void;
  onOrchestratorCountdownComplete: () => void;
  onTherapeuticBlockRest: (completedBlockId: string) => void;
  onReadyCountdownStarted: () => void;
  onMovementBlockActivated: (blockId: string) => void;
  onTargetAttemptStarted: (event: TargetAttemptStartEvent) => void;
  onTargetReachConfirmed: (event: TargetHitEvent) => void;
  onPatternReachConfirmed: (event: PatternCompletionEvent) => void;
  onPoseDetectorSnapshot: (snapshot: ShoulderAbductionReachPoseDetectorSnapshot) => void;
  onSessionComplete: (snapshot: InteractiveShoulderSessionCompletionSnapshot) => void;
};

export function usePatientInteractiveShoulderBoothVoice(
  onSessionComplete?: (snapshot: InteractiveShoulderSessionCompletionSnapshot) => void,
): PatientInteractiveShoulderBoothVoiceBindings {
  const [voiceMuted, setVoiceMuted] = useState(() => readPatientBoothVoiceMutedPreference());
  const voiceStateRef = useRef<PatientBoothVoiceSessionState>(createPatientBoothVoiceSessionState());
  const trackingStatusRef = useRef<ShoulderAbductionReachPoseDetectorSnapshot["trackingStatus"]>("idle");
  const onSessionCompleteRef = useRef(onSessionComplete);
  onSessionCompleteRef.current = onSessionComplete;

  const voiceOptions = useMemo(
    () => ({
      muted: voiceMuted,
    }),
    [voiceMuted],
  );

  useEffect(() => {
    return () => {
      disposePatientBoothVoiceHookCleanup(voiceStateRef.current);
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      patientBoothVoiceTickInactivity(voiceStateRef.current, {
        nowMs: Date.now(),
        trackingStatus: trackingStatusRef.current,
        muted: voiceMuted,
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [voiceMuted]);

  const unlockFromGesture = useCallback(() => {
    unlockPatientBoothVoiceFromUserGesture();
  }, []);

  const toggleVoiceMuted = useCallback(() => {
    unlockPatientBoothVoiceFromUserGesture();
    setVoiceMuted((current) => {
      const next = !current;
      patientBoothVoiceSetMuted(next);
      return next;
    });
  }, []);

  const handleOrchestratorCountdownComplete = useCallback(() => {
    patientBoothVoiceOnCountdownComplete(voiceStateRef.current, voiceOptions);
  }, [voiceOptions]);

  const handleTherapeuticBlockRest = useCallback(
    (completedBlockId: string) => {
      patientBoothVoiceOnTherapeuticBlockRest(voiceStateRef.current, completedBlockId, voiceOptions);
    },
    [voiceOptions],
  );

  const handleReadyCountdownStarted = useCallback(() => {
    unlockPatientBoothVoiceFromUserGesture();
  }, []);

  const handleMovementBlockActivated = useCallback(
    (blockId: string) => {
      patientBoothVoiceOnMovementBlockActivated(voiceStateRef.current, blockId, voiceOptions);
    },
    [voiceOptions],
  );

  const handleTargetAttemptStarted = useCallback(
    (_event: TargetAttemptStartEvent) => {
      patientBoothVoiceOnTargetAttemptStarted(voiceStateRef.current, voiceOptions);
    },
    [voiceOptions],
  );

  const handleTargetReachConfirmed = useCallback(
    (event: TargetHitEvent) => {
      patientBoothVoiceOnTargetReachConfirmed(voiceStateRef.current, event, voiceOptions);
    },
    [voiceOptions],
  );

  const handlePatternReachConfirmed = useCallback(
    (event: PatternCompletionEvent) => {
      patientBoothVoiceOnPatternReachConfirmed(voiceStateRef.current, event, voiceOptions);
    },
    [voiceOptions],
  );

  const handlePoseDetectorSnapshot = useCallback((snapshot: ShoulderAbductionReachPoseDetectorSnapshot) => {
    trackingStatusRef.current = snapshot.trackingStatus;
  }, []);

  const handleSessionComplete = useCallback(
    (snapshot: InteractiveShoulderSessionCompletionSnapshot) => {
      patientBoothVoiceOnSessionComplete(voiceStateRef.current, voiceOptions);
      onSessionCompleteRef.current?.(snapshot);
    },
    [voiceOptions],
  );

  return {
    orchestratorUiSoundEffectsEnabled: false,
    patientBoothVoiceControl: {
      muted: voiceMuted,
      onToggle: toggleVoiceMuted,
    },
    onInteractiveShoulderAudioUnlockFromGesture: unlockFromGesture,
    onOrchestratorCountdownComplete: handleOrchestratorCountdownComplete,
    onTherapeuticBlockRest: handleTherapeuticBlockRest,
    onReadyCountdownStarted: handleReadyCountdownStarted,
    onMovementBlockActivated: handleMovementBlockActivated,
    onTargetAttemptStarted: handleTargetAttemptStarted,
    onTargetReachConfirmed: handleTargetReachConfirmed,
    onPatternReachConfirmed: handlePatternReachConfirmed,
    onPoseDetectorSnapshot: handlePoseDetectorSnapshot,
    onSessionComplete: handleSessionComplete,
  };
}
