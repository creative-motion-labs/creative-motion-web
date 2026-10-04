import type { TargetAttemptStartEvent, TargetHitEvent } from "@/app/lib/interactive-shoulder/types";
import { DEMO_POSE_TRACKING_MIN_FRAMES, type DemoPoseSampleSnapshot } from "./demo-pose-metrics";

export type DemoReachTargetTimingRecord = {
  targetId: string;
  sequence: number;
  targetStartedAtMs: number;
  targetCompletedAtMs: number | null;
  targetDurationSeconds: number | null;
};

export type DemoReachTargetPerformanceSnapshot = {
  targetsPresented: number;
  completedTargets: number;
  activeTargetId: string | null;
  activeTargetStartedAtMs: number | null;
  lastCompletionDurationSeconds: number | null;
  lastCompletionVisibleUntilMs: number;
  records: readonly DemoReachTargetTimingRecord[];
};

export type DemoReachTargetAggregateMetrics = {
  completedTargets: number;
  targetsPresented: number;
  averageTargetDurationSeconds: number | null;
  targetsPerMinute: number | null;
  targetCompletionRate: number | null;
  reachBlockDurationSeconds: number | null;
};

export function createDemoReachTargetPerformanceSnapshot(): DemoReachTargetPerformanceSnapshot {
  return {
    targetsPresented: 0,
    completedTargets: 0,
    activeTargetId: null,
    activeTargetStartedAtMs: null,
    lastCompletionDurationSeconds: null,
    lastCompletionVisibleUntilMs: 0,
    records: [],
  };
}

const COMPLETION_MESSAGE_MS = 2_800;

export function registerDemoReachTargetStarted(
  snapshot: DemoReachTargetPerformanceSnapshot,
  event: TargetAttemptStartEvent,
): DemoReachTargetPerformanceSnapshot {
  if (snapshot.records.some((record) => record.targetId === event.targetId)) {
    return snapshot;
  }
  const record: DemoReachTargetTimingRecord = {
    targetId: event.targetId,
    sequence: event.sequence,
    targetStartedAtMs: event.startedAtMs,
    targetCompletedAtMs: null,
    targetDurationSeconds: null,
  };
  return {
    ...snapshot,
    targetsPresented: snapshot.targetsPresented + 1,
    activeTargetId: event.targetId,
    activeTargetStartedAtMs: event.startedAtMs,
    records: [...snapshot.records, record],
  };
}

export function registerDemoReachTargetCompleted(
  snapshot: DemoReachTargetPerformanceSnapshot,
  hit: TargetHitEvent,
  nowMs: number,
): DemoReachTargetPerformanceSnapshot {
  const existing = snapshot.records.find((record) => record.targetId === hit.targetId);
  if (existing?.targetCompletedAtMs !== null && existing?.targetCompletedAtMs !== undefined) {
    return snapshot;
  }

  const records = snapshot.records.map((record) => {
    if (record.targetId !== hit.targetId || record.targetCompletedAtMs !== null) {
      return record;
    }
    const durationSeconds = Math.max(0, (hit.capturedAtMs - record.targetStartedAtMs) / 1000);
    return {
      ...record,
      targetCompletedAtMs: hit.capturedAtMs,
      targetDurationSeconds: durationSeconds,
    };
  });

  const completed = records.filter((r) => r.targetCompletedAtMs !== null);
  const lastRecord = records.find((r) => r.targetId === hit.targetId);

  return {
    ...snapshot,
    records,
    completedTargets: completed.length,
    activeTargetId: null,
    activeTargetStartedAtMs: null,
    lastCompletionDurationSeconds: lastRecord?.targetDurationSeconds ?? null,
    lastCompletionVisibleUntilMs: nowMs + COMPLETION_MESSAGE_MS,
  };
}

export function computeDemoReachTargetAggregateMetrics(input: {
  records: readonly DemoReachTargetTimingRecord[];
  reachBlockStartedAtMs: number | null;
  reachBlockEndedAtMs: number | null;
}): DemoReachTargetAggregateMetrics {
  const completed = input.records.filter(
    (r) => r.targetCompletedAtMs !== null && r.targetDurationSeconds !== null,
  );
  const targetsPresented = input.records.length;
  const completedTargets = completed.length;

  const durations = completed
    .map((r) => r.targetDurationSeconds)
    .filter((v): v is number => v !== null && Number.isFinite(v));

  const averageTargetDurationSeconds =
    durations.length > 0
      ? durations.reduce((sum, value) => sum + value, 0) / durations.length
      : null;

  let reachBlockDurationSeconds: number | null = null;
  if (
    input.reachBlockStartedAtMs !== null &&
    input.reachBlockEndedAtMs !== null &&
    input.reachBlockEndedAtMs >= input.reachBlockStartedAtMs
  ) {
    reachBlockDurationSeconds = (input.reachBlockEndedAtMs - input.reachBlockStartedAtMs) / 1000;
  }

  let targetsPerMinute: number | null = null;
  if (
    reachBlockDurationSeconds !== null &&
    reachBlockDurationSeconds > 0 &&
    completedTargets > 0
  ) {
    targetsPerMinute = completedTargets / (reachBlockDurationSeconds / 60);
  }

  let targetCompletionRate: number | null = null;
  if (targetsPresented > 0) {
    targetCompletionRate = completedTargets / targetsPresented;
  }

  return {
    completedTargets,
    targetsPresented,
    averageTargetDurationSeconds,
    targetsPerMinute,
    targetCompletionRate,
    reachBlockDurationSeconds,
  };
}

export function hasDemoReachTrackingEvidence(poseSample: DemoPoseSampleSnapshot): boolean {
  return poseSample.framesTotal >= DEMO_POSE_TRACKING_MIN_FRAMES;
}

export function formatSecondsOneDecimal(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}
