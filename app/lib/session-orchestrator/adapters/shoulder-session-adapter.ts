import type { ShoulderAbductionReachMeasuredEvent } from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";
import type { SessionInputEvent } from "@/app/lib/session-orchestrator/types";
import type { TargetHitEvent } from "@/app/lib/interactive-shoulder/types";
import type { PatternCompletionEvent } from "@/app/lib/interactive-shoulder/motion-patterns/pattern-lifecycle";
import { extractReactionTimeSampleMs } from "@/app/lib/session-orchestrator/measured-sample-extraction";

/**
 * Translates shoulder detector measured events into generic SessionInputEvent
 * values. UI and detector modules stay unaware of the orchestrator.
 */
export function mapShoulderMeasuredEventToSessionInput(
  event: ShoulderAbductionReachMeasuredEvent,
): SessionInputEvent {
  switch (event.type) {
    case "repCompleted":
      return {
        type: "validRepetition",
        capturedAtMs: event.capturedAtMs,
        metrics: { peakAngleDegrees: event.peakAngleDegrees, side: event.side },
      };
    case "compensationDetected":
      return {
        type: "compensationDetected",
        capturedAtMs: event.capturedAtMs,
        signal: "trunk_lean",
      };
    case "compensationCleared":
      return { type: "compensationCleared", capturedAtMs: event.capturedAtMs };
    case "trackerLost":
      return { type: "trackerLost", capturedAtMs: event.capturedAtMs };
    case "trackerRecovered":
      return { type: "trackerReady", capturedAtMs: event.capturedAtMs };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export function mapTargetHitToSessionInput(hit: TargetHitEvent): SessionInputEvent {
  const reactionTimeMs = extractReactionTimeSampleMs(hit.reactionTimeMs);
  return {
    type: "targetContact",
    capturedAtMs: hit.capturedAtMs,
    ...(reactionTimeMs !== null ? { reactionTimeMs } : {}),
  };
}

/** Pattern completion is a dedicated interaction event — not a target contact. */
export function mapPatternCompletionToSessionInput(
  completion: PatternCompletionEvent,
): SessionInputEvent {
  return {
    type: "patternCompleted",
    patternId: completion.patternId,
    capturedAtMs: completion.capturedAtMs,
  };
}

/** Rep completion must never imply a target hit — callers use separate paths. */
export function isMeasuredMovementEvent(event: ShoulderAbductionReachMeasuredEvent): boolean {
  return event.type === "repCompleted";
}

export function isInterpretedObservationEvent(
  event: ShoulderAbductionReachMeasuredEvent,
): boolean {
  return event.type === "compensationDetected" || event.type === "compensationCleared";
}
