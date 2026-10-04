export const RASQ_DEMO_VOICE_ASSET_VERSION = "6";

export const RASQ_DEMO_VOICE_CUE_IDS = [
  "welcome",
  "camera-setup",
  "reach-right-instruction",
  "pnf-d1-instruction",
  "countdown",
  "completion",
  "target-not-found",
  "target-recovered",
] as const;

export type RasqDemoVoiceCue = (typeof RASQ_DEMO_VOICE_CUE_IDS)[number];

export type RasqDemoVoiceCueDefinition = {
  file: string;
  script: string;
  label: string;
};

export const RASQ_DEMO_VOICE_CUE_MANIFEST: Record<RasqDemoVoiceCue, RasqDemoVoiceCueDefinition> = {
  welcome: {
    file: "welcome-en.mp3",
    label: "Welcome",
    script:
      "Welcome to the RASQ Interactive Movement Demo. This experience is for demonstration only and is not a medical diagnosis.",
  },
  "camera-setup": {
    file: "camera-setup-en.mp3",
    label: "Camera setup",
    script:
      "Allow camera access, then adjust your position so your upper body stays visible in the frame.",
  },
  "reach-right-instruction": {
    file: "reach-right-instruction-en.mp3",
    label: "Reach to Right",
    script:
      "Reach to your right and touch each glowing target at a comfortable pace.",
  },
  "pnf-d1-instruction": {
    file: "pnf-d1-instruction-en.mp3",
    label: "PNF Diagonal 1",
    script:
      "Follow the diagonal path with your right arm. Complete five smooth repetitions.",
  },
  countdown: {
    file: "countdown-en.mp3",
    label: "Countdown",
    script: "Three. Two. One. Begin.",
  },
  completion: {
    file: "completion-en.mp3",
    label: "Completion",
    script:
      "Well done. You have completed the RASQ Interactive Movement Demo.",
  },
  "target-not-found": {
    file: "target-not-found-en.mp3",
    label: "Target not found",
    script: "Target not found. Please move slightly back and keep your arm visible.",
  },
  "target-recovered": {
    file: "target-recovered-en.mp3",
    label: "Target recovered",
    script: "Target found. Continue reaching toward the light.",
  },
};

export function isRasqDemoVoiceCue(value: string): value is RasqDemoVoiceCue {
  return (RASQ_DEMO_VOICE_CUE_IDS as readonly string[]).includes(value);
}

export function rasqDemoVoicePublicSrc(cue: RasqDemoVoiceCue): string {
  const file = RASQ_DEMO_VOICE_CUE_MANIFEST[cue].file;
  return `/audio/demo/${file}?v=${RASQ_DEMO_VOICE_ASSET_VERSION}`;
}
