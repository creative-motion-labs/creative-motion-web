/**
 * Volunteer research persistence state machine (Slice 8B.3).
 * Pure controller — testable without React. Session token held in closure, never exposed.
 */

import type { ShoulderAbductionReachRepCaptureRecord } from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";
import type { VolunteerProtocolCondition } from "@/app/lib/research/volunteer-constants";
import type { ValidatedVolunteerRepetitionPayload } from "@/app/lib/research/volunteer-repetition-validation";
import { VOLUNTEER_TARGET_REPS } from "@/app/volunteer/shoulder-abduction-reach/volunteer-protocol";
import {
  createVolunteerBrowserPersistenceClient,
  type VolunteerBrowserPersistenceClient,
  type VolunteerPersistenceClientError,
  type VolunteerPersistenceFetchImpl,
} from "@/app/volunteer/shoulder-abduction-reach/volunteer-browser-persistence-client";
import { mapCaptureRecordToRepetitionSubmission } from "@/app/volunteer/shoulder-abduction-reach/volunteer-capture-submission-mapper";

export type VolunteerPersistencePhase =
  | "idle"
  | "creating_session"
  | "session_ready"
  | "creating_movement"
  | "capturing"
  | "saving"
  | "retry_required"
  | "completing"
  | "completed"
  | "fatal_error";

export type VolunteerRetryKind = "session" | "rep" | "completion" | null;

export type RepPersistenceState =
  | "queued"
  | "submitting"
  | "persisted"
  | "retryable_error"
  | "fatal_error";

export type QueuedRepEntry = {
  clientSubmissionId: string;
  repetitionIndex: number;
  payload: ValidatedVolunteerRepetitionPayload;
  state: RepPersistenceState;
};

export type VolunteerPersistencePublicState = {
  phase: VolunteerPersistencePhase;
  retryKind: VolunteerRetryKind;
  expiresAt: string | null;
  deletionCode: string | null;
  movementSessionReady: boolean;
  captureTargetReached: boolean;
  queuedReps: ReadonlyArray<{
    repetitionIndex: number;
    state: RepPersistenceState;
  }>;
  safeErrorMessage: string | null;
  allRepsPersisted: boolean;
  canComplete: boolean;
  isCompleted: boolean;
  retryableRepIndex: number | null;
};

export type VolunteerPersistenceControllerOptions = {
  fetchImpl?: VolunteerPersistenceFetchImpl;
  client?: VolunteerBrowserPersistenceClient;
  onStateChange?: (state: VolunteerPersistencePublicState) => void;
};

const SAFE_ERRORS = {
  invalidCampaign:
    "The study code could not be verified. Please check the code and try again, or contact the study team.",
  featureDisabled: "Volunteer data collection is not available right now. Please try again later.",
  sessionExpired:
    "This research session is no longer active. Please start again from the beginning.",
  conflict:
    "A data integrity issue was detected. Please start a new session from the beginning.",
  payloadTooLarge:
    "This repetition could not be saved because the data is too large. Please start a new capture block.",
  genericFatal: "Something went wrong. Please start again from the beginning.",
  genericRetry: "A network issue occurred. You may retry saving the pending repetition.",
  sessionRetry: "Could not start the research session. Please check your connection and try again.",
  completionFailed: "Could not finalize the session. You may retry completion.",
} as const;

function scrubQueuedRepFrames(reps: QueuedRepEntry[]): QueuedRepEntry[] {
  return reps.map((rep) => ({
    ...rep,
    payload: {
      ...rep.payload,
      frames: [],
    },
  }));
}

function deriveRetryKind(internal: InternalState): VolunteerRetryKind {
  if (internal.phase !== "retry_required") {
    return null;
  }
  if (internal.queuedReps.some((rep) => rep.state === "retryable_error")) {
    return "rep";
  }
  const allRepsPersisted =
    internal.queuedReps.length >= VOLUNTEER_TARGET_REPS &&
    internal.queuedReps.every((rep) => rep.state === "persisted");
  if (
    internal.captureTargetReached &&
    allRepsPersisted &&
    internal.sessionToken !== null
  ) {
    return "completion";
  }
  if (internal.sessionCreateRetryable) {
    return "session";
  }
  return null;
}

