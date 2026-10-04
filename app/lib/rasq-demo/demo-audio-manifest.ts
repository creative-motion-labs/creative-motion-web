/**
 * Public demo audio catalog — voice cues (speech) and SFX (non-speech).
 */

import {
  RASQ_DEMO_PNF_ENDPOINT_SFX_PATH,
  RASQ_DEMO_PNF_ENDPOINT_SFX_VERSION,
} from "./demo-pnf-endpoint-sfx";
import {
  RASQ_DEMO_PNF_REPETITION_TICK_SFX_PATH,
  RASQ_DEMO_PNF_REPETITION_TICK_SFX_VERSION,
} from "./demo-pnf-repetition-tick-sfx";
import {
  RASQ_DEMO_TARGET_POP_SFX_PATH,
  RASQ_DEMO_TARGET_POP_SFX_VERSION,
} from "./demo-sfx-audio";
import { RASQ_DEMO_VOICE_CUE_MANIFEST, type RasqDemoVoiceCue } from "./demo-voice-manifest";

export type RasqDemoSfxCueId = "target-pop" | "pnf-repetition-tick" | "pnf-endpoint";

export type RasqDemoSfxCueDefinition = {
  id: RasqDemoSfxCueId;
  label: string;
  file: string;
  path: string;
  version: string;
};

export const RASQ_DEMO_SFX_CUE_MANIFEST: Record<RasqDemoSfxCueId, RasqDemoSfxCueDefinition> = {
  "target-pop": {
    id: "target-pop",
    label: "Reach target confirmation sparkle",
    file: "target-pop-en.mp3",
    path: RASQ_DEMO_TARGET_POP_SFX_PATH,
    version: RASQ_DEMO_TARGET_POP_SFX_VERSION,
  },
  "pnf-repetition-tick": {
    id: "pnf-repetition-tick",
    label: "PNF repetition endpoint tick",
    file: "pnf-repetition-tick-en.mp3",
    path: RASQ_DEMO_PNF_REPETITION_TICK_SFX_PATH,
    version: RASQ_DEMO_PNF_REPETITION_TICK_SFX_VERSION,
  },
  "pnf-endpoint": {
    id: "pnf-endpoint",
    label: "PNF block final repetition completion chime",
    file: "pnf-endpoint-en.mp3",
    path: RASQ_DEMO_PNF_ENDPOINT_SFX_PATH,
    version: RASQ_DEMO_PNF_ENDPOINT_SFX_VERSION,
  },
};

export function rasqDemoSfxPublicSrc(cue: RasqDemoSfxCueId): string {
  const entry = RASQ_DEMO_SFX_CUE_MANIFEST[cue];
  return `${entry.path}?v=${entry.version}`;
}

export { RASQ_DEMO_VOICE_CUE_MANIFEST, type RasqDemoVoiceCue };
