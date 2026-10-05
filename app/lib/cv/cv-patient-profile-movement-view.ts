export type CvMovementTrackingViewState = "loading" | "error" | "empty" | "populated";

export function resolveCvMovementTrackingViewState(input: {
  loading: boolean;
  error: boolean;
  metricsCount: number;
}): CvMovementTrackingViewState {
  if (input.loading) return "loading";
  if (input.error) return "error";
  if (input.metricsCount <= 0) return "empty";
  return "populated";
}

export const CV_MOVEMENT_TRACKING_LOADING_MESSAGE =
  "Loading movement tracking sessions…";

export const CV_MOVEMENT_TRACKING_ERROR_MESSAGE =
  "Could not load movement tracking sessions.";

export const CV_MOVEMENT_TRACKING_EMPTY_MESSAGE =
  "No saved movement tracking sessions yet.";
