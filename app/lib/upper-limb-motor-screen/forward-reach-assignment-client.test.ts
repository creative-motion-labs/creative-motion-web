/**
 * Run:
 *   npx tsx --test app/lib/upper-limb-motor-screen/forward-reach-assignment-client.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  FORWARD_REACH_ASSIGNMENT_REQUEST_TOP_LEVEL_KEYS,
  FORWARD_REACH_ASSIGNMENT_USER_MESSAGES,
  assertForwardReachPayloadMatchesAssignmentValidator,
  buildForwardReachAssignmentCreatePayload,
  createEmptyForwardReachAssignmentForm,
  createForwardReachAssignmentSubmitter,
  forwardReachAssignmentPatientRoute,
  mapForwardReachAssignmentHttpError,
  validateForwardReachAssignmentForm,
  type ForwardReachAssignmentFormState,
} from "./forward-reach-assignment-client";

const PATIENT_ID = "22222222-2222-2222-2222-222222222222";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function validForm(overrides: Partial<ForwardReachAssignmentFormState> = {}): ForwardReachAssignmentFormState {
  return {
    ...createEmptyForwardReachAssignmentForm(),
    affectedSide: "right",
    testedSide: "right",
    startingSittingPosition: "chair_with_armrests",
    backTrunkSupport: "full_back_support",
    affectedArmSupport: "armrest",
    baselinePainScore: "2",
    permittedMovementRangeKind: "not_applicable",
    permittedMovementRangeDescription: "",
    caregiverSupervisionRequirement: "not_required",
    deliveryMode: "in_clinic",
    patientSpecificStopCriteria: "",
    eligible: true,
    attempts: "5",
    restPeriodSeconds: "30",
    targetDirection: "forward",
    targetHeight: "shoulder height",
    targetDistance: "arm's length",
    ...overrides,
  };
}

describe("Forward Reach assignment client", () => {
  it("1. exposes a patient-scoped clinician route for the assignment flow", () => {
    assert.equal(
      forwardReachAssignmentPatientRoute(PATIENT_ID),
      `/clinician/patients/${PATIENT_ID}/upper-limb-motor-screen/assign`,
    );
    const pageSource = readFileSync(
      join(ROOT, "app/clinician/patients/[id]/upper-limb-motor-screen/assign/page.tsx"),
      "utf8",
    );
    assert.match(pageSource, /ForwardReachAssignmentClient/);
    assert.match(pageSource, /key=\{patient\.id\}/);
    const profileSource = readFileSync(join(ROOT, "app/clinician/patients/[id]/page.tsx"), "utf8");
    assert.equal(profileSource.includes("Forward Reach assignment"), false);
    assert.equal(profileSource.includes("Assign Forward Reach Baseline"), false);
  });

  it("2. builds the exact allowlisted API payload expected by the assignment validator", () => {
    const payload = buildForwardReachAssignmentCreatePayload(PATIENT_ID, validForm());
    assert.ok(payload);
    const baseKeys = [...FORWARD_REACH_ASSIGNMENT_REQUEST_TOP_LEVEL_KEYS].filter(
      (key) => key !== "assignmentRequestId",
    );
    assert.deepEqual(Object.keys(payload).sort(), baseKeys.sort());
    assert.equal(payload.screenDefinitionId, "upper-limb-motor-screen-v1");
    assert.equal(payload.taskAssignmentGroups.length, 1);
    assert.equal(payload.taskAssignmentGroups[0]?.taskId, "forwardReach");
    assert.equal(payload.taskAssignmentGroups[0]?.testedSide, "right");
    assert.equal(assertForwardReachPayloadMatchesAssignmentValidator(payload), true);
  });

  it("3. does not silently default affected or tested side", () => {
    const empty = createEmptyForwardReachAssignmentForm();
    assert.equal(empty.affectedSide, "");
    assert.equal(empty.testedSide, "");
    const validation = validateForwardReachAssignmentForm(empty);
    assert.equal(validation.ok, false);
    if (validation.ok) return;
    assert.ok(validation.errors.some((e) => e.field === "affectedSide"));
    assert.ok(validation.errors.some((e) => e.field === "testedSide"));
    assert.equal(buildForwardReachAssignmentCreatePayload(PATIENT_ID, empty), null);
  });

  it("4. blocks submission when required fields are missing or invalid", () => {
    const result = validateForwardReachAssignmentForm(
      validForm({ attempts: "0", baselinePainScore: "11" }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((e) => e.field === "attempts"));
    assert.ok(result.errors.some((e) => e.field === "baselinePainScore"));
  });

  it("5. prevents rapid double-submit from producing two requests", async () => {
    let fetchCount = 0;
    const submitter = createForwardReachAssignmentSubmitter();
    const fetchImpl: typeof fetch = async () => {
      fetchCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return new Response(
        JSON.stringify({
          assignment: {
            id: "33333333-3333-3333-3333-333333333333",
            status: "assigned",
            assignedAt: "2026-08-26T10:00:00.000Z",
            assignedBy: "11111111-1111-1111-1111-111111111111",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    };

    const first = submitter.submit(PATIENT_ID, validForm(), { fetchImpl });
    const second = await submitter.submit(PATIENT_ID, validForm(), { fetchImpl });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.duplicateSubmit, true);
    await first;
    assert.equal(fetchCount, 1);
  });

  it("6. handles a successful 201 response with server-owned assignment fields", async () => {
    const submitter = createForwardReachAssignmentSubmitter();
    const result = await submitter.submit(PATIENT_ID, validForm(), {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            assignment: {
              id: "33333333-3333-3333-3333-333333333333",
              status: "assigned",
              assignedAt: "2026-08-26T10:00:00.000Z",
              assignedBy: "11111111-1111-1111-1111-111111111111",
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.assignment.status, "assigned");
    assert.equal(result.assignment.id, "33333333-3333-3333-3333-333333333333");
  });

  it("7. maps controlled error messages for HTTP and network failures", () => {
    assert.equal(mapForwardReachAssignmentHttpError(400), FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.badRequest);
    assert.equal(mapForwardReachAssignmentHttpError(401), FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.unauthorized);
    assert.equal(mapForwardReachAssignmentHttpError(404), FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.notFound);
    assert.equal(mapForwardReachAssignmentHttpError(409), FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.conflict);
    assert.equal(mapForwardReachAssignmentHttpError(429), FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.rateLimited);
    assert.equal(mapForwardReachAssignmentHttpError(500), FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.unexpected);
  });

  it("7b. returns controlled messages for HTTP status codes during submit", async () => {
    const submitter = createForwardReachAssignmentSubmitter();
    for (const [status, expected] of [
      [400, FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.badRequest],
      [401, FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.unauthorized],
      [404, FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.notFound],
      [409, FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.conflict],
      [429, FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.rateLimited],
    ] as const) {
      const result = await submitter.submit(PATIENT_ID, validForm(), {
        fetchImpl: async () => new Response(JSON.stringify({ error: "hidden" }), { status }),
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.message, expected);
      assert.equal(result.status, status);
    }

    const network = await submitter.submit(PATIENT_ID, validForm(), {
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(network.ok, false);
    if (network.ok) return;
    assert.equal(network.message, FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.network);
  });

  it("8. never sends providerId, assignedBy, status, diagnosis, tokens, or unknown fields", async () => {
    const payload = buildForwardReachAssignmentCreatePayload(PATIENT_ID, validForm());
    assert.ok(payload);
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes("providerId"), false);
    assert.equal(serialized.includes("assignedBy"), false);
    assert.equal(serialized.includes('"status"'), false);
    assert.equal(serialized.includes("diagnosis"), false);
    assert.equal(serialized.includes("token"), false);
    assert.equal(serialized.includes("patientName"), false);

    let postedBody: Record<string, unknown> | null = null;
    const submitter = createForwardReachAssignmentSubmitter();
    await submitter.submit(PATIENT_ID, validForm(), {
      fetchImpl: async (_url, init) => {
        postedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            assignment: {
              id: "33333333-3333-3333-3333-333333333333",
              status: "assigned",
              assignedAt: "2026-08-26T10:00:00.000Z",
              assignedBy: "11111111-1111-1111-1111-111111111111",
            },
          }),
          { status: 201 },
        );
      },
    });
    assert.ok(postedBody);
    assert.deepEqual(Object.keys(postedBody).sort(), [...FORWARD_REACH_ASSIGNMENT_REQUEST_TOP_LEVEL_KEYS].sort());
    assert.equal(typeof postedBody.assignmentRequestId, "string");
  });

  it("1. lost-success retry reuses assignmentRequestId on the wire", async () => {
    const bodies: string[] = [];
    const submitter = createForwardReachAssignmentSubmitter();
    const fetchImpl: typeof fetch = async (_url, init) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) {
        return new Response(null, { status: 500 });
      }
      return new Response(
        JSON.stringify({
          assignment: {
            id: "33333333-3333-3333-3333-333333333333",
            status: "assigned",
            assignedAt: "2026-08-26T10:00:00.000Z",
            assignedBy: "11111111-1111-1111-1111-111111111111",
          },
        }),
        { status: 201 },
      );
    };

    const first = await submitter.submit(PATIENT_ID, validForm(), { fetchImpl });
    assert.equal(first.ok, false);
    const second = await submitter.submit(PATIENT_ID, validForm(), { fetchImpl });
    assert.equal(second.ok, true);
    assert.equal(bodies.length, 2);
    const firstBody = JSON.parse(bodies[0] ?? "{}") as { assignmentRequestId?: string };
    const secondBody = JSON.parse(bodies[1] ?? "{}") as { assignmentRequestId?: string };
    assert.equal(firstBody.assignmentRequestId, secondBody.assignmentRequestId);
  });

  it("12. malformed 200/201 responses fail safely and retain retry key", async () => {
    const submitter = createForwardReachAssignmentSubmitter();
    const bad = await submitter.submit(PATIENT_ID, validForm(), {
      fetchImpl: async () => new Response(JSON.stringify({ assignment: { id: "x" } }), { status: 201 }),
    });
    assert.equal(bad.ok, false);
    if (bad.ok) return;
    assert.equal(bad.message, FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.unexpected);

    let postedBodies = 0;
    const retry = await submitter.submit(PATIENT_ID, validForm(), {
      fetchImpl: async () => {
        postedBodies += 1;
        return new Response(
          JSON.stringify({
            assignment: {
              id: "33333333-3333-3333-3333-333333333333",
              status: "assigned",
              assignedAt: "2026-08-26T10:00:00.000Z",
              assignedBy: "11111111-1111-1111-1111-111111111111",
            },
          }),
          { status: 201 },
        );
      },
    });
    assert.equal(retry.ok, true);
    assert.equal(postedBodies, 1);
  });

  it("9. does not reference volunteer, camera runtime, or Issue #273 touch surfaces", () => {
    const files = [
      "app/lib/upper-limb-motor-screen/forward-reach-assignment-client.ts",
      "app/clinician/patients/[id]/upper-limb-motor-screen/assign/ForwardReachAssignmentClient.tsx",
      "app/clinician/patients/[id]/upper-limb-motor-screen/assign/page.tsx",
    ];
    const forbidden = [
      "OrchestratorCvSessionCore",
      "resolveOrchestratorTherapeuticSide",
      "MediaPipe",
      "volunteer/shoulder-abduction-reach",
      "interactive-shoulder",
      "prescribed-side",
    ];
    for (const relativePath of files) {
      const source = readFileSync(join(ROOT, relativePath), "utf8");
      for (const needle of forbidden) {
        assert.equal(source.includes(needle), false, `${relativePath} must not reference ${needle}`);
      }
    }
  });
});
