/**
 * Shoulder Abduction Reach — participant-level experiment split.
 * RASQ ML bridge, Slice 6 (2026-08-21).
 *
 * Deterministic participant-grouped holdout split. A participant never
 * appears in more than one split. No row-level random splitting.
 */

import type { BaselineExperimentLoadedSample } from "./baseline-experiment-reader";
import {
  assessParticipantSplitFeasibility,
  type ParticipantSplitFeasibility,
} from "./baseline-experiment-readiness";
import {
  BASELINE_SPLIT_POLICY_VERSION,
  type BaselineExperimentReadinessPolicy,
  DEFAULT_BASELINE_READINESS_POLICY,
} from "./baseline-experiment-schema";

export type ParticipantLevelSplitResult = {
  splitPolicyVersion: typeof BASELINE_SPLIT_POLICY_VERSION;
  randomSeed: number;
  trainParticipantIds: string[];
  testParticipantIds: string[];
  trainSamples: BaselineExperimentLoadedSample[];
  testSamples: BaselineExperimentLoadedSample[];
  leakageCheckPassed: boolean;
  feasibility: ParticipantSplitFeasibility;
};

/** Deterministic 32-bit PRNG (Mulberry32). */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicShuffle<T>(items: readonly T[], seed: number): T[] {
  const random = createSeededRandom(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Validates that no participant appears in both train and test participant sets.
 */
export function detectParticipantSplitLeakage(
  trainParticipantIds: readonly string[],
  testParticipantIds: readonly string[],
): boolean {
  const trainSet = new Set(trainParticipantIds);
  for (const participantId of testParticipantIds) {
    if (trainSet.has(participantId)) {
      return true;
    }
  }
  return false;
}

export type ParticipantSplitOptions = {
  randomSeed: number;
  trainParticipantRatio?: number;
  readinessPolicy?: BaselineExperimentReadinessPolicy;
};

/**
 * Assigns whole participants to train/test using a seeded deterministic shuffle.
 * Repeated repetitions from the same participant stay together.
 */
export function splitSamplesByParticipant(
  samples: readonly BaselineExperimentLoadedSample[],
  options: ParticipantSplitOptions,
): ParticipantLevelSplitResult {
  const policy = options.readinessPolicy ?? DEFAULT_BASELINE_READINESS_POLICY;
  const trainParticipantRatio = options.trainParticipantRatio ?? 0.5;

  const participantIds = [...new Set(samples.map((sample) => sample.participantId))].sort(
    (a, b) => a.localeCompare(b),
  );

  const shuffledParticipants = deterministicShuffle(participantIds, options.randomSeed);

  let trainCount = Math.floor(shuffledParticipants.length * trainParticipantRatio);
  trainCount = Math.max(trainCount, policy.minTrainParticipants);
  trainCount = Math.min(
    trainCount,
    shuffledParticipants.length - policy.minTestParticipants,
  );

  const trainParticipantIds = shuffledParticipants.slice(0, trainCount).sort((a, b) =>
    a.localeCompare(b),
  );
  const testParticipantIds = shuffledParticipants.slice(trainCount).sort((a, b) =>
    a.localeCompare(b),
  );

  const trainSet = new Set(trainParticipantIds);
  const testSet = new Set(testParticipantIds);

  const trainSamples = samples
    .filter((sample) => trainSet.has(sample.participantId))
    .sort((a, b) => a.sampleId.localeCompare(b.sampleId));
  const testSamples = samples
    .filter((sample) => testSet.has(sample.participantId))
    .sort((a, b) => a.sampleId.localeCompare(b.sampleId));

  const leakageDetected = detectParticipantSplitLeakage(
    trainParticipantIds,
    testParticipantIds,
  );

  const feasibility = assessParticipantSplitFeasibility(
    samples,
    trainParticipantIds,
    testParticipantIds,
    policy,
    undefined,
  );

  return {
    splitPolicyVersion: BASELINE_SPLIT_POLICY_VERSION,
    randomSeed: options.randomSeed,
    trainParticipantIds,
    testParticipantIds,
    trainSamples,
    testSamples,
    leakageCheckPassed: !leakageDetected,
    feasibility,
  };
}