function toPublicState(internal: InternalState): VolunteerPersistencePublicState {
  const allRepsPersisted =
    internal.queuedReps.length >= VOLUNTEER_TARGET_REPS &&
    internal.queuedReps.every((rep) => rep.state === "persisted");
  const hasFatalRep = internal.queuedReps.some((rep) => rep.state === "fatal_error");
  const hasRetryableRep = internal.queuedReps.some((rep) => rep.state === "retryable_error");
  const hasPendingRep = internal.queuedReps.some(
    (rep) => rep.state === "queued" || rep.state === "submitting",
  );

  const canComplete =
    internal.captureTargetReached &&
    allRepsPersisted &&
    !hasFatalRep &&
    !hasRetryableRep &&
    !hasPendingRep &&
    internal.phase !== "fatal_error";

  const retryableRep = internal.queuedReps.find((rep) => rep.state === "retryable_error");

  return {
    phase: internal.phase,
    retryKind: deriveRetryKind(internal),
    expiresAt: internal.expiresAt,
    deletionCode: internal.deletionCode,
    movementSessionReady: internal.movementSessionId !== null,
    captureTargetReached: internal.captureTargetReached,
    queuedReps: internal.queuedReps.map((rep) => ({
      repetitionIndex: rep.repetitionIndex,
      state: rep.state,
    })),
    safeErrorMessage: internal.safeErrorMessage,
    allRepsPersisted,
    canComplete,
    isCompleted: internal.phase === "completed",
    retryableRepIndex: retryableRep?.repetitionIndex ?? null,
  };
}

type InternalState = {
  phase: VolunteerPersistencePhase;
  generation: number;
  sessionToken: string | null;
  expiresAt: string | null;
  movementSessionId: string | null;
  deletionCode: string | null;
  captureTargetReached: boolean;
  queuedReps: QueuedRepEntry[];
  safeErrorMessage: string | null;
  sessionCreateInFlight: boolean;
  sessionCreateRetryable: boolean;
  movementCreateInFlight: boolean;
  completionInFlight: boolean;
  queueProcessing: boolean;
};

function createInitialInternalState(): InternalState {
  return {
    phase: "idle",
    generation: 0,
    sessionToken: null,
    expiresAt: null,
    movementSessionId: null,
    deletionCode: null,
    captureTargetReached: false,
    queuedReps: [],
    safeErrorMessage: null,
    sessionCreateInFlight: false,
    sessionCreateRetryable: false,
    movementCreateInFlight: false,
    completionInFlight: false,
    queueProcessing: false,
  };
}

function errorToSafeMessage(error: VolunteerPersistenceClientError): string {
  switch (error.kind) {
    case "invalid_campaign":
      return SAFE_ERRORS.invalidCampaign;
    case "feature_disabled":
      return SAFE_ERRORS.featureDisabled;
    case "session_expired":
      return SAFE_ERRORS.sessionExpired;
    case "conflict":
      return SAFE_ERRORS.conflict;
    case "payload_too_large":
      return SAFE_ERRORS.payloadTooLarge;
    case "rate_limited":
    case "retryable":
      return SAFE_ERRORS.genericRetry;
    default:
      return SAFE_ERRORS.genericFatal;
  }
}

export type VolunteerPersistenceController = {
  getState: () => VolunteerPersistencePublicState;
  createCollectionSession: (campaignCode: string) => Promise<boolean>;
  createMovementSession: (protocolCondition: VolunteerProtocolCondition) => Promise<boolean>;
  enqueueRep: (record: ShoulderAbductionReachRepCaptureRecord) => void;
  notifyCaptureTargetReached: () => void;
  retryFailedRep: () => Promise<void>;
  retryCompletion: () => Promise<void>;
  resetMovementBlock: () => void;
  resetAll: () => void;
  clearDeletionCode: () => void;
  dispose: () => void;
  /** @internal Behavioral tests only */
  __testOnly: {
    getQueuedRepFrameCounts: () => number[];
  };
};

