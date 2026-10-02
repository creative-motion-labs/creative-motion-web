/**
 * Remote Upper-Limb Battery — patient assessment contracts.
 * Camera-derived movement observations for therapist review only.
 */

export const REMOTE_UPPER_LIMB_BATTERY_SCHEMA_VERSION = 1;

export const REMOTE_UPPER_LIMB_BATTERY_TEST_ORDER = [
  "shoulderAbduction",
  "shoulderFlexion",
  "elbowFlexion",
  "functionalReach",
] as const;

export type RemoteUpperLimbBatteryTestId = (typeof REMOTE_UPPER_LIMB_BATTERY_TEST_ORDER)[number];

export type RemoteUpperLimbBatterySide = "left" | "right";

export type RemoteUpperLimbRepTestResult = {
  testId: "shoulderAbduction" | "shoulderFlexion" | "elbowFlexion";
  repsCompleted: number;
  repsRequired: number;
  peakAnglesDeg: number[];
  trackingQuality: "good" | "fair" | "poor" | "unknown";
};

export type RemoteUpperLimbFunctionalReachTestResult = {
  testId: "functionalReach";
  attemptsCompleted: number;
  attemptsRequired: number;
  peakReachExtent: number | null;
  trackingQuality: "good" | "fair" | "poor" | "unknown";
  /** Instruction-only — stepping is not measured by CV in this release. */
  steppingMeasured: false;
  therapistReviewNote: string;
};

export type RemoteUpperLimbBatteryTestResult =
  | RemoteUpperLimbRepTestResult
  | RemoteUpperLimbFunctionalReachTestResult;

export type RemoteUpperLimbBatteryPayload = {
  schemaVersion: typeof REMOTE_UPPER_LIMB_BATTERY_SCHEMA_VERSION;
  testedSide: RemoteUpperLimbBatterySide;
  completedAt: string;
  reviewRequired: true;
  tests: RemoteUpperLimbBatteryTestResult[];
};

export type RemoteUpperLimbBatteryTestDefinition = {
  id: RemoteUpperLimbBatteryTestId;
  title: string;
  requiredReps: number;
};

export const REMOTE_UPPER_LIMB_BATTERY_TESTS: readonly RemoteUpperLimbBatteryTestDefinition[] = [
  {
    id: "shoulderAbduction",
    title: "Shoulder Abduction",
    requiredReps: 3,
  },
  {
    id: "shoulderFlexion",
    title: "Shoulder Flexion",
    requiredReps: 3,
  },
  {
    id: "elbowFlexion",
    title: "Elbow Flexion",
    requiredReps: 3,
  },
  {
    id: "functionalReach",
    title: "Functional Reach",
    requiredReps: 1,
  },
];

export function getBatteryTestDefinition(
  testId: RemoteUpperLimbBatteryTestId,
): RemoteUpperLimbBatteryTestDefinition {
  const definition = REMOTE_UPPER_LIMB_BATTERY_TESTS.find((test) => test.id === testId);
  if (!definition) {
    throw new Error(`Unknown battery test: ${testId}`);
  }
  return definition;
}

export function formatBatteryArmLabel(side: RemoteUpperLimbBatterySide): string {
  return side === "right" ? "right arm" : "left arm";
}
