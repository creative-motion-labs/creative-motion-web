"use client";

/**
 * React hook wrapping the volunteer research persistence controller (Slice 8B.3).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ShoulderAbductionReachRepCaptureRecord } from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";
import type { VolunteerProtocolCondition } from "@/app/lib/research/volunteer-constants";
import {
  createVolunteerPersistenceController,
  type VolunteerPersistencePublicState,
  type VolunteerPersistencePhase,
} from "@/app/volunteer/shoulder-abduction-reach/volunteer-research-persistence-controller";

const INITIAL_PUBLIC_STATE: VolunteerPersistencePublicState = {
  phase: "idle",
  retryKind: null,
  expiresAt: null,
  deletionCode: null,
  movementSessionReady: false,
  captureTargetReached: false,
  queuedReps: [],
  safeErrorMessage: null,
  allRepsPersisted: false,
  canComplete: false,
  isCompleted: false,
  retryableRepIndex: null,
};

export type UseVolunteerResearchPersistenceReturn = VolunteerPersistencePublicState & {
  createCollectionSession: (campaignCode: string) => Promise<boolean>;
  createMovementSession: (protocolCondition: VolunteerProtocolCondition) => Promise<boolean>;
  enqueueRep: (record: ShoulderAbductionReachRepCaptureRecord) => void;
  notifyCaptureTargetReached: () => void;
  retryFailedRep: () => Promise<void>;
  retryCompletion: () => Promise<void>;
  resetMovementBlock: () => void;
  resetAll: () => void;
  clearDeletionCode: () => void;
  isCreatingSession: boolean;
  isCreatingMovement: boolean;
  isSaving: boolean;
};

export function useVolunteerResearchPersistence(): UseVolunteerResearchPersistenceReturn {
  const [publicState, setPublicState] = useState<VolunteerPersistencePublicState>(INITIAL_PUBLIC_STATE);

  const controller = useMemo(
    () => createVolunteerPersistenceController({ onStateChange: setPublicState }),
    [],
  );

  useEffect(() => {
    return () => {
      controller.dispose();
    };
  }, [controller]);

  const createCollectionSession = useCallback(
    (campaignCode: string) => controller.createCollectionSession(campaignCode),
    [controller],
  );

  const createMovementSession = useCallback(
    (protocolCondition: VolunteerProtocolCondition) =>
      controller.createMovementSession(protocolCondition),
    [controller],
  );

  const enqueueRep = useCallback(
    (record: ShoulderAbductionReachRepCaptureRecord) => controller.enqueueRep(record),
    [controller],
  );

  const notifyCaptureTargetReached = useCallback(
    () => controller.notifyCaptureTargetReached(),
    [controller],
  );

  const retryFailedRep = useCallback(() => controller.retryFailedRep(), [controller]);

  const retryCompletion = useCallback(() => controller.retryCompletion(), [controller]);

  const resetMovementBlock = useCallback(() => controller.resetMovementBlock(), [controller]);

  const resetAll = useCallback(() => controller.resetAll(), [controller]);

  const clearDeletionCode = useCallback(() => controller.clearDeletionCode(), [controller]);

  const phase = publicState.phase as VolunteerPersistencePhase;

  return useMemo(
    () => ({
      ...publicState,
      createCollectionSession,
      createMovementSession,
      enqueueRep,
      notifyCaptureTargetReached,
      retryFailedRep,
      retryCompletion,
      resetMovementBlock,
      resetAll,
      clearDeletionCode,
      isCreatingSession: phase === "creating_session",
      isCreatingMovement: phase === "creating_movement",
      isSaving: phase === "saving" || phase === "completing",
    }),
    [
      publicState,
      phase,
      createCollectionSession,
      createMovementSession,
      enqueueRep,
      notifyCaptureTargetReached,
      retryFailedRep,
      retryCompletion,
      resetMovementBlock,
      resetAll,
      clearDeletionCode,
    ],
  );
}
