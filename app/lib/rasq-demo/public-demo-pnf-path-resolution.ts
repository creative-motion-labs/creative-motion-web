import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import type { MovementBlock } from "@/app/lib/session-orchestrator/types";
import { RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE } from "./rasq-demo-d1-diagonal-reach-pattern";

/** Approved public-demo PNF art is right-arm presentation in mirrored-preview space. */
export const PUBLIC_DEMO_PNF_PRESENTATION_SIDE: ShoulderAbductionReachSide = "right";

/**
 * Pins demo D1 path geometry for `/demo` only. Does not override orchestrator
 * therapeutic side (detector primary wrist / clinical prescribed side).
 */
export function resolvePublicDemoPnfMotionPatternSide(input: {
  publicDemoActive: boolean;
  block: Pick<MovementBlock, "feedbackProfile">;
}): ShoulderAbductionReachSide | undefined {
  if (!input.publicDemoActive) return undefined;
  if (input.block.feedbackProfile !== RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE) {
    return undefined;
  }
  return PUBLIC_DEMO_PNF_PRESENTATION_SIDE;
}
