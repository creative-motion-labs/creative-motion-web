"use client";

import { useEffect, useState } from "react";
import {
  formatSecondsOneDecimal,
  type DemoReachTargetPerformanceSnapshot,
} from "@/app/lib/rasq-demo/demo-reach-target-performance";

type RasqDemoReachTargetPerformanceHudProps = {
  snapshot: DemoReachTargetPerformanceSnapshot;
};

export function RasqDemoReachTargetPerformanceHud({ snapshot }: RasqDemoReachTargetPerformanceHudProps) {
  const [nowMs, setNowMs] = useState(() => performance.now());

  useEffect(() => {
    let frame = 0;
    const loop = () => {
      setNowMs(performance.now());
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  const activeElapsedSeconds =
    snapshot.activeTargetStartedAtMs !== null
      ? Math.max(0, (nowMs - snapshot.activeTargetStartedAtMs) / 1000)
      : null;

  const showCompletion =
    snapshot.lastCompletionDurationSeconds !== null &&
    nowMs <= snapshot.lastCompletionVisibleUntilMs;

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-30 max-w-[min(100%,16rem)] rounded-[8px] border border-[#C7E8DC] bg-[#0F172A]/85 px-3 py-2 text-[#F8FAFC] shadow-md backdrop-blur-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#5DCAA5]">
        Reach timing (demonstration)
      </p>
      {activeElapsedSeconds !== null ? (
        <p className="mt-1 text-sm font-medium">
          Target time: {formatSecondsOneDecimal(activeElapsedSeconds)}
        </p>
      ) : null}
      {showCompletion && snapshot.lastCompletionDurationSeconds !== null ? (
        <p className="mt-1 text-sm text-[#A7F3D0]">
          Completed in {formatSecondsOneDecimal(snapshot.lastCompletionDurationSeconds)}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-[#CBD5E1]">
        Targets: {snapshot.completedTargets}/{snapshot.targetsPresented}
      </p>
    </div>
  );
}