export function createVolunteerPersistenceController(
  options: VolunteerPersistenceControllerOptions = {},
): VolunteerPersistenceController {
  const client = options.client ?? createVolunteerBrowserPersistenceClient(options.fetchImpl);
  let state = createInitialInternalState();
  let abortController: AbortController | null = null;
  const mounted = { value: true };

  const emit = () => {
    if (mounted.value) {
      options.onStateChange?.(toPublicState(state));
    }
  };

  const setState = (patch: Partial<InternalState>) => {
    state = { ...state, ...patch };
    emit();
  };

  const bumpGeneration = () => {
    if (abortController) {
      abortController.abort();
    }
    abortController = new AbortController();
    setState({ generation: state.generation + 1 });
    return state.generation;
  };

  const clearSensitiveState = () => {
    scrubQueuedRepFrames(state.queuedReps);
    state = {
      ...createInitialInternalState(),
      generation: state.generation,
    };
  };

  const isCurrentGeneration = (generation: number) =>
    mounted.value && generation === state.generation;

  const processQueue = async (generation: number) => {
    if (!isCurrentGeneration(generation)) return;
    if (state.queueProcessing) return;
    if (!state.sessionToken || !state.movementSessionId) return;

    setState({ queueProcessing: true, phase: state.phase === "capturing" ? "saving" : state.phase });

    while (isCurrentGeneration(generation)) {
      const nextRep = state.queuedReps.find(
        (rep) => rep.state === "queued" || rep.state === "retryable_error",
      );
      if (!nextRep) break;

      const repIndex = state.queuedReps.indexOf(nextRep);
      const updatedReps = [...state.queuedReps];
      updatedReps[repIndex] = { ...nextRep, state: "submitting" };
      setState({ queuedReps: updatedReps, safeErrorMessage: null, sessionCreateRetryable: false });

      const result = await client.submitRepetition(
        state.sessionToken!,
        nextRep.payload,
        abortController?.signal,
      );

      if (!isCurrentGeneration(generation)) return;

      if (result.ok) {
        const repsAfterSuccess = [...state.queuedReps];
        repsAfterSuccess[repIndex] = {
          ...nextRep,
          state: "persisted",
          payload: {
            ...nextRep.payload,
            frames: [],
          },
        };
        setState({ queuedReps: repsAfterSuccess });
        continue;
      }

      const safeMessage = errorToSafeMessage(result.error);
      const repsAfterError = [...state.queuedReps];
      if (result.error.kind === "conflict" || result.error.kind === "payload_too_large") {
        repsAfterError[repIndex] = { ...nextRep, state: "fatal_error" };
        setState({
          queuedReps: repsAfterError,
          phase: "fatal_error",
          safeErrorMessage: safeMessage,
          queueProcessing: false,
        });
        return;
      }
      if (result.error.kind === "session_expired") {
        repsAfterError[repIndex] = { ...nextRep, state: "fatal_error" };
        setState({
          queuedReps: repsAfterError,
          phase: "fatal_error",
          safeErrorMessage: safeMessage,
          queueProcessing: false,
        });
        return;
      }
      if (result.error.retryable) {
        repsAfterError[repIndex] = { ...nextRep, state: "retryable_error" };
        setState({
          queuedReps: repsAfterError,
          phase: "retry_required",
          safeErrorMessage: safeMessage,
          queueProcessing: false,
        });
        return;
      }

      repsAfterError[repIndex] = { ...nextRep, state: "fatal_error" };
      setState({
        queuedReps: repsAfterError,
        phase: "fatal_error",
        safeErrorMessage: safeMessage,
        queueProcessing: false,
      });
      return;
    }

    if (!isCurrentGeneration(generation)) return;

    setState({ queueProcessing: false });

    const publicState = toPublicState(state);
    if (publicState.canComplete && state.phase !== "completed" && !state.completionInFlight) {
      await attemptCompletion(generation);
    } else if (state.captureTargetReached && state.phase === "saving") {
      const hasRetryable = state.queuedReps.some((rep) => rep.state === "retryable_error");
      const hasPending = state.queuedReps.some(
        (rep) => rep.state === "queued" || rep.state === "submitting",
      );
      if (!hasRetryable && !hasPending && !publicState.canComplete) {
        setState({ phase: "capturing" });
      }
    }
  };

  const attemptCompletion = async (generation: number) => {
    if (!isCurrentGeneration(generation)) return;
    if (!state.sessionToken) return;
    if (state.completionInFlight) return;

    const publicState = toPublicState(state);
    if (!publicState.canComplete) return;

    setState({
      completionInFlight: true,
      phase: "completing",
      safeErrorMessage: null,
      sessionCreateRetryable: false,
    });

    const result = await client.completeSession(state.sessionToken, abortController?.signal);

    if (!isCurrentGeneration(generation)) return;

    setState({ completionInFlight: false });

    if (result.ok) {
      if ("alreadyCompleted" in result.value && result.value.alreadyCompleted) {
        setState({ phase: "completed", safeErrorMessage: null });
        return;
      }
      if ("deletionCode" in result.value) {
        setState({
          phase: "completed",
          deletionCode: result.value.deletionCode,
          safeErrorMessage: null,
        });
        return;
      }
      setState({
        phase: "retry_required",
        safeErrorMessage: SAFE_ERRORS.completionFailed,
      });
      return;
    }

    if (result.error.retryable) {
      setState({
        phase: "retry_required",
        safeErrorMessage: SAFE_ERRORS.completionFailed,
      });
      return;
    }

    setState({
      phase: "fatal_error",
      safeErrorMessage: errorToSafeMessage(result.error),
    });
  };

  return {
    getState: () => toPublicState(state),

    async createCollectionSession(campaignCode) {
      if (state.sessionCreateInFlight) return false;
      if (state.sessionToken) return true;

      const generation = bumpGeneration();
      setState({
        sessionCreateInFlight: true,
        phase: "creating_session",
        safeErrorMessage: null,
        sessionCreateRetryable: false,
      });

      const result = await client.createSession(campaignCode, abortController?.signal);

      if (!isCurrentGeneration(generation)) return false;

      setState({ sessionCreateInFlight: false });

      if (result.ok) {
        setState({
          sessionToken: result.value.sessionToken,
          expiresAt: result.value.expiresAt,
          phase: "session_ready",
          safeErrorMessage: null,
          sessionCreateRetryable: false,
        });
        return true;
      }

      if (result.error.retryable) {
        setState({
          phase: "retry_required",
          safeErrorMessage: SAFE_ERRORS.sessionRetry,
          sessionCreateRetryable: true,
        });
        return false;
      }

      setState({
        phase: "fatal_error",
        safeErrorMessage: errorToSafeMessage(result.error),
        sessionCreateRetryable: false,
      });
      return false;
    },

    async createMovementSession(protocolCondition) {
      if (!state.sessionToken) return false;
      if (state.movementCreateInFlight) return false;
      if (state.movementSessionId) return true;

      const generation = state.generation;
      setState({
        movementCreateInFlight: true,
        phase: "creating_movement",
        safeErrorMessage: null,
      });

      const result = await client.createMovementSession(
        state.sessionToken,
        {
          movementType: "shoulder_abduction_reach",
          protocolCondition,
          side: "right",
        },
        abortController?.signal,
      );

      if (!isCurrentGeneration(generation)) return false;

      setState({ movementCreateInFlight: false });

      if (result.ok) {
        setState({
          movementSessionId: result.value.movementSessionId,
          phase: "capturing",
          safeErrorMessage: null,
        });
        return true;
      }

      if (result.error.kind === "session_expired") {
        setState({
          phase: "fatal_error",
          safeErrorMessage: errorToSafeMessage(result.error),
        });
        return false;
      }

      setState({
        phase: "session_ready",
        safeErrorMessage: errorToSafeMessage(result.error),
      });
      return false;
    },

    enqueueRep(record) {
      if (!state.movementSessionId) return;
      if (state.queuedReps.length >= VOLUNTEER_TARGET_REPS) return;
      if (state.queuedReps.some((rep) => rep.repetitionIndex === record.context.repetitionIndex)) {
        return;
      }

      const clientSubmissionId = crypto.randomUUID();
      const payload = mapCaptureRecordToRepetitionSubmission({
        record,
        movementSessionId: state.movementSessionId,
        clientSubmissionId,
      });

      const entry: QueuedRepEntry = {
        clientSubmissionId,
        repetitionIndex: record.context.repetitionIndex,
        payload,
        state: "queued",
      };

      setState({
        queuedReps: [...state.queuedReps, entry],
        phase: state.phase === "session_ready" ? "capturing" : state.phase,
        sessionCreateRetryable: false,
      });

      void processQueue(state.generation);
    },

    notifyCaptureTargetReached() {
      setState({ captureTargetReached: true });
      void processQueue(state.generation);
    },

    async retryFailedRep() {
      const generation = state.generation;
      const retryable = state.queuedReps.find((rep) => rep.state === "retryable_error");
      if (!retryable) return;

      const repIndex = state.queuedReps.indexOf(retryable);
      const updatedReps = [...state.queuedReps];
      updatedReps[repIndex] = { ...retryable, state: "queued" };
      setState({
        queuedReps: updatedReps,
        phase: "saving",
        safeErrorMessage: null,
        sessionCreateRetryable: false,
      });
      await processQueue(generation);
    },

    async retryCompletion() {
      const publicState = toPublicState(state);
      if (!publicState.canComplete) return;
      await attemptCompletion(state.generation);
    },

    resetMovementBlock() {
      bumpGeneration();
      setState({
        movementSessionId: null,
        captureTargetReached: false,
        queuedReps: [],
        phase: state.sessionToken ? "session_ready" : "idle",
        safeErrorMessage: null,
        movementCreateInFlight: false,
        completionInFlight: false,
        queueProcessing: false,
        deletionCode: null,
        sessionCreateRetryable: false,
      });
    },

    resetAll() {
      bumpGeneration();
      clearSensitiveState();
      emit();
    },

    clearDeletionCode() {
      setState({ deletionCode: null });
    },

    dispose() {
      mounted.value = false;
      if (abortController) {
        abortController.abort();
      }
      bumpGeneration();
      clearSensitiveState();
    },

    __testOnly: {
      getQueuedRepFrameCounts: () => state.queuedReps.map((rep) => rep.payload.frames.length),
    },
  };
}
