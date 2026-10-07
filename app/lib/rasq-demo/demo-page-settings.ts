/** Public /demo page: spoken guidance and voice controls enabled by default. */
export const RASQ_DEMO_SPEECH_GUIDANCE_ENABLED = true;

let speechGuidanceOverrideForTests: boolean | null = null;

export function isRasqDemoSpeechGuidanceEnabled(): boolean {
  if (speechGuidanceOverrideForTests !== null) {
    return speechGuidanceOverrideForTests;
  }
  return RASQ_DEMO_SPEECH_GUIDANCE_ENABLED;
}

export function __testOnlySetRasqDemoSpeechGuidanceEnabled(value: boolean | null): void {
  speechGuidanceOverrideForTests = value;
}
