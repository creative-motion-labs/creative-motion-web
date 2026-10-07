type OrchestratorCvInitTraceCounters = {
  renders: number;
  startSessionCalls: number;
  detectorLayoutMounts: number;
  detectorLayoutCleanups: number;
  cameraStartEffectRuns: number;
  rafLoopMounts: number;
  rafHudCommits: number;
  rafFramesSkippedForPause: number;
  poseSnapshotCommits: number;
  poseSnapshotLiveFrames: number;
};

const counters: OrchestratorCvInitTraceCounters = {
  renders: 0,
  startSessionCalls: 0,
  detectorLayoutMounts: 0,
  detectorLayoutCleanups: 0,
  cameraStartEffectRuns: 0,
  rafLoopMounts: 0,
  rafHudCommits: 0,
  rafFramesSkippedForPause: 0,
  poseSnapshotCommits: 0,
  poseSnapshotLiveFrames: 0,
};

function enabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function traceOrchestratorCvInit(
  tag: string,
  payload?: Record<string, unknown>,
): void {
  if (!enabled()) return;
  console.debug(`[orchestrator-cv-init:${tag}]`, payload ?? {});
}

export function bumpOrchestratorCvInitCounter(
  key: keyof OrchestratorCvInitTraceCounters,
  delta = 1,
): number {
  if (!enabled()) return counters[key];
  counters[key] += delta;
  return counters[key];
}

export function readOrchestratorCvInitCounters(): OrchestratorCvInitTraceCounters {
  return { ...counters };
}

export function resetOrchestratorCvInitCountersForTests(): void {
  counters.renders = 0;
  counters.startSessionCalls = 0;
  counters.detectorLayoutMounts = 0;
  counters.detectorLayoutCleanups = 0;
  counters.cameraStartEffectRuns = 0;
  counters.rafLoopMounts = 0;
  counters.rafHudCommits = 0;
  counters.rafFramesSkippedForPause = 0;
  counters.poseSnapshotCommits = 0;
  counters.poseSnapshotLiveFrames = 0;
}
