/**
 * Canonical prescribed side for Remote Upper-Limb Battery — therapist assignment only.
 */

import type { UpperLimbMotorScreenAssignment } from "@/app/lib/upper-limb-motor-screen/types";
import type { RemoteUpperLimbBatterySide } from "./types";

export type BatteryPrescribedSide = RemoteUpperLimbBatterySide;

export const PRESCRIBED_SIDE_UNAVAILABLE_MESSAGE =
  "Prescribed side unavailable — please contact your therapist.";

export function normalizeBatteryPrescribedSide(input: unknown): BatteryPrescribedSide | null {
  if (input === "left" || input === "right") return input;
  return null;
}

/** Reads testedSide from ULMS assignment payload — the therapist-prescribed limb for this battery. */
export function readBatteryPrescribedSideFromUlmsAssignment(
  assignmentPayload: UpperLimbMotorScreenAssignment,
): BatteryPrescribedSide | null {
  return normalizeBatteryPrescribedSide(
    assignmentPayload.taskAssignmentGroups?.[0]?.testedSide,
  );
}

export function formatResolvedPrescribedSideDevLabel(side: BatteryPrescribedSide): "LEFT" | "RIGHT" {
  return side === "left" ? "LEFT" : "RIGHT";
}

/**
 * Mirrored camera preview must not change the prescribed side used for copy, voice, or tracking.
 */
export function resolveBatteryPrescribedSideForPatientDisplay(
  prescribedSide: BatteryPrescribedSide,
  mirrorPreviewEnabled: boolean,
): BatteryPrescribedSide {
  void mirrorPreviewEnabled;
  return prescribedSide;
}
