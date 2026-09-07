/**
 * Read-only parser for persisted Remote Upper-Limb Battery payloads.
 * Reuses the demo battery contracts. Does not change capture or submit paths.
 */

import {
  REMOTE_UPPER_LIMB_BATTERY_SCHEMA_VERSION,
  type RemoteUpperLimbBatteryPayload,
  type RemoteUpperLimbBatterySide,
  type RemoteUpperLimbBatteryTestResult,
  type RemoteUpperLimbFunctionalReachTestResult,
  type RemoteUpperLimbRepTestResult,
} from "./types";

function isSide(value: unknown): value is RemoteUpperLimbBatterySide {
  return value === "left" || value === "right";
}

function isTrackingQuality(
  value: unknown,
): value is RemoteUpperLimbRepTestResult["trackingQuality"] {
  return value === "good" || value === "fair" || value === "poor" || value === "unknown";
}

function parseRomTest(record: Record<string, unknown>): RemoteUpperLimbRepTestResult | null {
  const testId = record.testId;
  if (
    testId !== "shoulderAbduction" &&
    testId !== "shoulderFlexion" &&
    testId !== "elbowFlexion"
  ) {
    return null;
  }
  if (typeof record.repsCompleted !== "number" || !Number.isFinite(record.repsCompleted)) {
    return null;
  }
  if (typeof record.repsRequired !== "number" || !Number.isFinite(record.repsRequired)) {
    return null;
  }
  if (!Array.isArray(record.peakAnglesDeg)) return null;
  if (!record.peakAnglesDeg.every((angle) => typeof angle === "number" && Number.isFinite(angle))) {
    return null;
  }
  if (!isTrackingQuality(record.trackingQuality)) return null;

  return {
    testId,
    repsCompleted: record.repsCompleted,
    repsRequired: record.repsRequired,
    peakAnglesDeg: record.peakAnglesDeg,
    trackingQuality: record.trackingQuality,
  };
}

function parseFunctionalReachTest(
  record: Record<string, unknown>,
): RemoteUpperLimbFunctionalReachTestResult | null {
  if (record.testId !== "functionalReach") return null;
  if (typeof record.attemptsCompleted !== "number") return null;
  if (typeof record.attemptsRequired !== "number") return null;
  if (!isTrackingQuality(record.trackingQuality)) return null;
  if (record.steppingMeasured !== false) return null;
  if (typeof record.therapistReviewNote !== "string") return null;
  const peakReachExtent =
    record.peakReachExtent === null || typeof record.peakReachExtent === "number"
      ? record.peakReachExtent
      : null;

  return {
    testId: "functionalReach",
    attemptsCompleted: record.attemptsCompleted,
    attemptsRequired: record.attemptsRequired,
    peakReachExtent,
    trackingQuality: record.trackingQuality,
    steppingMeasured: false,
    therapistReviewNote: record.therapistReviewNote,
  };
}

export function parseRemoteUpperLimbBatteryPayload(
  value: unknown,
): RemoteUpperLimbBatteryPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== REMOTE_UPPER_LIMB_BATTERY_SCHEMA_VERSION) return null;
  if (!isSide(record.testedSide)) return null;
  if (record.reviewRequired !== true) return null;
  if (typeof record.completedAt !== "string" || !record.completedAt.trim()) return null;
  if (!Array.isArray(record.tests)) return null;

  const tests: RemoteUpperLimbBatteryTestResult[] = [];
  for (const entry of record.tests) {
    if (typeof entry !== "object" || entry === null) return null;
    const testRecord = entry as Record<string, unknown>;
    const rom = parseRomTest(testRecord);
    if (rom) {
      tests.push(rom);
      continue;
    }
    const reach = parseFunctionalReachTest(testRecord);
    if (reach) {
      tests.push(reach);
      continue;
    }
    return null;
  }

  return {
    schemaVersion: REMOTE_UPPER_LIMB_BATTERY_SCHEMA_VERSION,
    testedSide: record.testedSide,
    completedAt: record.completedAt,
    reviewRequired: true,
    tests,
  };
}

/** Reads battery JSON from assessments.structured_data when present. */
export function extractRemoteUpperLimbBatteryFromStructuredData(
  structuredData: unknown,
): RemoteUpperLimbBatteryPayload | null {
  if (typeof structuredData !== "object" || structuredData === null) return null;
  const record = structuredData as Record<string, unknown>;
  return parseRemoteUpperLimbBatteryPayload(record.remoteUpperLimbBattery);
}

export function peakObservedAngleDeg(peakAnglesDeg: readonly number[]): number | null {
  const finite = peakAnglesDeg.filter((angle) => Number.isFinite(angle));
  if (finite.length === 0) return null;
  return Math.max(...finite);
}

export function findBatteryRomTest(
  battery: RemoteUpperLimbBatteryPayload,
  testId: RemoteUpperLimbRepTestResult["testId"],
): RemoteUpperLimbRepTestResult | null {
  const match = battery.tests.find((test) => test.testId === testId);
  return match && match.testId !== "functionalReach" ? match : null;
}
