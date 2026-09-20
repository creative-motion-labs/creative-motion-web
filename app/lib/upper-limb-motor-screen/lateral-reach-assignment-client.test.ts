/**
 * Run:
 *   npx tsx --test app/lib/upper-limb-motor-screen/lateral-reach-assignment-client.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  assertLateralReachPayloadMatchesAssignmentValidator,
  buildLateralReachDemoAssignmentPayload,
  createLateralReachAssignmentSubmitter,
  lateralReachCapturePatientRoute,
  LATERAL_REACH_BASELINE_TASK_ID,
  UPPER_LIMB_MOTOR_SCREEN_ASSESSMENT_HREF,
} from "./lateral-reach-assignment-client";

const PATIENT_ID = "22222222-2222-2222-2222-222222222222";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("lateral-reach-assignment-client", () => {
  it("builds a lateralReach assignment payload that passes validator", () => {
    const payload = buildLateralReachDemoAssignmentPayload(PATIENT_ID, "right");
    assert.equal(payload.taskAssignmentGroups[0].taskId, LATERAL_REACH_BASELINE_TASK_ID);
    assert.equal(payload.taskAssignmentGroups[0].testedSide, "right");
    assert.ok(assertLateralReachPayloadMatchesAssignmentValidator(payload));
  });

  it("exposes clinician routes for assessment center and capture", () => {
    assert.equal(
      UPPER_LIMB_MOTOR_SCREEN_ASSESSMENT_HREF,
      "/clinician/assessments/upper-limb-motor-screen",
    );
    assert.equal(
      lateralReachCapturePatientRoute(PATIENT_ID),
      `/clinician/patients/${PATIENT_ID}/upper-limb-motor-screen/capture`,
    );
  });

  it("wires assessment center card to entry route", () => {
    const assessmentCenter = readFileSync(
      join(ROOT, "app/clinician/assessments/page.tsx"),
      "utf8",
    );
    assert.match(assessmentCenter, /Upper Limb Motor Screen/);
    assert.match(assessmentCenter, /upper-limb-motor-screen/);
  });

  it("submits assignment to ULMS assignments API", async () => {
    const submitter = createLateralReachAssignmentSubmitter();
    let capturedBody: unknown;

    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          assignment: {
            id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            status: "assigned",
            assignedAt: "2026-09-03T00:00:00.000Z",
            assignedBy: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          },
        }),
        { status: 201 },
      );
    };

    const result = await submitter.submit(PATIENT_ID, "left", { fetchImpl });
    assert.ok(result.ok);
    assert.equal(
      (capturedBody as { taskAssignmentGroups: Array<{ taskId: string }> }).taskAssignmentGroups[0]
        .taskId,
      "lateralReach",
    );
  });
});
