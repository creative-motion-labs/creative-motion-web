import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import type { ResolvedInteractiveShoulderSide } from "./resolve-interactive-shoulder-side";

export interface OrchestratorCvDetectorHandle {
  stop(): void;
}

export interface OrchestratorCvActiveDetectorHandle extends OrchestratorCvDetectorHandle {
  start(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<void>;
}

export type OrchestratorCvDetectorCallbacks<TSnapshot, TEvent> = {
  onSnapshot: (snap: TSnapshot) => void;
  onMeasuredEvent: (event: TEvent) => void;
};

export type OrchestratorCvDetectorFactory<
  T extends OrchestratorCvActiveDetectorHandle,
  TSnapshot = unknown,
  TEvent = unknown,
> = (
  callbacks: OrchestratorCvDetectorCallbacks<TSnapshot, TEvent>,
  side: ShoulderAbductionReachSide,
) => T;

/**
 * Creates a pose detector only when orchestrator laterality is fully resolved.
 * Strict clinical mode passes null here — no constructor, no RIGHT placeholder.
 */
export function mountOrchestratorCvDetector<
  T extends OrchestratorCvActiveDetectorHandle,
  TSnapshot,
  TEvent,
>(
  resolvedSide: ResolvedInteractiveShoulderSide | null,
  factory: OrchestratorCvDetectorFactory<T, TSnapshot, TEvent>,
  callbacks: OrchestratorCvDetectorCallbacks<TSnapshot, TEvent>,
): T | null {
  if (resolvedSide === null) {
    return null;
  }
  return factory(callbacks, resolvedSide.side);
}

export function disposeOrchestratorCvDetector(
  detector: OrchestratorCvDetectorHandle | null | undefined,
): void {
  detector?.stop();
}

/** Guards camera/session start — blocked clinical laterality must not request camera access. */
export function shouldStartOrchestratorCvCamera(input: {
  consentAccepted: boolean;
  profileAvailable: boolean;
  resolvedTherapeuticSide: ResolvedInteractiveShoulderSide | null;
}): boolean {
  return Boolean(
    input.consentAccepted && input.profileAvailable && input.resolvedTherapeuticSide !== null,
  );
}
