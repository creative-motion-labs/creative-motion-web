/**
 * Pure immutable live-measurement session controller for Posture Screen (Phase-3A).
 * No React, DOM, camera, MediaPipe, body-axis, or persistence.
 *
 * Input: NormalizedMotionFrame only.
 * Scoring: delegates to analysePostureNormalizedFrame (Phase-2A bridge).
 */
import type { NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import {
  aggregatePostureResults,
  type PostureAggregateResult,
  type PostureCheckResult,
} from "@/app/lib/posture-analyzer";
import {
  resolvePostureReportPresentation,
  type PostureReportPresentation,
} from "@/app/lib/posture-report-presentation";
import { analysePostureNormalizedFrame } from "./posture-frame-bridge";

export type PostureLiveSessionStatus = "idle" | "measuring" | "stopped";

export type PostureLiveSessionState = {
  status: PostureLiveSessionStatus;
  bridgeOutcomes: Array<PostureCheckResult | null>;
  frameResults: PostureCheckResult[];
  acceptedCount: number;
  rejectedCount: number;
  lastOutcome: PostureCheckResult | null;
  aggregate: PostureAggregateResult;
  presentation: PostureReportPresentation;
};

/**
 * Phase-2B presentation gate (copied locally — do not import from lab playback).
 * Sufficient clinical display only when aggregate is sufficient AND at least one
 * successful frame exists; lastFrame is the last successful result.
 */
function presentationForAggregate(
  aggregate: PostureAggregateResult,
  frameResults: PostureCheckResult[]
): PostureReportPresentation {
  const lastSuccessful =
    frameResults.length > 0 ? frameResults[frameResults.length - 1]! : null;
  return resolvePostureReportPresentation({
    dataSufficiency: aggregate.dataSufficiency,
    lastFrame: lastSuccessful,
    score: aggregate.score,
    label: aggregate.label,
  });
}

function emptyLiveSession(
  status: PostureLiveSessionStatus
): PostureLiveSessionState {
  const aggregate = aggregatePostureResults([]);
  const frameResults: PostureCheckResult[] = [];
  return {
    status,
    bridgeOutcomes: [],
    frameResults,
    acceptedCount: 0,
    rejectedCount: 0,
    lastOutcome: null,
    aggregate,
    presentation: presentationForAggregate(aggregate, frameResults),
  };
}

/** Create a fresh idle session (empty outcomes, insufficient presentation). */
export function createPostureLiveSession(): PostureLiveSessionState {
  return emptyLiveSession("idle");
}

/** Reset to a fresh idle session (same as create). */
export function resetPostureLiveSession(
  _state?: PostureLiveSessionState
): PostureLiveSessionState {
  return createPostureLiveSession();
}

/**
 * Enter measuring. When starting from idle/stopped, clears prior
 * outcomes, results, and counts.
 */
export function startPostureLiveSession(
  state: PostureLiveSessionState
): PostureLiveSessionState {
  if (state.status === "measuring") {
    return state;
  }
  return emptyLiveSession("measuring");
}

/**
 * Ingest one NormalizedMotionFrame while measuring.
 * No-op unless status === "measuring".
 * Accepts all successful bridge results (no fixed N / throttle / dedup).
 * Rejects (null bridge) do not reset the accepted buffer.
 */
export function ingestPostureLiveFrame(
  state: PostureLiveSessionState,
  frame: NormalizedMotionFrame
): PostureLiveSessionState {
  if (state.status !== "measuring") {
    return state;
  }

  const result = analysePostureNormalizedFrame(frame);
  const bridgeOutcomes = [...state.bridgeOutcomes, result];

  if (result) {
    const frameResults = [...state.frameResults, result];
    const aggregate = aggregatePostureResults(frameResults);
    return {
      status: "measuring",
      bridgeOutcomes,
      frameResults,
      acceptedCount: state.acceptedCount + 1,
      rejectedCount: state.rejectedCount,
      lastOutcome: result,
      aggregate,
      presentation: presentationForAggregate(aggregate, frameResults),
    };
  }

  return {
    status: "measuring",
    bridgeOutcomes,
    frameResults: state.frameResults,
    acceptedCount: state.acceptedCount,
    rejectedCount: state.rejectedCount + 1,
    lastOutcome: null,
    aggregate: state.aggregate,
    presentation: presentationForAggregate(
      state.aggregate,
      state.frameResults
    ),
  };
}

/**
 * Stop measurement. Recomputes aggregate from frameResults
 * (empty → aggregatePostureResults([])). Further ingest is ignored
 * until reset/start.
 */
export function stopPostureLiveSession(
  state: PostureLiveSessionState
): PostureLiveSessionState {
  const aggregate = aggregatePostureResults(state.frameResults);
  return {
    ...state,
    status: "stopped",
    aggregate,
    presentation: presentationForAggregate(aggregate, state.frameResults),
  };
}
