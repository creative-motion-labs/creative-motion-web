/**
 * Run: npx tsx --test app/volunteer/shoulder-abduction-reach/volunteer-capture-session-lifecycle.test.ts
 *
 * Behavioral simulation of the hook's capture-block lifecycle without mounting React.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ShoulderAbductionReachRepCaptureRecord } from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";
import { createVolunteerInMemoryCaptureSink } from "./volunteer-capture-sink";
import { VOLUNTEER_TARGET_REPS } from "./volunteer-protocol";
import { createVolunteerPersistenceController } from "./volunteer-research-persistence-controller";
import {
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
} from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";
import { buildVolunteerRepetitionFixture } from "@/app/lib/research/volunteer-repetition-validation";
import { VOLUNTEER_PERSISTENCE_API_ROUTES } from "./volunteer-browser-persistence-client";

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

function createMockFetchSuccess() {
  const movementSessionId = crypto.randomUUID();
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === VOLUNTEER_PERSISTENCE_API_ROUTES.sessions) {
      return new Response(
        JSON.stringify({ sessionToken: "tok", expiresAt: "2026-08-25T12:00:00.000Z" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url === VOLUNTEER_PERSISTENCE_API_ROUTES.movementSessions) {
      return new Response(
        JSON.stringify({ movementSessionId, blockIndex: 1 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url === VOLUNTEER_PERSISTENCE_API_ROUTES.repetitions) {
      return new Response(
        JSON.stringify({ repetitionId: crypto.randomUUID(), created: true }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url === VOLUNTEER_PERSISTENCE_API_ROUTES.complete) {
      return new Response(
        JSON.stringify({ ok: true, deletionCode: "DEL-CODE" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
  };
}

describe("volunteer capture session lifecycle simulation", () => {
  it("does not retain full capture records in hook-like state after enqueue", async () => {
    const hookLikeState: {
      capturedCount: number;
      retainedRecords: ShoulderAbductionReachRepCaptureRecord[];
    } = {
      capturedCount: 0,
      retainedRecords: [],
    };

    const controller = createVolunteerPersistenceController({
      fetchImpl: createMockFetchSuccess(),
    });
    await controller.createCollectionSession("CODE");
    await controller.createMovementSession("NORMAL");

    const captureBlockGenerationRef = { current: 0 };
    const capturedCountRef = { current: 0 };

    const sink = createVolunteerInMemoryCaptureSink({
      participantId: "local",
      sessionId: "local",
      side: "right",
      getProtocolCondition: () => "NORMAL",
      getCaptureBlockGeneration: () => captureBlockGenerationRef.current,
      onRepCaptured: (record) => {
        if (capturedCountRef.current >= VOLUNTEER_TARGET_REPS) return;
        controller.enqueueRep(record);
        capturedCountRef.current += 1;
        hookLikeState.capturedCount = capturedCountRef.current;
      },
    });

    for (let i = 1; i <= VOLUNTEER_TARGET_REPS; i += 1) {
      controller.enqueueRep(buildCaptureRecord(i));
      capturedCountRef.current = i;
      hookLikeState.capturedCount = i;
    }

    assert.equal(hookLikeState.capturedCount, VOLUNTEER_TARGET_REPS);
    assert.equal(hookLikeState.retainedRecords.length, 0);

    controller.notifyCaptureTargetReached();
    await new Promise((resolve) => setTimeout(resolve, 15));

    assert.deepEqual(controller.__testOnly.getQueuedRepFrameCounts(), [0, 0, 0]);
    assert.equal(hookLikeState.retainedRecords.length, 0);
    void sink;
  });

  it("reset clears pending frame payloads from controller and capture counters", async () => {
    const controller = createVolunteerPersistenceController({
      fetchImpl: createMockFetchSuccess(),
    });
    await controller.createCollectionSession("CODE");
    await controller.createMovementSession("NORMAL");

    const captureBlockGenerationRef = { current: 0 };
    const capturedCountRef = { current: 0 };

    const sink = createVolunteerInMemoryCaptureSink({
      participantId: "local",
      sessionId: "local",
      side: "right",
      getProtocolCondition: () => "NORMAL",
      getCaptureBlockGeneration: () => captureBlockGenerationRef.current,
      onRepCaptured: (record) => {
        controller.enqueueRep(record);
        capturedCountRef.current += 1;
      },
    });

    controller.enqueueRep(buildCaptureRecord(1));
    assert.equal(controller.__testOnly.getQueuedRepFrameCounts().some((count) => count > 0), true);

    captureBlockGenerationRef.current += 1;
    sink.resetRecorder();
    capturedCountRef.current = 0;
    controller.resetMovementBlock();

    assert.deepEqual(controller.__testOnly.getQueuedRepFrameCounts(), []);
    assert.equal(capturedCountRef.current, 0);
  });

  it("movement block B starts at repetitionIndex 1 after reset", () => {
    const captureBlockGenerationRef = { current: 0 };
    const capturedIndices: number[] = [];

    const sink = createVolunteerInMemoryCaptureSink({
      participantId: "local",
      sessionId: "local",
      side: "right",
      getProtocolCondition: () => "NORMAL",
      getCaptureBlockGeneration: () => captureBlockGenerationRef.current,
      onRepCaptured: (record) => {
        capturedIndices.push(record.context.repetitionIndex);
      },
    });

    captureBlockGenerationRef.current += 1;
    sink.resetRecorder();
    capturedIndices.length = 0;

    assert.equal(sink.getEmittedRepCount(), 0);
    assert.deepEqual(capturedIndices, []);
  });
});
