/**
 * Elbow Extension demo fixture contract tests.
 *
 * These tests validate the DEMO CONTRACT — not engine implementation.
 * The engine has 101 comprehensive tests in elbow-extension-engine.test.ts.
 *
 * Fixture tests verify:
 * - Config validity for both sides
 * - Deterministic scenario execution
 * - Fresh state isolation between scenarios
 * - Factual result fields
 * - No raw trajectory exposure
 * - Critical demo behaviors: wrist-only completion, angle observation, protective pauses
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildElbowExtensionDemoConfig,
  buildAllElbowExtensionScenarios,
  executeScenario,
  type ScenarioKey,
} from "./elbow-extension-demo-fixtures";
import type { UpperLimbSide } from "./types";

// ── Config validity ────────────────────────────────────────────────────────

void describe("Elbow Extension demo config", () => {
  void it("builds valid config for right side", () => {
    const config = buildElbowExtensionDemoConfig("right");
    assert.equal(config.testedSide, "right");
    assert.ok(config.fixedTarget);
    assert.ok(config.startingZone);
    assert.ok(config.tracking);
    assert.ok(config.timing);
  });

  void it("builds valid config for left side", () => {
    const config = buildElbowExtensionDemoConfig("left");
    assert.equal(config.testedSide, "left");
    assert.ok(config.fixedTarget);
    assert.ok(config.startingZone);
    assert.ok(config.tracking);
    assert.ok(config.timing);
  });
});

// ── Deterministic execution ────────────────────────────────────────────────

void describe("Elbow Extension scenario execution", () => {
  void it("executes all scenarios deterministically for right side", () => {
    const scenarios = buildAllElbowExtensionScenarios("right");
    const config = buildElbowExtensionDemoConfig("right");

    const scenarioKeys: ScenarioKey[] = [
      "happyPathWithArmLandmarks",
      "happyPathWristOnly",
      "lowVisibility",
      "wrongDirectionExit",
      "shortTrackingGap",
      "longTrackingGapWithHumanResume",
      "stopBeforeCompletion",
    ];

    for (const key of scenarioKeys) {
      const scenario = scenarios[key];
      const result = executeScenario(scenario, config);
      assert.ok(result.ok, `Scenario ${key} failed: ${result.ok ? "" : result.reason}`);
    }
  });

  void it("executes all scenarios deterministically for left side", () => {
    const scenarios = buildAllElbowExtensionScenarios("left");
    const config = buildElbowExtensionDemoConfig("left");

    const scenarioKeys: ScenarioKey[] = [
      "happyPathWithArmLandmarks",
      "happyPathWristOnly",
      "lowVisibility",
      "wrongDirectionExit",
      "shortTrackingGap",
      "longTrackingGapWithHumanResume",
      "stopBeforeCompletion",
    ];

    for (const key of scenarioKeys) {
      const scenario = scenarios[key];
      const result = executeScenario(scenario, config);
      assert.ok(result.ok, `Scenario ${key} failed: ${result.ok ? "" : result.reason}`);
    }
  });

  void it("produces identical results when executed twice", () => {
    const config = buildElbowExtensionDemoConfig("right");
    const scenarios = buildAllElbowExtensionScenarios("right");
    const scenario = scenarios.happyPathWithArmLandmarks;

    const firstExecution = executeScenario(scenario, config);
    const secondExecution = executeScenario(scenario, config);

    assert.ok(firstExecution.ok);
    assert.ok(secondExecution.ok);
    assert.deepEqual(firstExecution.finalSnapshot, secondExecution.finalSnapshot);
  });
});

// ── Fresh state isolation ──────────────────────────────────────────────────

void describe("Fresh state isolation", () => {
  void it("each scenario execution starts with fresh state", () => {
    const config = buildElbowExtensionDemoConfig("right");
    const scenarios = buildAllElbowExtensionScenarios("right");

    const result1 = executeScenario(scenarios.happyPathWithArmLandmarks, config);
    const result2 = executeScenario(scenarios.lowVisibility, config);

    assert.ok(result1.ok);
    assert.ok(result2.ok);
    assert.notEqual(result1.finalSnapshot.phase, result2.finalSnapshot.phase);
  });
});

// ── Happy path with arm landmarks ──────────────────────────────────────────

void describe("Happy path with arm landmarks", () => {
  void it("completes successfully with observed 2D elbow angle", () => {
    const config = buildElbowExtensionDemoConfig("right");
    const scenarios = buildAllElbowExtensionScenarios("right");
    const result = executeScenario(scenarios.happyPathWithArmLandmarks, config);

    assert.ok(result.ok);
    assert.ok(result.result);
    assert.equal(result.result.completionState, "completed");
    assert.equal(result.result.targetReached, true);
    assert.equal(result.result.dwellConfirmed, true);
    assert.equal(result.result.returnToStartCompleted, true);
    assert.ok(result.result.peakElbowExtensionDeg !== null, "Expected elbow angle to be observed");
    assert.ok(result.result.factualNotes.includes("observed_2d_elbow_angle_data_available"));
  });
});

// ── Happy path wrist-only ──────────────────────────────────────────────────

void describe("Happy path wrist-only", () => {
  void it("completes successfully without elbow angle observation", () => {
    const config = buildElbowExtensionDemoConfig("right");
    const scenarios = buildAllElbowExtensionScenarios("right");
    const result = executeScenario(scenarios.happyPathWristOnly, config);

    assert.ok(result.ok);
    assert.ok(result.result);
    assert.equal(result.result.completionState, "completed");
    assert.equal(result.result.targetReached, true);
    assert.equal(result.result.dwellConfirmed, true);
    assert.equal(result.result.returnToStartCompleted, true);
    assert.equal(result.result.peakElbowExtensionDeg, null, "Expected no elbow angle observation");
    assert.ok(result.result.factualNotes.includes("observed_2d_elbow_angle_data_unavailable:required_landmarks_not_sufficiently_tracked"));
  });

  void it("proves angle observation does not gate completion", () => {
    const config = buildElbowExtensionDemoConfig("right");
    const scenarios = buildAllElbowExtensionScenarios("right");

    const withAngle = executeScenario(scenarios.happyPathWithArmLandmarks, config);
    const withoutAngle = executeScenario(scenarios.happyPathWristOnly, config);

    assert.ok(withAngle.ok);
    assert.ok(withoutAngle.ok);
    assert.ok(withAngle.result);
    assert.ok(withoutAngle.result);

    assert.equal(withAngle.result.completionState, "completed");
    assert.equal(withoutAngle.result.completionState, "completed");
    assert.ok(withAngle.result.peakElbowExtensionDeg !== null);
    assert.equal(withoutAngle.result.peakElbowExtensionDeg, null);
  });
});

// ── Low visibility ─────────────────────────────────────────────────────────

void describe("Low visibility", () => {
  void it("does not advance with insufficient wrist visibility", () => {
    const config = buildElbowExtensionDemoConfig("right");
    const scenarios = buildAllElbowExtensionScenarios("right");
    const result = executeScenario(scenarios.lowVisibility, config);

    assert.ok(result.ok);
    assert.ok(result.result);
    assert.equal(result.result.completionState, "not_started");
    assert.equal(result.result.targetReached, false);
  });
});

// ── Wrong direction exit ───────────────────────────────────────────────────

void describe("Wrong direction exit", () => {
  void it("re-arms readiness after non-target-facing exit", () => {
    const config = buildElbowExtensionDemoConfig("right");
    const scenarios = buildAllElbowExtensionScenarios("right");
    const result = executeScenario(scenarios.wrongDirectionExit, config);

    assert.ok(result.ok);
    assert.ok(result.result);
    assert.equal(result.result.completionState, "not_started");
    assert.ok(result.result.factualNotes.includes("non_target_facing_exit_observed_before_valid_onset"));
  });
});

// ── Short tracking gap ─────────────────────────────────────────────────────

void describe("Short tracking gap", () => {
  void it("does not trigger protective pause for brief gap", () => {
    const config = buildElbowExtensionDemoConfig("right");
    const scenarios = buildAllElbowExtensionScenarios("right");
    const result = executeScenario(scenarios.shortTrackingGap, config);

    assert.ok(result.ok);
    assert.ok(result.result);
    assert.equal(result.result.protectivePauseCount, 0);
  });
});

// ── Long tracking gap with human resume ────────────────────────────────────

void describe("Long tracking gap with human resume", () => {
  void it("opens protective pause and requires explicit resume", () => {
    const config = buildElbowExtensionDemoConfig("right");
    const scenarios = buildAllElbowExtensionScenarios("right");
    const result = executeScenario(scenarios.longTrackingGapWithHumanResume, config);

    assert.ok(result.ok);
    assert.ok(result.result);
    assert.equal(result.result.protectivePauseCount, 1);
    assert.ok(result.result.protectivePauseEvents.length > 0);
    assert.equal(result.result.protectivePauseEvents[0].outcome, "resumed");
  });

  void it("clears active pause after explicit resume", () => {
    const config = buildElbowExtensionDemoConfig("right");
    const scenarios = buildAllElbowExtensionScenarios("right");
    const result = executeScenario(scenarios.longTrackingGapWithHumanResume, config);

    assert.ok(result.ok);
    assert.equal(result.finalSnapshot.hasActivePause, false);
  });
});

// ── Stop before completion ─────────────────────────────────────────────────

void describe("Stop before completion", () => {
  void it("terminates with stopped completion state", () => {
    const config = buildElbowExtensionDemoConfig("right");
    const scenarios = buildAllElbowExtensionScenarios("right");
    const result = executeScenario(scenarios.stopBeforeCompletion, config);

    assert.ok(result.ok);
    assert.ok(result.result);
    assert.equal(result.result.completionState, "stopped");
    assert.equal(result.finalSnapshot.terminal, true);
  });
});

// ── Result field validation ────────────────────────────────────────────────

void describe("Result field validation", () => {
  void it("never exposes raw trajectory samples", () => {
    const config = buildElbowExtensionDemoConfig("right");
    const scenarios = buildAllElbowExtensionScenarios("right");

    for (const scenario of Object.values(scenarios)) {
      const result = executeScenario(scenario, config);
      if (result.ok && result.result) {
        const resultJson = JSON.stringify(result.result);
        assert.ok(!resultJson.includes("outboundSamples"), `Scenario ${scenario.name} exposed outboundSamples`);
        assert.ok(!resultJson.includes("pendingOnsetSamples"), `Scenario ${scenario.name} exposed pendingOnsetSamples`);
      }
    }
  });

  void it("time metrics are non-negative when present", () => {
    const config = buildElbowExtensionDemoConfig("right");
    const scenarios = buildAllElbowExtensionScenarios("right");
    const scenario = scenarios.happyPathWithArmLandmarks;
    const result = executeScenario(scenario, config);

    assert.ok(result.ok);
    assert.ok(result.result);

    if (result.result.reachTimeMs !== null) {
      assert.ok(result.result.reachTimeMs >= 0);
    }
    if (result.result.returnTimeMs !== null) {
      assert.ok(result.result.returnTimeMs >= 0);
    }
    if (result.result.totalMovementTimeMs !== null) {
      assert.ok(result.result.totalMovementTimeMs >= 0);
    }
  });

  void it("path efficiency is within [0, 1] when present", () => {
    const config = buildElbowExtensionDemoConfig("right");
    const scenarios = buildAllElbowExtensionScenarios("right");
    const scenario = scenarios.happyPathWithArmLandmarks;
    const result = executeScenario(scenario, config);

    assert.ok(result.ok);
    assert.ok(result.result);

    if (result.result.pathEfficiency !== null) {
      assert.ok(result.result.pathEfficiency >= 0);
      assert.ok(result.result.pathEfficiency <= 1);
    }
  });

  void it("factual notes never contain forbidden clinical claims", () => {
    const config = buildElbowExtensionDemoConfig("right");
    const scenarios = buildAllElbowExtensionScenarios("right");

    const forbiddenTerms = [
      "impairment",
      "compensation",
      "abnormal",
      "deficit",
      "neglect",
      "diagnosis",
      "severity",
    ];

    for (const scenario of Object.values(scenarios)) {
      const result = executeScenario(scenario, config);
      if (result.ok && result.result) {
        const notesString = result.result.factualNotes.join(" ").toLowerCase();
        for (const term of forbiddenTerms) {
          assert.ok(!notesString.includes(term), `Scenario ${scenario.name} contains forbidden term "${term}"`);
        }
      }
    }
  });
});

// ── Scenario-specific assertions ───────────────────────────────────────────

void describe("Scenario-specific behavior", () => {
  const testBothSides = (scenarioKey: ScenarioKey, assertions: (side: UpperLimbSide) => void) => {
    const sides: UpperLimbSide[] = ["left", "right"];
    for (const side of sides) {
      void it(`${scenarioKey} behaves correctly for ${side} side`, () => {
        assertions(side);
      });
    }
  };

  testBothSides("happyPathWithArmLandmarks", (side) => {
    const config = buildElbowExtensionDemoConfig(side);
    const scenarios = buildAllElbowExtensionScenarios(side);
    const result = executeScenario(scenarios.happyPathWithArmLandmarks, config);

    assert.ok(result.ok);
    assert.ok(result.result);
    assert.equal(result.result.testedSide, side);
    assert.equal(result.result.taskId, "elbowExtension");
  });

  testBothSides("happyPathWristOnly", (side) => {
    const config = buildElbowExtensionDemoConfig(side);
    const scenarios = buildAllElbowExtensionScenarios(side);
    const result = executeScenario(scenarios.happyPathWristOnly, config);

    assert.ok(result.ok);
    assert.ok(result.result);
    assert.equal(result.result.testedSide, side);
    assert.equal(result.result.peakElbowExtensionDeg, null);
  });
});
