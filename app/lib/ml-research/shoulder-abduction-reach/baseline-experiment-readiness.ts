/**
 * Shoulder Abduction Reach — baseline experiment readiness gate.
 * RASQ ML bridge, Slice 6 (2026-08-21).
 *
 * Explicit methodology gate before any training/evaluation. Refuses
 * scientifically inadequate real-data experiments without fabricating metrics.
 */

import type { BaselineExperimentLoadedSample } from "./baseline-experiment-reader";
import {
  BASELINE_COMPENSATION_LABELS,
  emptyClassDistribution,
  type BaselineClassDistribution,
  type BaselineExperimentReadinessPolicy,
  type BaselineExperimentReadinessReason,
  DEFAULT_BASELINE_READINESS_POLICY,
} from "./baseline-experiment-schema";

export type BaselineReadinessAssessment = {
  ready: boolean;
  reasons: BaselineExperimentReadinessReason[];
  distinctParticipants: number;
  supervisedSampleCount: number;
  classDistribution: BaselineClassDistribution;
  distinctTargetClasses: number;
};

function countClassDistribution(
  samples: readonly BaselineExperimentLoadedSample[],
): BaselineClassDistribution {
  const distribution = emptyClassDistribution();
  for (const sample of samples) {
    distribution[sample.compensationLabel] += 1;
  }
  return distribution;
}

function countDistinctTargetClasses(distribution: BaselineClassDistribution): number {
  return (Object.values(distribution) as number[]).filter((count) => count > 0).length;
}

/**
 * Pre-split readiness assessment. Does NOT attempt row-level splitting.
 * Methodology/configuration only — not a clinical sample-size claim.
 */
export function assessBaselineExperimentReadiness(
  samples: readonly BaselineExperimentLoadedSample[],
  policy: BaselineExperimentReadinessPolicy = DEFAULT_BASELINE_READINESS_POLICY,
): BaselineReadinessAssessment {
  const reasons: BaselineExperimentReadinessReason[] = [];
  const distinctParticipants = new Set(samples.map((sample) => sample.participantId)).size;
  const supervisedSampleCount = samples.length;
  const classDistribution = countClassDistribution(samples);
  const distinctTargetClasses = countDistinctTargetClasses(classDistribution);

  if (distinctParticipants < policy.minDistinctParticipants) {
    reasons.push("insufficient_distinct_participants_for_participant_level_split");
  }

  if (supervisedSampleCount < policy.minSupervisedSamples) {
    reasons.push("insufficient_eligible_supervised_samples");
  }

  if (distinctTargetClasses < policy.minDistinctTargetClasses) {
    reasons.push("insufficient_target_class_support");
  } else {
    for (const label of Object.keys(classDistribution) as Array<
      keyof BaselineClassDistribution
    >) {
      if (
        classDistribution[label] > 0 &&
        classDistribution[label] < policy.minSamplesPerTargetClass
      ) {
        reasons.push("insufficient_target_class_support");
        break;
      }
    }
  }

  return {
    ready: reasons.length === 0,
    reasons,
    distinctParticipants,
    supervisedSampleCount,
    classDistribution,
    distinctTargetClasses,
  };
}

export type ParticipantSplitFeasibility = {
  feasible: boolean;
  reason: BaselineExperimentReadinessReason | null;
};

/**
 * Post-split class coverage check. Whole-dataset class support can pass while
 * participant holdout leaves a target class absent from train or test.
 */
export function assessPostSplitTargetClassSupport(
  trainSamples: readonly BaselineExperimentLoadedSample[],
  testSamples: readonly BaselineExperimentLoadedSample[],
  fullDatasetDistribution: BaselineClassDistribution,
  policy: BaselineExperimentReadinessPolicy = DEFAULT_BASELINE_READINESS_POLICY,
): ParticipantSplitFeasibility {
  const trainDistribution = countClassDistribution(trainSamples);
  const testDistribution = countClassDistribution(testSamples);
  const trainDistinctClasses = countDistinctTargetClasses(trainDistribution);

  if (trainDistinctClasses < policy.minDistinctTargetClasses) {
    return { feasible: false, reason: "insufficient_post_split_target_class_support" };
  }

  for (const label of BASELINE_COMPENSATION_LABELS) {
    if (fullDatasetDistribution[label] === 0) {
      continue;
    }
    if (trainDistribution[label] === 0 || testDistribution[label] === 0) {
      return { feasible: false, reason: "insufficient_post_split_target_class_support" };
    }
  }

  return { feasible: true, reason: null };
}

/**
 * Checks whether a participant-level holdout split can satisfy policy minima
 * and post-split target-class coverage before model fitting.
 */
export function assessParticipantSplitFeasibility(
  samples: readonly BaselineExperimentLoadedSample[],
  trainParticipantIds: readonly string[],
  testParticipantIds: readonly string[],
  policy: BaselineExperimentReadinessPolicy = DEFAULT_BASELINE_READINESS_POLICY,
  fullDatasetDistribution?: BaselineClassDistribution,
): ParticipantSplitFeasibility {
  const trainSamples = samples.filter((sample) =>
    trainParticipantIds.includes(sample.participantId),
  );
  const testSamples = samples.filter((sample) =>
    testParticipantIds.includes(sample.participantId),
  );

  if (
    trainParticipantIds.length < policy.minTrainParticipants ||
    testParticipantIds.length < policy.minTestParticipants ||
    trainSamples.length < policy.minTrainSamples ||
    testSamples.length < policy.minTestSamples
  ) {
    return { feasible: false, reason: "participant_split_not_feasible" };
  }

  const datasetDistribution = fullDatasetDistribution ?? countClassDistribution(samples);
  const classSupport = assessPostSplitTargetClassSupport(
    trainSamples,
    testSamples,
    datasetDistribution,
    policy,
  );
  if (!classSupport.feasible) {
    return classSupport;
  }

  return { feasible: true, reason: null };
}
