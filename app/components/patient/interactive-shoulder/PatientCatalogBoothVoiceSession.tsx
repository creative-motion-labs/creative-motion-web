"use client";

import { usePatientInteractiveShoulderBoothVoice } from "@/app/hooks/usePatientInteractiveShoulderBoothVoice";
import type { CatalogSessionPlayerProps } from "./CatalogSessionPlayer";
import { CatalogSessionPlayer } from "./CatalogSessionPlayer";

export type PatientCatalogBoothVoiceSessionProps = CatalogSessionPlayerProps;

/**
 * Catalog patient Interactive Shoulder with prerecorded booth voice guidance.
 * Outcome persistence stays on the ancestor `onSessionComplete` handler.
 */
export function PatientCatalogBoothVoiceSession(props: PatientCatalogBoothVoiceSessionProps) {
  const { onSessionComplete, ...rest } = props;
  const voice = usePatientInteractiveShoulderBoothVoice(onSessionComplete);

  return (
    <CatalogSessionPlayer
      {...rest}
      orchestratorUiSoundEffectsEnabled={voice.orchestratorUiSoundEffectsEnabled}
      patientBoothVoiceControl={voice.patientBoothVoiceControl}
      onInteractiveShoulderAudioUnlockFromGesture={voice.onInteractiveShoulderAudioUnlockFromGesture}
      onOrchestratorCountdownComplete={voice.onOrchestratorCountdownComplete}
      onTherapeuticBlockRest={voice.onTherapeuticBlockRest}
      onReadyCountdownStarted={voice.onReadyCountdownStarted}
      onMovementBlockActivated={voice.onMovementBlockActivated}
      onTargetAttemptStarted={voice.onTargetAttemptStarted}
      onTargetReachConfirmed={voice.onTargetReachConfirmed}
      onPoseDetectorSnapshot={voice.onPoseDetectorSnapshot}
      onSessionComplete={voice.onSessionComplete}
    />
  );
}
