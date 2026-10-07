/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-session-rep-and-completion.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  getBatteryFinalTestSavingStatus,
  getTestProgressLabel,
} from "./battery-patient-copy";
import {
  createBatteryOrchestratorState,
  getActiveBatteryTestRequiredReps,
  recordBatteryRepCompleted,
  startBatteryAssessment,
} from "./battery-orchestrator";
import { getBatteryTestDefinition } from "./types";

const SESSION = join(process.cwd(), "app/components/patient/RemoteUpperLimbBatterySession.tsx");
const PAGE = join(process.cwd(), "app/patient/assessment/[token]/page.tsx");

describe("battery repetition counter and final-test completion", () => {
  it("progress label advances 0/3 through 3/3 from orchestrator repsCompleted", () => {
    const required = 3;
    assert.match(getTestProgressLabel(0, "shoulderAbduction", 0, required, "right", "en"), /Repetition 0 of 3/);
    assert.match(getTestProgressLabel(0, "shoulderAbduction", 1, required, "right", "en"), /Repetition 1 of 3/);
    assert.match(getTestProgressLabel(0, "shoulderAbduction", 2, required, "right", "en"), /Repetition 2 of 3/);
    assert.match(getTestProgressLabel(0, "shoulderAbduction", 3, required, "right", "en"), /Repetition 3 of 3/);
  });

  it("orchestrator increments reps only on recordBatteryRepCompleted events", () => {
    let state = startBatteryAssessment(createBatteryOrchestratorState());
    state = { ...state, phase: "test_active" };
    state = recordBatteryRepCompleted(state, 70);
    assert.equal(state.repsCompleted, 1);
    state = { ...state, phase: "test_active" };
    state = recordBatteryRepCompleted(state, 72);
    assert.equal(state.repsCompleted, 2);
    state = { ...state, phase: "test_active" };
    state = recordBatteryRepCompleted(state, 74);
    assert.equal(state.repsCompleted, 3);
    assert.equal(state.phase, "test_completed");
  });

  it("functional reach requires three repetitions before test completion", () => {
    assert.equal(getBatteryTestDefinition("functionalReach").requiredReps, 3);
    let state = startBatteryAssessment(createBatteryOrchestratorState());
    state = { ...state, testIndex: 3, phase: "test_active" };
    assert.equal(getActiveBatteryTestRequiredReps(state), 3);
    state = recordBatteryRepCompleted(state, 0.1);
    assert.equal(state.phase, "test_active");
    state = { ...state, phase: "test_active" };
    state = recordBatteryRepCompleted(state, 0.11);
    assert.equal(state.phase, "test_active");
    state = { ...state, phase: "test_active" };
    state = recordBatteryRepCompleted(state, 0.12);
    assert.equal(state.phase, "test_completed");
  });

  it("does not complete functional reach after fewer than three recorded reps", () => {
    let state = startBatteryAssessment(createBatteryOrchestratorState());
    state = { ...state, testIndex: 3, phase: "test_active" };
    state = recordBatteryRepCompleted(state, 0.1);
    state = { ...state, phase: "test_active" };
    state = recordBatteryRepCompleted(state, 0.11);
    assert.notEqual(state.phase, "test_completed");
    assert.notEqual(state.phase, "assessment_completed");
  });

  it("shows final test saving copy in EN and AR after repetition 3", () => {
    assert.equal(
      getBatteryFinalTestSavingStatus("en"),
      "Test complete. Please wait while we save your results.",
    );
    assert.match(getBatteryFinalTestSavingStatus("ar"), /نتائجك/);
    const source = readFileSync(SESSION, "utf8");
    assert.match(source, /getBatteryFinalTestSavingStatus/);
    assert.match(source, /finalTestSavingActive/);
    assert.match(source, /orchestrator\.testIndex === 3/);
  });

  it("session records reps from movementTrackingEnabled processor snapshots only", () => {
    const source = readFileSync(SESSION, "utf8");
    assert.match(source, /processor\.repCount > lastProcessorRepRef\.current/);
    assert.match(source, /recordBatteryRepCompleted\(current, processor\.lastRepPeak\)/);
    assert.match(source, /processor\?\.movementTrackingEnabled/);
    assert.equal(source.includes('movementPhase === "preview"'), false);
  });

  it("speaks final test saving booth cue once after functional reach rep three", () => {
    const source = readFileSync(SESSION, "utf8");
    assert.match(source, /resolveBatteryRepCountSpeechCue\(completed, requiredReps, activeTestId\)/);
    assert.match(source, /finalTestSavingCueSpokenRef/);
    assert.match(source, /functionalReach-final-saving/);
    assert.match(source, /cue === "test-completed"/);
    assert.match(source, /cancelBatterySpeech\(\)/);
    assert.match(source, /!finalTestSavingCueSpokenRef\.current/);
  });

  it("exactly-once submission guard remains in session and assessment page", () => {
    const session = readFileSync(SESSION, "utf8");
    const page = readFileSync(PAGE, "utf8");
    assert.match(session, /orchestrator\.submitAttempted/);
    assert.match(session, /markBatterySubmitting/);
    assert.match(page, /submitStartedRef/);
    assert.match(page, /if \(submitStartedRef\.current\) return/);
  });
});
