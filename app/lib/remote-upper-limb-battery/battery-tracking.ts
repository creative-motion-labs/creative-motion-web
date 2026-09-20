/**
 * Side-aware landmark tracking helpers for the remote upper-limb battery.
 * Inference runs on unmirrored video frames; left/right are anatomical (MediaPipe).
 */

import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import type { BatteryTrackingQuality } from "./battery-frame-processors";
import type { RemoteUpperLimbBatterySide } from "./types";

export type BlazePoseArmPart = "shoulder" | "elbow" | "wrist";

export const BLAZEPOSE_SIDE_INDICES: Record<
  RemoteUpperLimbBatterySide,
  Record<BlazePoseArmPart, number>
> = {
  left: { shoulder: 11, elbow: 13, wrist: 15 },
  right: { shoulder: 12, elbow: 14, wrist: 16 },
};

export type BatteryArmVisibility = {
  shoulder: number;
  elbow: number;
  wrist: number;
};

export type BatteryArmTrackingEvaluation = {
  quality: BatteryTrackingQuality;
  visibility: BatteryArmVisibility;
  ready: boolean;
  rejectionReason: string | null;
};

export function blazeIndicesForSide(
  side: RemoteUpperLimbBatterySide,
  parts: readonly BlazePoseArmPart[],
): number[] {
  const map = BLAZEPOSE_SIDE_INDICES[side];
  return parts.map((part) => map[part]);
}

export function readArmVisibility(
  landmarks: readonly PoseLandmark[],
  side: RemoteUpperLimbBatterySide,
): BatteryArmVisibility {
  const indices = BLAZEPOSE_SIDE_INDICES[side];
  return {
    shoulder: landmarks[indices.shoulder]?.visibility ?? 0,
    elbow: landmarks[indices.elbow]?.visibility ?? 0,
    wrist: landmarks[indices.wrist]?.visibility ?? 0,
  };
}

export function visibilityQualityFromValues(values: number[]): BatteryTrackingQuality {
  const present = values.filter((value) => value > 0);
  if (present.length === 0) return "unknown";
  const avg = present.reduce((sum, value) => sum + value, 0) / present.length;
  if (avg >= 0.7) return "good";
  if (avg >= 0.4) return "fair";
  return "poor";
}

export function evaluateBatteryArmTracking(input: {
  landmarks: readonly PoseLandmark[];
  side: RemoteUpperLimbBatterySide;
  requiredParts: readonly BlazePoseArmPart[];
  metricReady: boolean;
}): BatteryArmTrackingEvaluation {
  const visibility = readArmVisibility(input.landmarks, input.side);
  const requiredValues = input.requiredParts.map((part) => visibility[part]);
  const quality = visibilityQualityFromValues(requiredValues);

  if (!input.metricReady) {
    const weakest = input.requiredParts
      .map((part) => `${part}=${visibility[part].toFixed(2)}`)
      .join(", ");
    return {
      quality,
      visibility,
      ready: false,
      rejectionReason: `metric_unavailable (${weakest})`,
    };
  }

  if (quality === "poor" || quality === "unknown") {
    const weakest = input.requiredParts
      .map((part) => `${part}=${visibility[part].toFixed(2)}`)
      .join(", ");
    return {
      quality,
      visibility,
      ready: false,
      rejectionReason: `visibility_${quality} (${weakest})`,
    };
  }

  return {
    quality,
    visibility,
    ready: true,
    rejectionReason: null,
  };
}

export function isBatteryProcessorTrackingUsable(
  processor: {
    trackingReady: boolean;
    trackingQuality: BatteryTrackingQuality;
  } | null | undefined,
): boolean {
  if (!processor) return false;
  return processor.trackingReady && processor.trackingQuality !== "poor" && processor.trackingQuality !== "unknown";
}

export function resolveBatteryTrackingRejection(
  processor: {
    trackingReady: boolean;
    trackingQuality: BatteryTrackingQuality;
    trackingRejectionReason?: string | null;
  } | null | undefined,
): string {
  if (!processor) return "no_processor_snapshot";
  if (processor.trackingRejectionReason) return processor.trackingRejectionReason;
  if (!processor.trackingReady) return "tracking_not_ready";
  if (processor.trackingQuality === "poor") return "visibility_poor";
  if (processor.trackingQuality === "unknown") return "visibility_unknown";
  return "ok";
}
