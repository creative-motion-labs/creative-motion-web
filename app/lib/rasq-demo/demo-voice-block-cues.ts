import type { RasqDemoVoiceCue } from "./demo-voice-manifest";
import { RASQ_DEMO_PNF_D1_BLOCK_ID, RASQ_DEMO_REACH_RIGHT_BLOCK_ID } from "./demo-session-definition";

export function resolveRasqDemoVoiceCueForMovementBlock(blockId: string): RasqDemoVoiceCue | null {
  if (blockId === RASQ_DEMO_REACH_RIGHT_BLOCK_ID) return "reach-right-instruction";
  if (blockId === RASQ_DEMO_PNF_D1_BLOCK_ID) return "pnf-d1-instruction";
  return null;
}
