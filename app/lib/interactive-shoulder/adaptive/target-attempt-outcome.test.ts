/**
 * CHANGE-005 — target attempt outcome mapping.
 *
 * Run: npx tsx --test app/lib/interactive-shoulder/adaptive/target-attempt-outcome.test.ts
 *
 * Scope: the pure fact→semantics conversion only. Nothing here asserts adaptive state,
 * runtime wiring or clinical meaning — a mapped `success` states that a target contact
 * was registered, and a mapped `incomplete` states that an attempt expired. Every
 * millisecond value below is a test fixture with no clinical validation.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapTargetAttemptTimeoutToAdaptiveOutcome,
  mapTargetHitToAdaptiveOutcome,
  mapTrackingLossToAdaptiveOutcome,
} from "./target-attempt-outcome";
import type { TargetAttemptTimeoutEvent, TargetHitEvent } from "../types";

const T0 = 1_000_000;

/** Builds a hit exactly as `target-lifecycle.ts` emits one, minus optional metadata. */
function hit(overrides: Partial<TargetHitEvent> = {}): TargetHitEvent {
  return {
    targetId: "target-1-1000000",
    capturedAtMs: T0 + 1_400,
    reactionTimeMs: 1_400,
    sequence: 1,
    ...overrides,
  };
}

/** Builds a timeout exactly as `target-lifecycle.ts` emits one. */
function timeout(overrides: Partial<TargetAttemptTimeoutEvent> = {}): TargetAttemptTimeoutEvent {
  return {
    targetId: "target-1-1000000",
    sequence: 1,
    expiredAtMs: T0 + 8_000,
    expiredAtBlockElapsedS: 8,
    activeElapsedMs: 8_000,
    attemptTimeoutMs: 8_000,
    ...overrides,
  };
}

describe("target attempt outcome mapping — successful contact", () => {
  it("1. a registered target hit maps to a success outcome", () => {
    const outcome = mapTargetHitToAdaptiveOutcome(hit());
    assert.equal(outcome.kind, "success");
  });

  it("2. the lifecycle's factual reactionTimeMs is carried across as reachTimeMs", () => {
    const outcome = mapTargetHitToAdaptiveOutcome(hit({ reactionTimeMs: 2_350 }));
    assert.equal(outcome.reachTimeMs, 2_350, "the measured value is forwarded verbatim");
  });

  it("a zero reaction time is a real measurement and is forwarded, not dropped", () => {
    // 0 is falsy; a truthiness check instead of a finiteness check would silently lose it.
    const outcome = mapTargetHitToAdaptiveOutcome(hit({ reactionTimeMs: 0 }));
    assert.ok("reachTimeMs" in outcome, "zero is a value, not an absence");
    assert.equal(outcome.reachTimeMs, 0);
  });

  it("a non-finite reaction time is omitted rather than asserted as factual timing", () => {
    const outcome = mapTargetHitToAdaptiveOutcome(hit({ reactionTimeMs: Number.NaN }));
    assert.ok(!("reachTimeMs" in outcome), "NaN is never forwarded as a measured reach time");
  });
});

describe("target attempt outcome mapping — compensation is a three-state fact", () => {
  it("3. an explicitly compensated hit maps to compensated: true", () => {
    const outcome = mapTargetHitToAdaptiveOutcome(hit({ compensatedDuringAttempt: true }));
    assert.equal(outcome.kind, "success");
    assert.equal(outcome.compensated, true);
  });

  it("4. UNKNOWN compensation stays absent and must never become false", () => {
    // The load-bearing case. `TargetHitEvent.compensatedDuringAttempt` documents absence
    // as "unknown, not clean" — flattening it to `false` would convert missing
    // information into an observation of clean movement.
    const source = hit();
    assert.ok(
      !("compensatedDuringAttempt" in source),
      "fixture precondition: the source carries no compensation input",
    );

    const outcome = mapTargetHitToAdaptiveOutcome(source);
    assert.ok(!("compensated" in outcome), "the field is absent, not present-and-false");
    assert.notEqual(outcome.compensated, false, "unknown did not silently become false");
    assert.equal(outcome.compensated, undefined);
  });

  it("an explicitly clean hit forwards compensated: false, because that IS an observation", () => {
    // Distinct from the case above: here the caller supplied compensation input and
    // reported none. Passing it through is faithful; inventing it would not be.
    const outcome = mapTargetHitToAdaptiveOutcome(hit({ compensatedDuringAttempt: false }));
    assert.ok("compensated" in outcome, "an explicit observation is preserved");
    assert.equal(outcome.compensated, false);
  });
});

