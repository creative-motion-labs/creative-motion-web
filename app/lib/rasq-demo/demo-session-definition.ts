import { RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE } from "./rasq-demo-d1-diagonal-reach-pattern";
import type { SessionDefinition } from "@/app/lib/session-orchestrator/types";

export const RASQ_DEMO_REACH_RIGHT_BLOCK_ID = "rasq-demo-reach-right";
export const RASQ_DEMO_PNF_D1_BLOCK_ID = "rasq-demo-pnf-d1-repetitions";
export const RASQ_DEMO_PNF_D1_PRESCRIBED_REPETITIONS = 5;

import { RASQ_DEMO_REACH_TARGET_DURATION_SECONDS } from "./demo-reach-pacing";

/** Public movement demo — not wired to patient plans or clinical storage. */
export const RASQ_TWO_MINUTE_DEMO_SESSION: SessionDefinition = {
  sessionId: "rasq-public-two-minute-demo-v1",
  title: "RASQ interactive movement demonstration",
  recalibrationGraceSeconds: 5,
  sessionTimeoutSeconds: 300,
  blocks: [
    {
      blockId: RASQ_DEMO_REACH_RIGHT_BLOCK_ID,
      movementId: "shoulder-abduction-reach",
      movementVersion: "v1",
      title: "Reach to Right",
      instructions:
        "Reach to your right side toward each glowing target. Move at a comfortable pace.",
      completionMode: "duration",
      targetDurationSeconds: RASQ_DEMO_REACH_TARGET_DURATION_SECONDS,
      restAfterSeconds: 3,
      supportedPositions: ["seated", "standing"],
      side: "right",
      intensityLevel: 1,
      blockType: "movement-target",
      feedbackProfile: "shoulder-therapeutic-target",
      safetyRules: {
        trackerLossGraceSeconds: 0,
        maxCompensationEventsBeforePause: 5,
        blockTimeoutSeconds: 130,
      },
    },
    {
      blockId: RASQ_DEMO_PNF_D1_BLOCK_ID,
      movementId: "shoulder-abduction-reach",
      movementVersion: "v1",
      title: "PNF Diagonal 1 (demonstration)",
      instructions:
        "Follow the diagonal path with your right arm. Complete five smooth repetitions.",
      completionMode: "validRepetitions",
      prescribedRepetitions: RASQ_DEMO_PNF_D1_PRESCRIBED_REPETITIONS,
      restAfterSeconds: 0,
      supportedPositions: ["seated", "standing"],
      side: "right",
      intensityLevel: 1,
      blockType: "movement-pattern",
      feedbackProfile: RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE,
      safetyRules: {
        trackerLossGraceSeconds: 0,
        maxCompensationEventsBeforePause: 5,
        blockTimeoutSeconds: 120,
      },
    },
  ],
};
