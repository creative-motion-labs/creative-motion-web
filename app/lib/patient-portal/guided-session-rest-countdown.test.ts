/**
 * Run: npx tsx --test app/lib/patient-portal/guided-session-rest-countdown.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGuidedRestCountdownScopeKey,
  resolveGuidedRestCountdownOnScopeChange,
} from "./guided-session-rest-countdown";

describe("guided session rest countdown scope", () => {
  it("builds a scope key from rest phase and start seconds", () => {
    assert.equal(buildGuidedRestCountdownScopeKey("sess-1-0", 30), "sess-1-0:30");
  });

  it("resets seconds when restPhaseKey changes", () => {
    const next = resolveGuidedRestCountdownOnScopeChange({
      countdownScopeKey: "phase-b:45",
      countdownScopeKeyState: "phase-a:45",
      countdownStart: 45,
      secondsLeft: 12,
    });
    assert.equal(next.countdownScopeKeyState, "phase-b:45");
    assert.equal(next.secondsLeft, 45);
  });

  it("resets seconds when duration changes for the same phase key", () => {
    const next = resolveGuidedRestCountdownOnScopeChange({
      countdownScopeKey: "phase-a:60",
      countdownScopeKeyState: "phase-a:30",
      countdownStart: 60,
      secondsLeft: 5,
    });
    assert.equal(next.secondsLeft, 60);
  });

  it("keeps ticking state when scope is unchanged", () => {
    const next = resolveGuidedRestCountdownOnScopeChange({
      countdownScopeKey: "phase-a:30",
      countdownScopeKeyState: "phase-a:30",
      countdownStart: 30,
      secondsLeft: 17,
    });
    assert.equal(next.secondsLeft, 17);
  });

  it("uses zero start when countdown is disabled (scope encodes 0)", () => {
    const scope = buildGuidedRestCountdownScopeKey("phase-a", 0);
    assert.equal(scope, "phase-a:0");
    const next = resolveGuidedRestCountdownOnScopeChange({
      countdownScopeKey: scope,
      countdownScopeKeyState: "phase-a:30",
      countdownStart: 0,
      secondsLeft: 8,
    });
    assert.equal(next.secondsLeft, 0);
  });
});
