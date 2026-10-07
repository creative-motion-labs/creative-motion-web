/**
 * Pure playback helpers for the deterministic Posture Screen clinician lab.
 * No React, DOM, camera, or persistence.
 */
import {
  aggregatePostureResults,
  type PostureAggregateResult,
  type PostureCheckResult,
} from "@/app/lib/posture-analyzer";
import {
  resolvePostureReportPresentation,
  type PostureReportPresentation,
} from "@/app/lib/posture-report-presentation";
import {
  getPostureDemoScenarioLandmarkSequences,
  listPostureDemoScenarioIds,
  runPostureAcquisitionPipeline,
  type PostureDemoScenarioId,
} from "./posture-demo-fixtures";

export type PostureLabPlaybackState = {
  scenarioId: PostureDemoScenarioId;
  /** Total scripted frames in the selected scenario. */
  frameCount: number;
  /** Next frame index to process (0..frameCount). */
  nextFrameIndex: number;
  /** Bridge outcomes including nulls, in order. */
  bridgeOutcomes: Array<PostureCheckResult | null>;
  /** Successful bridge results only (for aggregation). */
  frameResults: PostureCheckResult[];
  /** Latest bridge outcome (null if last frame was unusable). */
  lastOutcome: PostureCheckResult | null;
  /** Aggregate over successful frames so far (empty → Phase-1 insufficient). */
  aggregate: PostureAggregateResult;
  /** Clinical display fields gated by Phase-1 presentation helper. */
  presentation: PostureReportPresentation;
  /** True when every scripted frame has been stepped. */
  complete: boolean;
};

export const POSTURE_LAB_SCENARIO_OPTIONS: {
  id: PostureDemoScenarioId;
  label: string;
  description: string;
}[] = [
  {
    id: "aligned",
    label: "Aligned",
    description: "Level shoulders/hips, centred nose — score 100 expected.",
  },
  {
    id: "mildShoulderTilt",
    label: "Mild shoulder tilt",
    description: "Approximately 5° shoulder tilt — score 88 expected.",
  },
  {
    id: "markedShoulderTilt",
    label: "Marked shoulder tilt",
    description: "Approximately 10° shoulder tilt — score 75 / mild label expected.",
  },
  {
    id: "lowVisibility",
    label: "Low visibility",
    description: "Nose visibility 0.29 — bridge null; aggregate insufficient.",
  },
  {
    id: "missingRequiredJoint",
    label: "Missing required joint",
    description: "Left hip omitted — bridge null; aggregate insufficient.",
  },
  {
    id: "mixedSequence",
    label: "Mixed sequence",
    description: "Aligned then mild tilt — aggregate score 94 expected.",
  },
];

function presentationForAggregate(
  aggregate: PostureAggregateResult,
  frameResults: PostureCheckResult[]
): PostureReportPresentation {
  // Gate clinical display on sufficiency + presence of at least one bridged frame.
  // Use last successful frame (not the latest null outcome) so mixed success→fail
  // sequences still expose measured aggregate values for therapist review.
  const lastSuccessful =
    frameResults.length > 0 ? frameResults[frameResults.length - 1]! : null;
  return resolvePostureReportPresentation({
    dataSufficiency: aggregate.dataSufficiency,
    lastFrame: lastSuccessful,
    score: aggregate.score,
    label: aggregate.label,
  });
}

/** Create a fresh playback session for a scenario (no frames processed yet). */
export function createPostureLabPlayback(
  scenarioId: PostureDemoScenarioId
): PostureLabPlaybackState {
  if (!listPostureDemoScenarioIds().includes(scenarioId)) {
    throw new Error(`Unknown posture lab scenario: ${scenarioId}`);
  }

  const frameCount = getPostureDemoScenarioLandmarkSequences(scenarioId).length;
  const aggregate = aggregatePostureResults([]);
  const frameResults: PostureCheckResult[] = [];

  return {
    scenarioId,
    frameCount,
    nextFrameIndex: 0,
    bridgeOutcomes: [],
    frameResults,
    lastOutcome: null,
    aggregate,
    presentation: presentationForAggregate(aggregate, frameResults),
    complete: frameCount === 0,
  };
}

/**
 * Advance one scripted frame through the canonical acquisition → bridge path.
 * No-op (returns same state) when already complete.
 */
export function stepPostureLabPlayback(
  state: PostureLabPlaybackState
): PostureLabPlaybackState {
  if (state.complete || state.nextFrameIndex >= state.frameCount) {
    return { ...state, complete: true };
  }

  const sequences = getPostureDemoScenarioLandmarkSequences(state.scenarioId);
  const landmarks = sequences[state.nextFrameIndex];
  const { result } = runPostureAcquisitionPipeline(
    landmarks,
    state.nextFrameIndex,
    1_000 + state.nextFrameIndex * 33
  );

  const bridgeOutcomes = [...state.bridgeOutcomes, result];
  const frameResults = result
    ? [...state.frameResults, result]
    : [...state.frameResults];
  const nextFrameIndex = state.nextFrameIndex + 1;
  const complete = nextFrameIndex >= state.frameCount;
  const aggregate = aggregatePostureResults(frameResults);
  const lastOutcome = result;

  return {
    scenarioId: state.scenarioId,
    frameCount: state.frameCount,
    nextFrameIndex,
    bridgeOutcomes,
    frameResults,
    lastOutcome,
    aggregate,
    presentation: presentationForAggregate(aggregate, frameResults),
    complete,
  };
}

/** Run all remaining frames to completion. */
export function runPostureLabPlaybackToEnd(
  state: PostureLabPlaybackState
): PostureLabPlaybackState {
  let current = state;
  while (!current.complete) {
    current = stepPostureLabPlayback(current);
  }
  return current;
}

/** Convenience: create + run full scenario (matches runPostureDemoScenario aggregate). */
export function runFullPostureLabScenario(
  scenarioId: PostureDemoScenarioId
): PostureLabPlaybackState {
  return runPostureLabPlaybackToEnd(createPostureLabPlayback(scenarioId));
}

/**
 * Lab Aggregate-panel display strings only.
 * Does not mutate aggregate / persistence placeholders.
 * When insufficient, hides raw legacy score/label from clinician-visible UI.
 */
export function formatPostureLabAggregatePanelDisplay(
  state: PostureLabPlaybackState
): { scoreDisplay: string; labelDisplay: string } {
  if (
    state.presentation.isInsufficient ||
    state.aggregate.dataSufficiency === "insufficient"
  ) {
    return {
      scoreDisplay: "Hidden — legacy placeholder",
      labelDisplay: "Hidden — legacy placeholder",
    };
  }

  return {
    scoreDisplay:
      state.aggregate.score === null ? "null" : String(state.aggregate.score),
    labelDisplay: state.aggregate.label ?? "null",
  };
}
