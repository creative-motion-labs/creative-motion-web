/**
 * Run: npx tsx --test app/volunteer/shoulder-abduction-reach/volunteer-research-persistence-controller.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
  type ShoulderAbductionReachRepCaptureRecord,
} from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";
import { VOLUNTEER_SESSION_TOKEN_HEADER } from "@/app/lib/research/volunteer-constants";
import { buildVolunteerRepetitionFixture } from "@/app/lib/research/volunteer-repetition-validation";
import { VOLUNTEER_PERSISTENCE_API_ROUTES } from "./volunteer-browser-persistence-client";
import { createVolunteerPersistenceController } from "./volunteer-research-persistence-controller";

type RecordedCall = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

function buildCaptureRecord(index: number): ShoulderAbductionReachRepCaptureRecord {
  return {
    context: {
      captureSchemaVersion: ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
      featureSchemaVersion: ML_RESEARCH_FEATURE_SCHEMA_VERSION,
      participantId: "local",
      devSessionId: "local",
      repetitionIndex: index,
      repetitionId: `rid-${index}`,
      side: "right",
      movementType: "shoulder_abduction_reach",
      startedAtMs: index * 1000,
      endedAtMs: index * 1000 + 500,
      simulationCondition: "NORMAL",
    },
    frames: buildVolunteerRepetitionFixture({ repetitionIndex: index }).frames,
    derivedFeatures: buildVolunteerRepetitionFixture({ repetitionIndex: index }).derivedFeatures,
  };
}

function createMockFetch(
  handlers: Record<string, (call: RecordedCall, state: { calls: RecordedCall[] }) => Response | Promise<Response>>,
) {
  const calls: RecordedCall[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const raw = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(raw)) headers[k.toLowerCase()] = v;
    }
    const call: RecordedCall = {
      method: init?.method ?? "GET",
      url,
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    const handler = handlers[url];
    if (!handler) {
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    }
    return handler(call, { calls });
  };
  return { fetchImpl, calls };
}

describe("volunteer-research-persistence-controller", () => {
  it("runs happy-path request order: session → movement → reps → complete", async () => {
    const movementSessionId = crypto.randomUUID();
    const { fetchImpl, calls } = createMockFetch({
      [VOLUNTEER_PERSISTENCE_API_ROUTES.sessions]: () =>
        new Response(
          JSON.stringify({
            sessionToken: "session-token-value-1234567890",
            expiresAt: "2026-08-25T12:00:00.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.movementSessions]: () =>
        new Response(
          JSON.stringify({ movementSessionId, blockIndex: 1 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.repetitions]: () =>
        new Response(
          JSON.stringify({ repetitionId: crypto.randomUUID(), created: true }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.complete]: () =>
        new Response(
          JSON.stringify({ ok: true, deletionCode: "ABCD-EFGH-IJKL-MNOP" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });

    const controller = createVolunteerPersistenceController({ fetchImpl });

    assert.equal(await controller.createCollectionSession("PILOT"), true);
    assert.equal(await controller.createMovementSession("NORMAL"), true);

    for (let i = 1; i <= 3; i += 1) {
      controller.enqueueRep(buildCaptureRecord(i));
      await new Promise((r) => setTimeout(r, 0));
    }
    controller.notifyCaptureTargetReached();
    await new Promise((r) => setTimeout(r, 10));

    const state = controller.getState();
    assert.equal(state.isCompleted, true);
    assert.equal(state.deletionCode, "ABCD-EFGH-IJKL-MNOP");

    const urls = calls.map((c) => `${c.method} ${c.url}`);
    assert.deepEqual(
      urls.slice(0, 6),
      [
        `POST ${VOLUNTEER_PERSISTENCE_API_ROUTES.sessions}`,
        `POST ${VOLUNTEER_PERSISTENCE_API_ROUTES.movementSessions}`,
        `POST ${VOLUNTEER_PERSISTENCE_API_ROUTES.repetitions}`,
        `POST ${VOLUNTEER_PERSISTENCE_API_ROUTES.repetitions}`,
        `POST ${VOLUNTEER_PERSISTENCE_API_ROUTES.repetitions}`,
        `PATCH ${VOLUNTEER_PERSISTENCE_API_ROUTES.complete}`,
      ],
    );
  });

  it("keeps campaign code only in session create and token only in headers", async () => {
    const { fetchImpl, calls } = createMockFetch({
      [VOLUNTEER_PERSISTENCE_API_ROUTES.sessions]: () =>
        new Response(
          JSON.stringify({ sessionToken: "tok-abc", expiresAt: "2026-08-25T12:00:00.000Z" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.movementSessions]: () =>
        new Response(
          JSON.stringify({ movementSessionId: crypto.randomUUID(), blockIndex: 1 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });

    const controller = createVolunteerPersistenceController({ fetchImpl });
    await controller.createCollectionSession("MY-CODE");
    await controller.createMovementSession("NORMAL");

    const sessionBody = calls[0]!.body as Record<string, unknown>;
    assert.equal(sessionBody.campaignCode, "MY-CODE");
    assert.equal(sessionBody.sessionToken, undefined);

    const movementHeaders = calls[1]!.headers;
    assert.equal(movementHeaders[VOLUNTEER_SESSION_TOKEN_HEADER.toLowerCase()], "tok-abc");
    const movementBody = calls[1]!.body as Record<string, unknown>;
    assert.equal(movementBody.sessionToken, undefined);
    assert.equal(movementBody.campaignCode, undefined);
  });

  it("reuses stable clientSubmissionId across retry after uncertain response", async () => {
    const submittedIds: string[] = [];
    const movementSessionId = crypto.randomUUID();
    const { fetchImpl } = createMockFetch({
      [VOLUNTEER_PERSISTENCE_API_ROUTES.sessions]: () =>
        new Response(
          JSON.stringify({ sessionToken: "tok", expiresAt: "2026-08-25T12:00:00.000Z" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.movementSessions]: () =>
        new Response(
          JSON.stringify({ movementSessionId, blockIndex: 1 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.repetitions]: (call) => {
        const body = call.body as { clientSubmissionId: string };
        submittedIds.push(body.clientSubmissionId);
        if (submittedIds.length === 1) throw new Error("network");
        return new Response(
          JSON.stringify({ repetitionId: crypto.randomUUID(), created: false }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
      [VOLUNTEER_PERSISTENCE_API_ROUTES.complete]: () =>
        new Response(JSON.stringify({ ok: true, alreadyCompleted: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    const controller = createVolunteerPersistenceController({ fetchImpl });
    await controller.createCollectionSession("CODE");
    await controller.createMovementSession("NORMAL");
    controller.enqueueRep(buildCaptureRecord(1));
    controller.notifyCaptureTargetReached();
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(controller.getState().phase, "retry_required");
    assert.equal(submittedIds.length, 1);

    await controller.retryFailedRep();
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(submittedIds.length, 2);
    assert.equal(submittedIds[0], submittedIds[1]);
    assert.equal(controller.getState().queuedReps[0]?.state, "persisted");
  });

  it("does not regenerate clientSubmissionId on 409 conflict", async () => {
    const submittedIds: string[] = [];
    const movementSessionId = crypto.randomUUID();
    const { fetchImpl } = createMockFetch({
      [VOLUNTEER_PERSISTENCE_API_ROUTES.sessions]: () =>
        new Response(
          JSON.stringify({ sessionToken: "tok", expiresAt: "2026-08-25T12:00:00.000Z" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.movementSessions]: () =>
        new Response(
          JSON.stringify({ movementSessionId, blockIndex: 1 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.repetitions]: (call) => {
        const body = call.body as { clientSubmissionId: string };
        submittedIds.push(body.clientSubmissionId);
        return new Response(JSON.stringify({ error: "conflict" }), { status: 409 });
      },
    });

    const controller = createVolunteerPersistenceController({ fetchImpl });
    await controller.createCollectionSession("CODE");
    await controller.createMovementSession("NORMAL");
    controller.enqueueRep(buildCaptureRecord(1));
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(controller.getState().phase, "fatal_error");
    assert.equal(submittedIds.length, 1);
    await controller.retryFailedRep();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(submittedIds.length, 1);
  });

  it("cannot complete while repetitions are still pending", async () => {
    let completeCalled = false;
    const movementSessionId = crypto.randomUUID();
    const { fetchImpl } = createMockFetch({
      [VOLUNTEER_PERSISTENCE_API_ROUTES.sessions]: () =>
        new Response(
          JSON.stringify({ sessionToken: "tok", expiresAt: "2026-08-25T12:00:00.000Z" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.movementSessions]: () =>
        new Response(
          JSON.stringify({ movementSessionId, blockIndex: 1 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.repetitions]: () =>
        new Promise(() => {
          /* never resolves — simulates in-flight upload */
        }) as Promise<Response>,
      [VOLUNTEER_PERSISTENCE_API_ROUTES.complete]: () => {
        completeCalled = true;
        return new Response(JSON.stringify({ ok: true, deletionCode: "X" }), { status: 200 });
      },
    });

    const controller = createVolunteerPersistenceController({ fetchImpl });
    await controller.createCollectionSession("CODE");
    await controller.createMovementSession("NORMAL");
    controller.enqueueRep(buildCaptureRecord(1));
    controller.notifyCaptureTargetReached();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(completeCalled, false);
    assert.equal(controller.getState().isCompleted, false);
  });

  it("prevents duplicate session and movement creation from double calls", async () => {
    let sessionCreates = 0;
    let movementCreates = 0;
    const { fetchImpl } = createMockFetch({
      [VOLUNTEER_PERSISTENCE_API_ROUTES.sessions]: () => {
        sessionCreates += 1;
        return new Response(
          JSON.stringify({ sessionToken: "tok", expiresAt: "2026-08-25T12:00:00.000Z" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
      [VOLUNTEER_PERSISTENCE_API_ROUTES.movementSessions]: () => {
        movementCreates += 1;
        return new Response(
          JSON.stringify({ movementSessionId: crypto.randomUUID(), blockIndex: 1 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });

    const controller = createVolunteerPersistenceController({ fetchImpl });
    await Promise.all([
      controller.createCollectionSession("CODE"),
      controller.createCollectionSession("CODE"),
    ]);
    await Promise.all([
      controller.createMovementSession("NORMAL"),
      controller.createMovementSession("NORMAL"),
    ]);

    assert.equal(sessionCreates, 1);
    assert.equal(movementCreates, 1);
  });

  it("resetMovementBlock creates a new movement session on next capture block", async () => {
    let movementCreates = 0;
    const { fetchImpl } = createMockFetch({
      [VOLUNTEER_PERSISTENCE_API_ROUTES.sessions]: () =>
        new Response(
          JSON.stringify({ sessionToken: "tok", expiresAt: "2026-08-25T12:00:00.000Z" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.movementSessions]: () => {
        movementCreates += 1;
        return new Response(
          JSON.stringify({ movementSessionId: crypto.randomUUID(), blockIndex: movementCreates }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });

    const controller = createVolunteerPersistenceController({ fetchImpl });
    await controller.createCollectionSession("CODE");
    await controller.createMovementSession("NORMAL");
    controller.resetMovementBlock();
    await controller.createMovementSession("SIMULATED_MILD_COMPENSATION");
    assert.equal(movementCreates, 2);
    assert.equal(controller.getState().movementSessionReady, true);
  });

  it("ignores stale responses after resetAll", async () => {
    let resolveSession: (() => void) | null = null;
    const { fetchImpl } = createMockFetch({
      [VOLUNTEER_PERSISTENCE_API_ROUTES.sessions]: () =>
        new Promise<Response>((resolve) => {
          resolveSession = () =>
            resolve(
              new Response(
                JSON.stringify({ sessionToken: "stale", expiresAt: "2026-08-25T12:00:00.000Z" }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            );
        }),
    });

    const controller = createVolunteerPersistenceController({ fetchImpl });
    const pending = controller.createCollectionSession("CODE");
    controller.resetAll();
    resolveSession?.();
    await pending;
    assert.equal(controller.getState().phase, "idle");
  });

  it("never enqueues more than VOLUNTEER_TARGET_REPS repetitions", async () => {
    const movementSessionId = crypto.randomUUID();
    const { fetchImpl } = createMockFetch({
      [VOLUNTEER_PERSISTENCE_API_ROUTES.sessions]: () =>
        new Response(
          JSON.stringify({ sessionToken: "tok", expiresAt: "2026-08-25T12:00:00.000Z" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.movementSessions]: () =>
        new Response(
          JSON.stringify({ movementSessionId, blockIndex: 1 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.repetitions]: () =>
        new Response(
          JSON.stringify({ repetitionId: crypto.randomUUID(), created: true }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });

    const controller = createVolunteerPersistenceController({ fetchImpl });
    await controller.createCollectionSession("CODE");
    await controller.createMovementSession("NORMAL");

    for (let i = 1; i <= 4; i += 1) {
      controller.enqueueRep(buildCaptureRecord(i));
    }

    assert.equal(controller.getState().queuedReps.length, 3);
    assert.equal(
      controller.getState().queuedReps.map((rep) => rep.repetitionIndex).sort((a, b) => a - b).join(","),
      "1,2,3",
    );
  });

  it("clears frame payloads after successful persistence while keeping metadata", async () => {
    const movementSessionId = crypto.randomUUID();
    const { fetchImpl } = createMockFetch({
      [VOLUNTEER_PERSISTENCE_API_ROUTES.sessions]: () =>
        new Response(
          JSON.stringify({ sessionToken: "tok", expiresAt: "2026-08-25T12:00:00.000Z" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.movementSessions]: () =>
        new Response(
          JSON.stringify({ movementSessionId, blockIndex: 1 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.repetitions]: () =>
        new Response(
          JSON.stringify({ repetitionId: crypto.randomUUID(), created: true }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });

    const controller = createVolunteerPersistenceController({ fetchImpl });
    await controller.createCollectionSession("CODE");
    await controller.createMovementSession("NORMAL");
    controller.enqueueRep(buildCaptureRecord(1));
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.deepEqual(controller.__testOnly.getQueuedRepFrameCounts(), [0]);
    assert.equal(controller.getState().queuedReps[0]?.state, "persisted");
    assert.equal(controller.getState().queuedReps[0]?.repetitionIndex, 1);
  });

  it("retains frame payloads for retryable repetitions until persistence succeeds", async () => {
    let attempts = 0;
    const movementSessionId = crypto.randomUUID();
    const { fetchImpl } = createMockFetch({
      [VOLUNTEER_PERSISTENCE_API_ROUTES.sessions]: () =>
        new Response(
          JSON.stringify({ sessionToken: "tok", expiresAt: "2026-08-25T12:00:00.000Z" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.movementSessions]: () =>
        new Response(
          JSON.stringify({ movementSessionId, blockIndex: 1 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.repetitions]: () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response(JSON.stringify({ error: "retry" }), { status: 502 });
        }
        return new Response(
          JSON.stringify({ repetitionId: crypto.randomUUID(), created: true }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });

    const controller = createVolunteerPersistenceController({ fetchImpl });
    await controller.createCollectionSession("CODE");
    await controller.createMovementSession("NORMAL");
    controller.enqueueRep(buildCaptureRecord(1));
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(controller.getState().phase, "retry_required");
    assert.equal(controller.getState().retryKind, "rep");
    assert.equal(controller.__testOnly.getQueuedRepFrameCounts()[0]! > 0, true);

    await controller.retryFailedRep();
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.deepEqual(controller.__testOnly.getQueuedRepFrameCounts(), [0]);
  });

  it("represents retryable session-create failures as retry_required, not fatal_error", async () => {
    const { fetchImpl } = createMockFetch({
      [VOLUNTEER_PERSISTENCE_API_ROUTES.sessions]: () =>
        new Response(JSON.stringify({ error: "unavailable" }), { status: 502 }),
    });

    const controller = createVolunteerPersistenceController({ fetchImpl });
    const ok = await controller.createCollectionSession("CODE");

    assert.equal(ok, false);
    assert.equal(controller.getState().phase, "retry_required");
    assert.equal(controller.getState().retryKind, "session");
  });

  it("exposes completion retry only when all reps are persisted and completion failed retryably", async () => {
    const movementSessionId = crypto.randomUUID();
    let completeAttempts = 0;
    const { fetchImpl } = createMockFetch({
      [VOLUNTEER_PERSISTENCE_API_ROUTES.sessions]: () =>
        new Response(
          JSON.stringify({ sessionToken: "tok", expiresAt: "2026-08-25T12:00:00.000Z" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.movementSessions]: () =>
        new Response(
          JSON.stringify({ movementSessionId, blockIndex: 1 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.repetitions]: () =>
        new Response(
          JSON.stringify({ repetitionId: crypto.randomUUID(), created: true }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.complete]: () => {
        completeAttempts += 1;
        return new Response(JSON.stringify({ error: "retry" }), { status: 502 });
      },
    });

    const controller = createVolunteerPersistenceController({ fetchImpl });
    await controller.createCollectionSession("CODE");
    await controller.createMovementSession("NORMAL");
    for (let i = 1; i <= 3; i += 1) {
      controller.enqueueRep(buildCaptureRecord(i));
    }
    controller.notifyCaptureTargetReached();
    await new Promise((resolve) => setTimeout(resolve, 15));

    assert.equal(controller.getState().phase, "retry_required");
    assert.equal(controller.getState().retryKind, "completion");
    assert.equal(completeAttempts, 1);

    await controller.retryCompletion();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(completeAttempts, 2);
  });

  it("retryCompletion is a no-op when only a repetition retry is needed", async () => {
    const movementSessionId = crypto.randomUUID();
    let completeAttempts = 0;
    const { fetchImpl } = createMockFetch({
      [VOLUNTEER_PERSISTENCE_API_ROUTES.sessions]: () =>
        new Response(
          JSON.stringify({ sessionToken: "tok", expiresAt: "2026-08-25T12:00:00.000Z" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.movementSessions]: () =>
        new Response(
          JSON.stringify({ movementSessionId, blockIndex: 1 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.repetitions]: () =>
        new Response(JSON.stringify({ error: "retry" }), { status: 502 }),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.complete]: () => {
        completeAttempts += 1;
        return new Response(JSON.stringify({ ok: true, deletionCode: "X" }), { status: 200 });
      },
    });

    const controller = createVolunteerPersistenceController({ fetchImpl });
    await controller.createCollectionSession("CODE");
    await controller.createMovementSession("NORMAL");
    controller.enqueueRep(buildCaptureRecord(1));
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(controller.getState().retryKind, "rep");
    await controller.retryCompletion();
    assert.equal(completeAttempts, 0);
  });

  it("dispose clears sensitive queued payloads and prevents post-dispose state emission", async () => {
    const movementSessionId = crypto.randomUUID();
    const { fetchImpl } = createMockFetch({
      [VOLUNTEER_PERSISTENCE_API_ROUTES.sessions]: () =>
        new Response(
          JSON.stringify({ sessionToken: "tok", expiresAt: "2026-08-25T12:00:00.000Z" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.movementSessions]: () =>
        new Response(
          JSON.stringify({ movementSessionId, blockIndex: 1 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });

    let emissions = 0;
    const controller = createVolunteerPersistenceController({
      fetchImpl,
      onStateChange: () => {
        emissions += 1;
      },
    });
    await controller.createCollectionSession("CODE");
    await controller.createMovementSession("NORMAL");
    controller.enqueueRep(buildCaptureRecord(1));
    const emissionsBeforeDispose = emissions;

    controller.dispose();
    assert.deepEqual(controller.__testOnly.getQueuedRepFrameCounts(), []);
    assert.equal(controller.getState().phase, "idle");
    assert.equal(controller.getState().deletionCode, null);
    assert.equal(emissions, emissionsBeforeDispose);
  });

  it("resetMovementBlock clears queued frame payloads", async () => {
    const movementSessionId = crypto.randomUUID();
    const { fetchImpl } = createMockFetch({
      [VOLUNTEER_PERSISTENCE_API_ROUTES.sessions]: () =>
        new Response(
          JSON.stringify({ sessionToken: "tok", expiresAt: "2026-08-25T12:00:00.000Z" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      [VOLUNTEER_PERSISTENCE_API_ROUTES.movementSessions]: () =>
        new Response(
          JSON.stringify({ movementSessionId, blockIndex: 1 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });

    const controller = createVolunteerPersistenceController({ fetchImpl });
    await controller.createCollectionSession("CODE");
    await controller.createMovementSession("NORMAL");
    controller.enqueueRep(buildCaptureRecord(1));
    assert.equal(controller.__testOnly.getQueuedRepFrameCounts().length, 1);

    controller.resetMovementBlock();
    assert.deepEqual(controller.__testOnly.getQueuedRepFrameCounts(), []);
    assert.equal(controller.getState().movementSessionReady, false);
  });
});
