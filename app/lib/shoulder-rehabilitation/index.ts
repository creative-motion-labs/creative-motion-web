export {
  DEFAULT_SHOULDER_ABDUCTION_REACH_THRESHOLDS,
  SHOULDER_ABDUCTION_REACH_BONUS_JOINTS,
  SHOULDER_ABDUCTION_REACH_CORE_JOINTS,
  SHOULDER_ABDUCTION_REACH_SIDES,
  type ShoulderAbductionReachBonusJoints,
  type ShoulderAbductionReachCoreJoints,
  type ShoulderAbductionReachPhase,
  type ShoulderAbductionReachSide,
  type ShoulderAbductionReachThresholds,
} from "./shoulder-abduction-reach-contract";

export {
  computeBilateralAbductionAngleDifference,
  computeShoulderAbductionAngle,
  computeShoulderAbductionReachSideMetrics,
  computeShoulderAbductionWristOffset,
  type ShoulderAbductionReachSideMetrics,
} from "./shoulder-abduction-reach-metrics";

export {
  EMPTY_SHOULDER_ABDUCTION_REACH_ARM_GEOMETRY,
  estimateShoulderAbductionReachArmLength,
  extractShoulderAbductionReachArmGeometry,
  type ShoulderAbductionReachArmGeometry,
  type ShoulderAbductionReachNormalizedPoint,
} from "./shoulder-abduction-reach-arm-geometry";

export { validateShoulderAbductionReachFrames } from "./shoulder-abduction-reach-validation";

export {
  createShoulderAbductionReachPhaseState,
  resetShoulderAbductionReachPhaseState,
  tickShoulderAbductionReachPhase,
  type ShoulderAbductionReachPhaseState,
} from "./shoulder-abduction-reach-phase";

export {
  createShoulderAbductionReachDetectorState,
  updateShoulderAbductionReachDetector,
  type ShoulderAbductionReachDetectorState,
  type ShoulderAbductionReachFrameResult,
  type ShoulderAbductionReachSideResult,
} from "./shoulder-abduction-reach-detector";

export {
  isShoulderAbductionReachShadowEnabled,
  isShoulderAbductionReachShadowPilotEnabledFromSearch,
} from "./shoulder-abduction-reach-shadow-gate";

export {
  createShoulderAbductionReachShadowSessionLog,
  recordShoulderAbductionReachShadowFrame,
  summarizeShoulderAbductionReachShadowSessionLog,
  type ShoulderAbductionReachShadowPhaseChangeEvent,
  type ShoulderAbductionReachShadowPreviousSnapshot,
  type ShoulderAbductionReachShadowRepEvent,
  type ShoulderAbductionReachShadowSessionLog,
  type ShoulderAbductionReachShadowSessionSummary,
  type ShoulderAbductionReachShadowSideSnapshot,
} from "./shoulder-abduction-reach-shadow-log";

export {
  createShoulderAbductionReachShadowState,
  runShoulderAbductionReachShadowFrame,
  type ShoulderAbductionReachShadowState,
} from "./shoulder-abduction-reach-shadow-hook";
