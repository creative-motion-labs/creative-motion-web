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
  instruction: string;
  requiredReps: number;
  setupInstruction?: string;
};

export const REMOTE_UPPER_LIMB_BATTERY_TESTS: readonly RemoteUpperLimbBatteryTestDefinition[] = [
  {
    id: "shoulderAbduction",
    title: "Shoulder Abduction",
    setupInstruction:
      "Stand facing the camera with your upper body and right arm fully visible.",
    instruction:
      "Raise your right arm out to the side as high as comfortably possible, then return your arm to your side.",
    requiredReps: 3,
  },
  {
    id: "shoulderFlexion",
    title: "Shoulder Flexion",
    instruction:
      "Keep your right side facing the camera. Raise your right arm forward and upward as high as comfortably possible, then return your arm to your side.",
    requiredReps: 3,
  },
  {
    id: "elbowFlexion",
    title: "Elbow Flexion",
    instruction:
      "Keep your side facing the camera. Keep your upper arm near your side. Bend your right elbow, bringing your hand toward your shoulder, then straighten it again.",
    requiredReps: 3,
  },
  {
    id: "functionalReach",
    title: "Functional Reach",
    instruction:
      "Keep your right side facing the camera. Raise your right arm forward to shoulder height. Keep your feet still. Reach forward as far as you comfortably can without taking a step, then return to the starting position.",
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
