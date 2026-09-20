/**
 * Factual clinician-facing summary of a remote upper-limb battery.
 * Measured values only — no diagnostic interpretation.
 */

import { extractRemoteUpperLimbBatteryFromStructuredData } from "./extract-assessment-battery";
import {
  getBatteryTestDefinition,
  type RemoteUpperLimbBatteryPayload,
  type RemoteUpperLimbBatteryTestResult,
} from "./types";

export type BatteryClinicianSummaryRow = {
  testTitle: string;
  completion: string;
  observation: string;
  metricConvention: string;
  trackingQuality: string;
  reviewNote?: string;
};

export type BatteryClinicianSummary = {
  title: string;
  submittedAt: string;
  testedSideLabel: string;
  reviewRequired: true;
  rows: BatteryClinicianSummaryRow[];
  disclaimer: string;
};

function formatStoredDegrees(values: number[]): string {
  if (values.length === 0) return "Peak values not recorded";
  return values
    .map((value) => {
      const rounded = Math.round(value * 10) / 10;
      return Number.isInteger(rounded) ? `${rounded}°` : `${rounded.toFixed(1)}°`;
    })
    .join(", ");
}

function formatReachExtent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "Reach displacement not recorded";
  }
  return value.toFixed(3);
}

function summarizeTest(result: RemoteUpperLimbBatteryTestResult): BatteryClinicianSummaryRow {
  const title = getBatteryTestDefinition(result.testId).title;
  if (result.testId === "functionalReach") {
    return {
      testTitle: title,
      completion: `${result.attemptsCompleted} of ${result.attemptsRequired} attempt`,
      observation: `Normalized reach displacement: ${formatReachExtent(result.peakReachExtent)}`,
      metricConvention:
        "Camera-derived displacement from baseline in normalized camera units, not centimetres or goniometry",
      trackingQuality: result.trackingQuality,
      reviewNote: result.therapistReviewNote,
    };
  }

  const conventions: Record<"shoulderAbduction" | "shoulderFlexion" | "elbowFlexion", string> = {
    shoulderAbduction: "Camera-derived hip–shoulder–elbow angle (2D, not clinical goniometry)",
    shoulderFlexion: "Camera-derived shoulder elevation (2D, not clinical goniometry)",
    elbowFlexion:
      "Camera-derived interior elbow angle (smaller value = more flexion; not clinical goniometry)",
  };

  return {
    testTitle: title,
    completion: `${result.repsCompleted} of ${result.repsRequired} repetitions`,
    observation: formatStoredDegrees(result.peakAnglesDeg),
    metricConvention: conventions[result.testId],
    trackingQuality: result.trackingQuality,
  };
}

export function buildRemoteUpperLimbBatteryClinicianSummary(input: {
  payload: RemoteUpperLimbBatteryPayload;
  submittedAt?: string;
}): BatteryClinicianSummary {
  return {
    title: "Remote Upper-Limb Battery",
    submittedAt: input.submittedAt ?? input.payload.completedAt,
    testedSideLabel: input.payload.testedSide === "left" ? "Left" : "Right",
    reviewRequired: true,
    rows: input.payload.tests.map(summarizeTest),
    disclaimer:
      "Camera-derived observations for therapist review. These values are not a diagnosis and are not clinical goniometry.",
  };
}

export function buildRemoteUpperLimbBatteryClinicianSummaryFromStructuredData(
  structuredData: unknown,
  submittedAt?: string,
): BatteryClinicianSummary | null {
  const payload = extractRemoteUpperLimbBatteryFromStructuredData(structuredData);
  if (!payload) return null;
  return buildRemoteUpperLimbBatteryClinicianSummary({ payload, submittedAt });
}
