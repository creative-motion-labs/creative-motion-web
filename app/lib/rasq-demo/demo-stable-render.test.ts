/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-stable-render.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("RASQ /demo stable rendering", () => {
  it("stabilizes orchestrator demo session callbacks and countdown completion", () => {
    const orchestratorSession = readFileSync(
      join(process.cwd(), "app/components/rasq-demo/RasqDemoOrchestratorSession.tsx"),
      "utf8",
    );
    assert.match(orchestratorSession, /const handleCaptureReadinessChange = useCallback/);
    assert.match(orchestratorSession, /const handleSessionComplete = useCallback/);
    assert.match(orchestratorSession, /const handleTargetReachConfirmed = useCallback/);
    assert.match(orchestratorSession, /useMemo\([\s\S]*RasqDemoReachTargetPerformanceHud/);

    const countdown = readFileSync(
      join(process.cwd(), "app/components/patient/interactive-shoulder/ReadyCountdownOverlay.tsx"),
      "utf8",
    );
    assert.match(countdown, /onCompleteRef/);
    assert.match(countdown, /reducedMotionCompleteRef/);
    assert.doesNotMatch(countdown, /\[reducedMotion, showBegin, stepIndex, onComplete\]/);

    const core = readFileSync(
      join(process.cwd(), "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx"),
      "utf8",
    );
    assert.match(core, /shouldRunOrchestratorCvRafOrchestration/);
    assert.match(core, /countdownActiveRef/);
  });

  it("keeps demo experience phase transitions from remounting orchestrator unnecessarily", () => {
    const experience = readFileSync(
      join(process.cwd(), "app/components/rasq-demo/RasqDemoExperience.tsx"),
      "utf8",
    );
    assert.match(experience, /phase === "active"/);
    assert.match(experience, /const handleStart = useCallback/);
    assert.match(experience, /const handleSessionComplete = useCallback/);
  });
});