describe("target attempt outcome mapping — attempt expiration", () => {
  it("5. an expired attempt maps to an incomplete outcome", () => {
    const outcome = mapTargetAttemptTimeoutToAdaptiveOutcome(timeout());
    assert.equal(outcome.kind, "incomplete");
  });

  it("6. SAFETY: a timeout can never map to trackingLost, whatever the event carries", () => {
    // Tracking loss is a voided attempt that says nothing about the patient; an expired
    // attempt is a patient-facing interaction result. Collapsing the two in either
    // direction is the specific defect this boundary exists to prevent.
    const variants: TargetAttemptTimeoutEvent[] = [
      timeout(),
      timeout({ activeElapsedMs: 0, attemptTimeoutMs: 0 }),
      timeout({ compensatedDuringAttempt: true }),
      timeout({ compensatedDuringAttempt: false }),
      timeout({ levelDegrees: 75 }),
      timeout({ expiredAtBlockElapsedS: 0, expiredAtMs: 0 }),
      timeout({ activeElapsedMs: Number.POSITIVE_INFINITY }),
    ];

    for (const variant of variants) {
      const outcome = mapTargetAttemptTimeoutToAdaptiveOutcome(variant);
      assert.equal(outcome.kind, "incomplete");
      assert.notEqual(outcome.kind, "trackingLost");
    }
  });

  it("an expired attempt carries no reach time and no compensation into the outcome", () => {
    // Expiration produced no contact, so there is no reach to time. Compensation metadata
    // on the event is factual pass-through for the event layer, not an adaptive input for
    // an attempt that never completed.
    const outcome = mapTargetAttemptTimeoutToAdaptiveOutcome(
      timeout({ compensatedDuringAttempt: true }),
    );
    assert.deepEqual(outcome, { kind: "incomplete" });
  });
});

describe("target attempt outcome mapping — tracking loss", () => {
  it("7. an explicitly identified tracking loss maps to trackingLost", () => {
    assert.deepEqual(mapTrackingLossToAdaptiveOutcome(), { kind: "trackingLost" });
  });

  it("tracking loss is reachable ONLY by explicit call — it takes no event to infer from", () => {
    // The zero-arity signature is the contract: there is no timeout, elapsed time, absent
    // wrist or missing hit this module will accept as evidence of tracking loss.
    assert.equal(mapTrackingLossToAdaptiveOutcome.length, 0);
  });
});

describe("target attempt outcome mapping — purity", () => {
  it("8. never mutates the source event objects", () => {
    const sourceHit = Object.freeze(hit({ compensatedDuringAttempt: true }));
    const sourceTimeout = Object.freeze(timeout());
    const hitSnapshot = structuredClone(sourceHit);
    const timeoutSnapshot = structuredClone(sourceTimeout);

    mapTargetHitToAdaptiveOutcome(sourceHit);
    mapTargetAttemptTimeoutToAdaptiveOutcome(sourceTimeout);

    assert.deepEqual(sourceHit, hitSnapshot, "the hit event was not modified");
    assert.deepEqual(sourceTimeout, timeoutSnapshot, "the timeout event was not modified");
  });

  it("9. is deterministic — the same input repeatedly produces deep-equal output", () => {
    const sourceHit = hit({ reactionTimeMs: 1_750, compensatedDuringAttempt: true });
    const sourceTimeout = timeout();

    assert.deepEqual(
      mapTargetHitToAdaptiveOutcome(sourceHit),
      mapTargetHitToAdaptiveOutcome(sourceHit),
    );
    assert.deepEqual(
      mapTargetAttemptTimeoutToAdaptiveOutcome(sourceTimeout),
      mapTargetAttemptTimeoutToAdaptiveOutcome(sourceTimeout),
    );
    assert.deepEqual(mapTrackingLossToAdaptiveOutcome(), mapTrackingLossToAdaptiveOutcome());
  });

  it("returns a fresh object each call, so a caller cannot alias a shared outcome", () => {
    const source = hit();
    assert.notEqual(
      mapTargetHitToAdaptiveOutcome(source),
      mapTargetHitToAdaptiveOutcome(source),
      "distinct object identities",
    );
    assert.notEqual(
      mapTrackingLossToAdaptiveOutcome(),
      mapTrackingLossToAdaptiveOutcome(),
    );
  });

  it("the three mappings stay mutually exclusive across the whole surface", () => {
    // No input to any mapper can produce another mapper's outcome kind.
    assert.equal(mapTargetHitToAdaptiveOutcome(hit()).kind, "success");
    assert.equal(mapTargetAttemptTimeoutToAdaptiveOutcome(timeout()).kind, "incomplete");
    assert.equal(mapTrackingLossToAdaptiveOutcome().kind, "trackingLost");
  });
});
