import type { NormalizedPoint } from "@/app/lib/interactive-shoulder/types";
import { toMirroredPreviewPoint } from "@/app/lib/interactive-shoulder/presentation-mirror";
import { RASQ_DEMO_D1_DIAGONAL_REACH_PATTERN } from "./rasq-demo-d1-diagonal-reach-pattern";

export function isRasqDemoPnfPattern(patternId: string | undefined | null): boolean {
  return patternId === RASQ_DEMO_D1_DIAGONAL_REACH_PATTERN.id;
}

/**
 * Single presentation conversion for pattern runner + hand marker (#277).
 * Demo PNF uses the same mirrored-preview space as clinical patterns — no second flip.
 */
export function resolveDemoPnfRunnerWrist(input: {
  measured: NormalizedPoint | null | undefined;
  devMousePreview: NormalizedPoint | null | undefined;
}): NormalizedPoint | null {
  return toMirroredPreviewPoint(input.measured) ?? input.devMousePreview ?? null;
}
