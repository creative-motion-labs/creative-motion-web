/**
 * Run:
 *   npx tsx --test app/lib/upper-limb-motor-screen/map-lateral-reach-attempt-to-session-result.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeScenario, buildHappyPathScenario } from "./lateral-reach-demo-fixtures";
import { buildLateralReachDemoConfig } from "./lateral-reach-demo-fixtures";
import {
  assertLateralReachSessionResultRequestValid,
  buildLateralReachSessionResultRequest,
} from "./map-lateral-reach-attempt-to-session-result";
import { validateUpperLimbMotorScreenSessionResultRequest } from "./session-result-request-validation";

const ASSIGNMENT_ID = "11111111-1111-1111-1111-111111111111";

describe("map-lateral-reach-attempt-to-session-result", () => {
  it("maps a terminal lateral reach attempt into a valid session-results request", () => {
    const config = buildLateralReachDemoConfig("right");
    const scenario = buildHappyPathScenario(config);
    const { attemptResult } = executeScenario(scenario, config);
    assert.ok(attemptResult);

    const request = buildLateralReachSessionResultRequest(ASSIGNMENT_ID, attemptResult);
    const validation = validateUpperLimbMotorScreenSessionResultRequest(request);
    assert.ok(validation.ok, validation.ok ? undefined : validation.detail);
    assert.ok(assertLateralReachSessionResultRequestValid(ASSIGNMENT_ID, attemptResult));
    assert.equal(request.taskCompletion[0].taskId, "lateralReach");
    assert.equal(request.attempts[0].reachTimeMs, attemptResult.reachTimeMs);
  });
});
