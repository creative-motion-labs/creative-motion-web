/**
 * Pure presentation helpers for PostureReport.
 * Separates legacy persisted score/label from what the UI may show clinically.
 */
import type {
  PostureCheckResult,
  PostureDataSufficiency,
  PostureLabel,
} from "./posture-analyzer";

export const INSUFFICIENT_DATA_DISPLAY = "Insufficient data";

export type PostureReportPresentation = {
  isInsufficient: boolean;
  /**
   * Value shown in Overall Score / session score UI.
   * Never a "NN%" clinical score when capture is insufficient.
   */
  displayedScore: string;
  /**
   * Value shown as clinical classification.
   * Never a legacy posture label when capture is insufficient.
   */
  displayedClassification: string;
  /** True only when score/label may be shown as clinical display fields. */
  exposeLegacyClinicalFields: boolean;
};

/**
 * Derive UI presentation from sufficiency + legacy persistence fields.
 * Persisted score/label are not mutated here.
 */
export function resolvePostureReportPresentation(input: {
  dataSufficiency?: PostureDataSufficiency;
  lastFrame: PostureCheckResult | null;
  score: number | null;
  label: PostureLabel | null;
}): PostureReportPresentation {
  const isInsufficient =
    input.dataSufficiency === "insufficient" || input.lastFrame === null;

  if (isInsufficient) {
    return {
      isInsufficient: true,
      displayedScore: INSUFFICIENT_DATA_DISPLAY,
      displayedClassification: INSUFFICIENT_DATA_DISPLAY,
      exposeLegacyClinicalFields: false,
    };
  }

  return {
    isInsufficient: false,
    displayedScore:
      input.score !== null && Number.isFinite(input.score)
        ? `${input.score}%`
        : "N/A",
    displayedClassification: input.label ?? "Not classified",
    exposeLegacyClinicalFields: true,
  };
}

/** Legacy score → label mapping (unchanged thresholds). */
export function labelFromPostureScore(
  score: number | null
): PostureLabel | null {
  if (score === null || !Number.isFinite(score)) return null;
  if (score >= 80) return "Good alignment";
  if (score >= 60) return "Mild asymmetry detected";
  return "Postural deviation observed";
}
