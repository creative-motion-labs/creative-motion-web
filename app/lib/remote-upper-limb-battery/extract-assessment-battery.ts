/**
 * Read persisted remoteUpperLimbBattery from assessments.structured_data.
 */

import { validateRemoteUpperLimbBatterySubmitRequest } from "./battery-request-validation";
import type { RemoteUpperLimbBatteryPayload } from "./types";

export function extractRemoteUpperLimbBatteryFromStructuredData(
  structuredData: unknown,
): RemoteUpperLimbBatteryPayload | null {
  if (typeof structuredData !== "object" || structuredData === null) return null;
  const record = structuredData as Record<string, unknown>;
  const battery =
    record.remoteUpperLimbBattery !== undefined ? record.remoteUpperLimbBattery : record;
  const assignmentId =
    typeof record.assignmentId === "string" && record.assignmentId.trim()
      ? record.assignmentId.trim()
      : "extracted";
  const validation = validateRemoteUpperLimbBatterySubmitRequest({
    assignmentId,
    battery,
  });
  return validation.ok ? validation.input.battery : null;
}
