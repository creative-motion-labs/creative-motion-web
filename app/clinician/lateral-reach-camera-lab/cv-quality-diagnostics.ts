/**
 * Lateral Reach Camera Lab — CV quality diagnostics (lab only).
 *
 * Read-only evidence assembly from existing detector snapshot fields and
 * live video element dimensions. Does not gate calibration or engine behavior.
 */

import type { LateralReachCameraSnapshot } from "@/app/lib/cv/lateral-reach-camera-detector";

export type NormalizedPointInFrameCheck = {
  readonly xInFrame: boolean | null;
  readonly yInFrame: boolean | null;
  readonly coordsInFrame: boolean | null;
};

export type CvQualityDiagnostic = {
  readonly cameraResolution: { readonly width: number; readonly height: number } | null;
  readonly detectorStatus: LateralReachCameraSnapshot["status"];
  readonly wristLandmarkDataAvailable: boolean;
  readonly rightWristVisibility: number | null;
  readonly leftWristVisibility: number | null;
  readonly rightWristCoords: { readonly x: number; readonly y: number } | null;
  readonly leftWristCoords: { readonly x: number; readonly y: number } | null;
  readonly rightEstimatedWristCoordsInFrame: NormalizedPointInFrameCheck;
  readonly leftEstimatedWristCoordsInFrame: NormalizedPointInFrameCheck;
};

export type CvQualitySnapshotEvidence = Pick<
  LateralReachCameraSnapshot,
  | "status"
  | "rightWristVisibility"
  | "leftWristVisibility"
  | "rightWristCoords"
  | "leftWristCoords"
>;

const UNAVAILABLE_WRIST_COORDS_IN_FRAME: NormalizedPointInFrameCheck = {
  xInFrame: null,
  yInFrame: null,
  coordsInFrame: null,
};

/**
 * Wrist landmark evidence is current/live only while the detector is actively
 * acquiring or running. Retained snapshot fields after stop() are not live.
 */
export function isCurrentWristLandmarkEvidenceStatus(
  status: LateralReachCameraSnapshot["status"],
): boolean {
  return status === "acquiring" || status === "running";
}

function hasWristLandmarkSnapshotEvidence(snapshot: CvQualitySnapshotEvidence): boolean {
  return (
    snapshot.rightWristVisibility !== null ||
    snapshot.leftWristVisibility !== null ||
    snapshot.rightWristCoords !== null ||
    snapshot.leftWristCoords !== null
  );
}

/**
 * Whether normalized x/y are inside the camera frame [0, 1].
 * Returns null fields when coordinates are unavailable.
 */
export function areNormalizedCoordsInCameraFrame(
  coords: { readonly x: number; readonly y: number } | null,
): NormalizedPointInFrameCheck {
  if (coords === null) {
    return {
      xInFrame: null,
      yInFrame: null,
      coordsInFrame: null,
    };
  }

  const xInFrame = Number.isFinite(coords.x) && coords.x >= 0 && coords.x <= 1;
  const yInFrame = Number.isFinite(coords.y) && coords.y >= 0 && coords.y <= 1;

  return {
    xInFrame,
    yInFrame,
    coordsInFrame: xInFrame && yInFrame,
  };
}

/**
 * Wrist landmark data is considered currently available only during active
 * detector acquisition/running and when the snapshot exposes wrist evidence.
 */
export function isWristLandmarkDataAvailable(snapshot: CvQualitySnapshotEvidence): boolean {
  if (!isCurrentWristLandmarkEvidenceStatus(snapshot.status)) {
    return false;
  }

  return hasWristLandmarkSnapshotEvidence(snapshot);
}

/**
 * Assemble read-only CV quality diagnostics from detector snapshot evidence and
 * the live video element's decoded frame dimensions.
 */
export function resolveCvQualityDiagnostic(
  snapshot: CvQualitySnapshotEvidence,
  videoWidth: number,
  videoHeight: number,
): CvQualityDiagnostic {
  const cameraResolution =
    videoWidth > 0 && videoHeight > 0
      ? { width: videoWidth, height: videoHeight }
      : null;

  const currentWristEvidence = isCurrentWristLandmarkEvidenceStatus(snapshot.status);
  const rightWristVisibility = currentWristEvidence ? snapshot.rightWristVisibility : null;
  const leftWristVisibility = currentWristEvidence ? snapshot.leftWristVisibility : null;
  const rightWristCoords = currentWristEvidence ? snapshot.rightWristCoords : null;
  const leftWristCoords = currentWristEvidence ? snapshot.leftWristCoords : null;

  return {
    cameraResolution,
    detectorStatus: snapshot.status,
    wristLandmarkDataAvailable: isWristLandmarkDataAvailable(snapshot),
    rightWristVisibility,
    leftWristVisibility,
    rightWristCoords,
    leftWristCoords,
    rightEstimatedWristCoordsInFrame: currentWristEvidence
      ? areNormalizedCoordsInCameraFrame(rightWristCoords)
      : UNAVAILABLE_WRIST_COORDS_IN_FRAME,
    leftEstimatedWristCoordsInFrame: currentWristEvidence
      ? areNormalizedCoordsInCameraFrame(leftWristCoords)
      : UNAVAILABLE_WRIST_COORDS_IN_FRAME,
  };
}
