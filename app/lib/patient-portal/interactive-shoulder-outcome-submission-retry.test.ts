/**
 * Run: npx tsx --test app/lib/patient-portal/interactive-shoulder-outcome-submission-retry.test.ts
 *
 * The movement-outcome save used to be a single fire-and-forget attempt: one dropped
 * request (venue Wi-Fi, a 429, a brief 503) lost the session's movement data for good and
 * nothing told the patient or the clinician. These tests pin the bounded retry that now
 * wraps it. All timings, statuses and payloads are deterministic fixtures.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { InteractiveShoulderSessionCompletionSnapshot } from "@/app/lib/interactive-shoulder/orchestrator-cv-session-types";
import {
  isRetryableOutcomeSubmissionStatus,
  OUTCOME_SUBMISSION_RETRY_DELAYS_MS,
  submitInteractiveShoulderOutcomeWithRetry,
  type SubmitInteractiveShoulderOutcomeInput,
  type SubmitInteractiveShoulderOutcomeResult,
} from "./interactive-shoulder-outcome-submission";

const SNAPSHOT = {
  sessionState: "completed",
  sessionElapsedSeconds: 630,
  accumulatedBlockResults: [],
} as unknown as InteractiveShoulderSessionCompletionSnapshot;

const INPUT: SubmitInteractiveShoulderOutcomeInput = {
  token: "fixture-token",
  planSessionId: "00000000-0000-4000-8000-000000000001",
  snapshot: SNAPSHOT,
};

const failure = (status: number): SubmitInteractiveShoulderOutcomeResult => ({
  ok: false,
  error: "fixture",
  status,
});
const success = (created = true): SubmitInteractiveShoulderOutcomeResult => ({ ok: true, created });

/** Scripted submit: returns the queued results in order and records every call. */
function scripted(results: SubmitInteractiveShoulderOutcomeResult[]) {
  const calls: SubmitInteractiveShoulderOutcomeInput[] = [];
  const sleeps: number[] = [];
  return {
    calls,
    sleeps,
    options: {
      submit: async (input: SubmitInteractiveShoulderOutcomeInput) => {
        calls.push(input);
        const next = results.shift();
        assert.ok(next, "submit called more times than scripted");
        return next;
      },
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    },
  };
}

describe("isRetryableOutcomeSubmissionStatus", () => {
  it("retries only network failures, rate limiting and transient server errors", () => {
    for (const status of [0, 429, 500, 502, 503, 504]) {
      assert.equal(isRetryableOutcomeSubmissionStatus(status), true, String(status));
    }
    for (const status of [200, 201, 400, 401, 403, 404, 409, 410, 413, 422]) {
      assert.equal(isRetryableOutcomeSubmissionStatus(status), false, String(status));
    }
  });
});

describe("submitInteractiveShoulderOutcomeWithRetry", () => {
  it("a first-attempt success makes exactly one attempt and never waits", async () => {
    const s = scripted([success()]);
    const result = await submitInteractiveShoulderOutcomeWithRetry(INPUT, s.options);
    assert.deepEqual(result, { ok: true, created: true, attempts: 1 });
    assert.deepEqual(s.sleeps, []);
  });

  it("recovers from a network failure on the second attempt", async () => {
    const s = scripted([failure(0), success()]);
    const result = await submitInteractiveShoulderOutcomeWithRetry(INPUT, s.options);
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 2);
    assert.deepEqual(s.sleeps, [OUTCOME_SUBMISSION_RETRY_DELAYS_MS[0]]);
  });

  it("recovers on the third attempt after two transient failures, waiting between each", async () => {
    const s = scripted([failure(503), failure(429), success()]);
    const result = await submitInteractiveShoulderOutcomeWithRetry(INPUT, s.options);
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 3);
    assert.deepEqual(s.sleeps, [...OUTCOME_SUBMISSION_RETRY_DELAYS_MS]);
  });

  it("a replay of an already-stored outcome (created:false) counts as saved", async () => {
    const s = scripted([failure(0), success(false)]);
    const result = await submitInteractiveShoulderOutcomeWithRetry(INPUT, s.options);
    assert.deepEqual(result, { ok: true, created: false, attempts: 2 });
  });

  it("gives up after the bounded number of attempts and reports the real failure, not success", async () => {
    const s = scripted([failure(503), failure(503), failure(503)]);
    const result = await submitInteractiveShoulderOutcomeWithRetry(INPUT, s.options);
    assert.equal(result.ok, false);
    assert.equal(result.attempts, 3);
    if (!result.ok) assert.equal(result.status, 503);
    assert.equal(s.calls.length, 3, "never more than the bounded number of attempts");
    assert.deepEqual(s.sleeps, [...OUTCOME_SUBMISSION_RETRY_DELAYS_MS]);
  });

  it("never retries a failure that cannot succeed (invalid, ineligible, unknown token)", async () => {
    for (const status of [400, 404, 409]) {
      const s = scripted([failure(status)]);
      const result = await submitInteractiveShoulderOutcomeWithRetry(INPUT, s.options);
      assert.equal(result.ok, false);
      assert.equal(result.attempts, 1, `status ${status}`);
      assert.deepEqual(s.sleeps, []);
    }
  });

  it("resends the SAME snapshot every time -- nothing is regenerated or altered", async () => {
    const s = scripted([failure(0), failure(500), success()]);
    await submitInteractiveShoulderOutcomeWithRetry(INPUT, s.options);
    assert.equal(s.calls.length, 3);
    for (const call of s.calls) {
      assert.equal(call, INPUT, "the identical input object is resubmitted");
      assert.equal(call.snapshot, SNAPSHOT);
    }
  });

  it("stops without waiting when the screen has gone away", async () => {
    const s = scripted([failure(0)]);
    const result = await submitInteractiveShoulderOutcomeWithRetry(INPUT, {
      ...s.options,
      isCancelled: () => true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.attempts, 1);
    assert.deepEqual(s.sleeps, []);
  });

  it("does not start another attempt if the screen goes away while waiting", async () => {
    let cancelled = false;
    const s = scripted([failure(0)]);
    const result = await submitInteractiveShoulderOutcomeWithRetry(INPUT, {
      submit: s.options.submit,
      sleep: async (ms) => {
        s.sleeps.push(ms);
        cancelled = true;
      },
      isCancelled: () => cancelled,
    });
    assert.equal(result.ok, false);
    assert.equal(result.attempts, 1);
    assert.equal(s.calls.length, 1, "no attempt after cancellation");
  });

  it("honours a custom retry schedule (zero delays = no retry)", async () => {
    const s = scripted([failure(0)]);
    const result = await submitInteractiveShoulderOutcomeWithRetry(INPUT, {
      ...s.options,
      retryDelaysMs: [],
    });
    assert.equal(result.ok, false);
    assert.equal(result.attempts, 1);
  });
});
