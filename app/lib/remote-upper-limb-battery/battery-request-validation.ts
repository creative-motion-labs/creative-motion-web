import {
  REMOTE_UPPER_LIMB_BATTERY_SCHEMA_VERSION,
  REMOTE_UPPER_LIMB_BATTERY_TEST_ORDER,
  type RemoteUpperLimbBatteryPayload,
  type RemoteUpperLimbBatterySide,
  type RemoteUpperLimbBatteryTestResult,
} from "./types";

export type RemoteUpperLimbBatterySubmitRequest = {
  assignmentId: string;
  battery: RemoteUpperLimbBatteryPayload;
};

export type BatteryRequestValidationResult =
  | { ok: true; input: RemoteUpperLimbBatterySubmitRequest }
  | { ok: false; reason: string; detail?: string };

function isSide(value: unknown): value is RemoteUpperLimbBatterySide {
  return value === "left" || value === "right";
}

function isTrackingQuality(value: unknown): boolean {
  return value === "good" || value === "fair" || value === "poor" || value === "unknown";
}

function validateTestResult(value: unknown): RemoteUpperLimbBatteryTestResult | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const testId = record.testId;
  if (!isTrackingQuality(record.trackingQuality)) return null;

  if (testId === "functionalReach") {
    if (record.attemptsCompleted !== 1 || record.attemptsRequired !== 1) return null;
    if (record.steppingMeasured !== false) return null;
    if (typeof record.therapistReviewNote !== "string") return null;
    const peakReachExtent =
      record.peakReachExtent === null || typeof record.peakReachExtent === "number"
        ? record.peakReachExtent
        : null;
    return {
      testId: "functionalReach",
      attemptsCompleted: 1,
      attemptsRequired: 1,
      peakReachExtent,
      trackingQuality: record.trackingQuality as "good" | "fair" | "poor" | "unknown",
      steppingMeasured: false,
      therapistReviewNote: record.therapistReviewNote,
    };
  }

  if (
    testId !== "shoulderAbduction" &&
    testId !== "shoulderFlexion" &&
    testId !== "elbowFlexion"
  ) {
    return null;
  }

  if (typeof record.repsCompleted !== "number" || typeof record.repsRequired !== "number") {
    return null;
  }
  if (!Array.isArray(record.peakAnglesDeg)) return null;
  if (!record.peakAnglesDeg.every((angle) => typeof angle === "number" && Number.isFinite(angle))) {
    return null;
  }

  return {
    testId,
    repsCompleted: record.repsCompleted,
    repsRequired: record.repsRequired,
    peakAnglesDeg: record.peakAnglesDeg as number[],
    trackingQuality: record.trackingQuality as "good" | "fair" | "poor" | "unknown",
  };
}

export function validateRemoteUpperLimbBatterySubmitRequest(
  body: unknown,
): BatteryRequestValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, reason: "invalid_body" };
  }

  const record = body as Record<string, unknown>;
  if (typeof record.assignmentId !== "string" || !record.assignmentId.trim()) {
    return { ok: false, reason: "missing_assignment_id" };
  }

  const battery = record.battery;
  if (typeof battery !== "object" || battery === null) {
    return { ok: false, reason: "missing_battery" };
  }

  const batteryRecord = battery as Record<string, unknown>;
  if (batteryRecord.schemaVersion !== REMOTE_UPPER_LIMB_BATTERY_SCHEMA_VERSION) {
    return { ok: false, reason: "invalid_schema_version" };
  }
  if (!isSide(batteryRecord.testedSide)) {
    return { ok: false, reason: "invalid_tested_side" };
  }
  if (batteryRecord.reviewRequired !== true) {
    return { ok: false, reason: "review_required" };
  }
  if (typeof batteryRecord.completedAt !== "string" || !batteryRecord.completedAt) {
    return { ok: false, reason: "missing_completed_at" };
  }
  if (!Array.isArray(batteryRecord.tests)) {
    return { ok: false, reason: "missing_tests" };
  }

  const tests: RemoteUpperLimbBatteryTestResult[] = [];
  for (const entry of batteryRecord.tests) {
    const validated = validateTestResult(entry);
    if (!validated) {
      return { ok: false, reason: "invalid_test_entry" };
    }
    tests.push(validated);
  }

  if (tests.length !== REMOTE_UPPER_LIMB_BATTERY_TEST_ORDER.length) {
    return { ok: false, reason: "incomplete_battery" };
  }

  for (let index = 0; index < REMOTE_UPPER_LIMB_BATTERY_TEST_ORDER.length; index += 1) {
    if (tests[index]?.testId !== REMOTE_UPPER_LIMB_BATTERY_TEST_ORDER[index]) {
      return { ok: false, reason: "test_order_mismatch", detail: String(index) };
    }
  }

  return {
    ok: true,
    input: {
      assignmentId: record.assignmentId.trim(),
      battery: {
        schemaVersion: REMOTE_UPPER_LIMB_BATTERY_SCHEMA_VERSION,
        testedSide: batteryRecord.testedSide,
        completedAt: batteryRecord.completedAt,
        reviewRequired: true,
        tests,
      },
    },
  };
}
