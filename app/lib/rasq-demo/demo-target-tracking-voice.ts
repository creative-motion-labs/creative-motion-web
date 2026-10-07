import type { ShoulderAbductionReachTrackingStatus } from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";
import type { RasqDemoVoiceCue } from "./demo-voice-manifest";

export const DEMO_TARGET_TRACKING_EPISODE_COOLDOWN_MS = 12_000;

export type DemoTargetTrackingVoiceEpisode = "tracking" | "lost";

export type DemoTargetTrackingVoiceInput = {
  nowMs: number;
  activeTargetBlock: boolean;
  sessionActive: boolean;
  trackingStatus: ShoulderAbductionReachTrackingStatus;
  hasWrist: boolean;
};

export type DemoTargetTrackingVoiceDecision =
  | { play: RasqDemoVoiceCue }
  | { play: null };

export type DemoTargetTrackingVoiceState = {
  episode: DemoTargetTrackingVoiceEpisode;
  lostCuePlayedThisEpisode: boolean;
  recoveredCuePlayedThisEpisode: boolean;
  lastEpisodeEndedAtMs: number;
};

export function createDemoTargetTrackingVoiceState(): DemoTargetTrackingVoiceState {
  return {
    episode: "tracking",
    lostCuePlayedThisEpisode: false,
    recoveredCuePlayedThisEpisode: false,
    lastEpisodeEndedAtMs: 0,
  };
}

function isTargetTrackingLost(input: DemoTargetTrackingVoiceInput): boolean {
  if (!input.sessionActive || !input.activeTargetBlock) return false;
  return input.trackingStatus === "lost" || input.trackingStatus === "error" || !input.hasWrist;
}

export function resolveDemoTargetTrackingVoiceCue(
  state: DemoTargetTrackingVoiceState,
  input: DemoTargetTrackingVoiceInput,
): { nextState: DemoTargetTrackingVoiceState; decision: DemoTargetTrackingVoiceDecision } {
  const nextState = { ...state };
  const lost = isTargetTrackingLost(input);

  if (lost && nextState.episode === "tracking") {
    if (
      nextState.lastEpisodeEndedAtMs > 0 &&
      input.nowMs - nextState.lastEpisodeEndedAtMs < DEMO_TARGET_TRACKING_EPISODE_COOLDOWN_MS
    ) {
      nextState.episode = "lost";
      return { nextState, decision: { play: null } };
    }
    nextState.episode = "lost";
    nextState.lostCuePlayedThisEpisode = false;
    nextState.recoveredCuePlayedThisEpisode = false;
  }

  if (lost && nextState.episode === "lost" && !nextState.lostCuePlayedThisEpisode) {
    nextState.lostCuePlayedThisEpisode = true;
    return { nextState, decision: { play: "target-not-found" } };
  }

  if (!lost && nextState.episode === "lost" && !nextState.recoveredCuePlayedThisEpisode) {
    nextState.recoveredCuePlayedThisEpisode = true;
    nextState.episode = "tracking";
    nextState.lastEpisodeEndedAtMs = input.nowMs;
    return { nextState, decision: { play: "target-recovered" } };
  }

  if (!lost && nextState.episode === "lost" && nextState.recoveredCuePlayedThisEpisode) {
    nextState.episode = "tracking";
    nextState.lastEpisodeEndedAtMs = input.nowMs;
  }

  return { nextState, decision: { play: null } };
}
