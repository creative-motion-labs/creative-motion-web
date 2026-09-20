/**
 * CHANGE-006 — component wiring guarantees.
 *
 * Run: npx tsx --test app/lib/interactive-shoulder/adaptive/adaptive-runtime-wiring.test.ts
 *
 * The repository has no React test infrastructure (no jsdom, no testing-library — see
 * package.json devDependencies), so component-level guarantees are asserted against the
 * component SOURCE. That is an existing convention here, not one invented for this stage:
 * `orchestrator-cv-session-core.test.ts` already reads
 * `OrchestratorCvSessionCore.tsx`/`InteractiveShoulderSession.tsx` and asserts on their
 * text to pin wiring that cannot otherwise be reached.
 *
 * These assertions are structural, so they are written to survive formatting: they anchor
 * on identifiers and on ordering relative to named landmarks, never on whitespace.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const CORE_PATH = join(
  process.cwd(),
  "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx",
);
const source = readFileSync(CORE_PATH, "utf8");

/** Body of `startSession`, the component's only session boundary. */
function startSessionBody(): string {
  const start = source.indexOf("const startSession = useCallback");
  assert.ok(start >= 0, "startSession must exist");
  const end = source.indexOf("useLayoutEffect", start);
  assert.ok(end > start, "startSession body must be bounded");
  return source.slice(start, end);
}

/** The dispatch seam construction inside the animation loop. */
function seamBody(): string {
  const start = source.indexOf("const adaptiveState = adaptiveStateRef.current;");
  assert.ok(start >= 0, "the seam must exist");
  const end = source.indexOf("if (dispatch.status ===", start);
  assert.ok(end > start, "the seam body must be bounded");
  return source.slice(start, end);
}

/** Body of the block-transition branch inside the animation loop. */
function blockTransitionBody(): string {
  const start = source.indexOf("resetRunnerStatesForBlockTransition({");
  assert.ok(start >= 0, "the block transition must exist");
  const end = source.indexOf("const poseSnap = snapshotRef.current", start);
  assert.ok(end > start, "the block transition body must be bounded");
  return source.slice(start, end);
}

describe("CHANGE-006 wiring — adaptive state lifetime", () => {
  it("1. adaptive state is created at the session boundary, inside startSession", () => {
    const body = startSessionBody();
    assert.match(body, /adaptiveStateRef\.current\s*=/, "session start assigns adaptive state");
    assert.match(body, /resolveDifficultyConfigForSessionFromEnv/);
    assert.match(body, /createAdaptiveDifficultyState/);
  });

  it("2. a session with no config leaves adaptive state null rather than fabricating one", () => {
    const body = startSessionBody();
    assert.match(
      body,
      /adaptiveStateRef\.current\s*=\s*\w+\s*\?\s*createAdaptiveDifficultyState\(\w+\)\s*:\s*null/,
      "an absent config must produce null, never a default config",
    );
  });

  it("3. SESSION SCOPE: adaptive state is NOT reset on block transition", () => {
    // The load-bearing lifetime guarantee. runnerStatesRef is deliberately rebuilt on every
    // block change; adaptation must survive it.
    const body = blockTransitionBody();
    assert.match(body, /runnerStatesRef\.current = transition\.states/, "precondition");
    assert.doesNotMatch(
      body,
      /adaptiveStateRef\.current\s*=/,
      "adaptive state must not be assigned during a block transition",
    );
  });

  it("4. adaptive state is not part of the block-scoped runner state bag", () => {
    const bagStart = source.indexOf("const runnerStatesRef = useRef<ActiveBlockRunnerStates>");
    assert.ok(bagStart >= 0);
    const bag = source.slice(bagStart, bagStart + 300);
    assert.doesNotMatch(bag, /adaptive/i, "adaptive state has its own session-scoped ref");
    assert.match(source, /const adaptiveStateRef = useRef<AdaptiveDifficultyState \| null>/);
  });
});

describe("CHANGE-006 wiring — dispatch seam", () => {
  it("5. the attempt seam is supplied only when adaptive state exists", () => {
    assert.match(
      source,
      /const targetAttempt: TargetAttemptTickConfig \| undefined = adaptiveState\s*\?/,
      "the seam is conditional on adaptive state",
    );
    assert.match(source, /:\s*undefined;/, "no adaptive state means no seam");
  });

  it("6. the seam carries the engine's CURRENT attemptTimeoutMs — the feedback edge", () => {
    assert.match(
      source,
      /attemptTimeoutMs:\s*adaptiveState\.attemptTimeoutMs/,
      "the value fed back must come from adaptive state, not a constant",
    );
  });

  it("7. compensation goes through the safe rule, never the raw snapshot flag", () => {
    assert.match(
      source,
      /compensationObservedDuringAttempt:\s*resolveAttemptCompensationObservation\(/,
      "the latch-true rule must be used",
    );
    assert.doesNotMatch(
      source,
      /compensationObservedDuringAttempt:\s*(poseSnap|snapshot)\??\.?\w*\.?compensationFlagged/,
      "a raw compensationFlagged must never be passed as an observation",
    );
  });

  it("8. CHANGE-007 supersedes the CHANGE-006 omission: levelDegrees now rides with a position", () => {
    // CHANGE-006 asserted the OPPOSITE here — that levelDegrees must not be transported,
    // because a value that could not move a target would make the loop look closed. That
    // reason expired the moment placement became real, so the assertion is inverted rather
    // than deleted: the guarantee it protects (no metadata-only transport) still holds, it
    // is just now expressed as "never a level without the position it describes".
    const seam = seamBody();
    assert.match(seam, /levelDegrees:\s*adaptivePlacement\.levelDegrees/);
    assert.match(seam, /preferredTargetPosition:\s*adaptivePlacement\.position/);

    // Both keys must sit inside the SAME conditional spread. Two independent spreads would
    // let a future edit ship a level for a randomly placed target.
    assert.match(
      seam,
      /\.\.\.\(adaptivePlacement\.placed\s*\?\s*\{[^}]*preferredTargetPosition:[^}]*levelDegrees:[^}]*\}\s*:\s*\{\}\)/s,
      "position and level must be supplied together, gated on a resolved placement",
    );
  });
});

describe("CHANGE-006 wiring — additive consumption", () => {
  it("9. the existing session-input path for a hit is preserved", () => {
    assert.match(
      source,
      /orchestrator\.reportInputEvent\(\s*mapTargetHitToSessionInput\(dispatch\.targetContact\)/,
      "target contact must still reach the orchestrator as a session input",
    );
    assert.match(
      source,
      /orchestrator\.reportInputEvent\(\s*mapPatternCompletionToSessionInput\(dispatch\.patternCompleted\)/,
      "pattern completion must still reach the orchestrator",
    );
  });

  it("9b. the hit's session path is NOT conditional on adaptive state", () => {
    // Asserting the call merely EXISTS is not enough: wrapping it in `if (!adaptiveState)`
    // would keep the text and still silently disable the existing session behaviour
    // whenever adaptive is on. The whole handler must be free of adaptive conditions.
    const start = source.indexOf("if (dispatch.targetContact) {");
    assert.ok(start >= 0, "the hit handler must exist");
    const end = source.indexOf("if (dispatch.patternCompleted) {", start);
    assert.ok(end > start, "the hit handler must be bounded");
    const hitHandler = source.slice(start, end);

    assert.match(hitHandler, /orchestrator\.reportInputEvent\(/, "precondition");
    assert.doesNotMatch(
      hitHandler,
      /adaptive/i,
      "the existing hit path must behave identically whether adaptive is on or off",
    );
  });

  it("10. adaptive consumption is additive — it runs after, not instead of, the session path", () => {
    const hitReport = source.indexOf("mapTargetHitToSessionInput(dispatch.targetContact)");
    const adaptiveApply = source.indexOf("applyDispatchOutcomesToAdaptiveState(adaptiveState");
    assert.ok(hitReport >= 0, "the session path must exist");
    assert.ok(adaptiveApply >= 0, "the adaptive path must exist");
    assert.ok(
      adaptiveApply > hitReport,
      "adaptive consumption must not precede or replace the existing session path",
    );
  });

  it("11. both terminal facts are handed to the adaptive reducer", () => {
    const start = source.indexOf("applyDispatchOutcomesToAdaptiveState(adaptiveState");
    const body = source.slice(start, start + 400);
    assert.match(body, /targetContact:\s*dispatch\.targetContact/);
    assert.match(body, /targetAttemptTimeout:\s*dispatch\.targetAttemptTimeout/);
  });

  it("12. adaptive consumption is gated on adaptive being enabled", () => {
    assert.match(
      source,
      /if \(adaptiveState\) \{\s*adaptiveStateRef\.current = applyDispatchOutcomesToAdaptiveState/,
      "with adaptive disabled nothing is applied",
    );
  });

  it("13. no orchestrator input event is invented for an expired attempt", () => {
    // The orchestrator has no vocabulary for attempt expiry, and CHANGE-006 does not add
    // one. A timeout must reach the adaptive engine only.
    assert.doesNotMatch(
      source,
      /reportInputEvent\([^)]*targetAttemptTimeout/,
      "an expired attempt must not be reported as a session input event",
    );
  });

  it("14. targetAttemptStarted is not consumed", () => {
    // Attempt identity, initialisation and compensation reset are lifecycle-owned.
    assert.doesNotMatch(
      source,
      /targetAttemptStarted/,
      "consuming attempt starts would duplicate lifecycle ownership",
    );
  });

  it("16. CHANGE-008 per-frame ordering: resolve placement → dispatch → apply outcome", () => {
    // The lifecycle guarantees the successor is built on a tick AFTER the terminal one.
    // That only delivers post-outcome adaptation if the component, within a frame, resolves
    // placement from the adaptive state BEFORE dispatch and writes the outcome back AFTER
    // it. Both halves are behavioural everywhere except here — the component itself has no
    // test harness in this repository — so the frame order is pinned structurally.
    const resolvePlacement = source.indexOf("resolveAdaptiveTargetPlacement({");
    const dispatchCall = source.indexOf("const dispatch = dispatchOrchestratorCvBlock({");
    const applyOutcome = source.indexOf("applyDispatchOutcomesToAdaptiveState(adaptiveState");
    assert.ok(resolvePlacement >= 0, "placement must be resolved in the loop");
    assert.ok(dispatchCall > resolvePlacement, "placement is resolved before dispatch runs");
    assert.ok(applyOutcome > dispatchCall, "the outcome is applied after dispatch returns");

    // And the resolved placement must come from the ref the outcome is written back to,
    // not from a value captured earlier in the frame under another name.
    const seam = seamBody();
    assert.match(seam, /const adaptiveState = adaptiveStateRef\.current;/);
    assert.match(seam, /adaptiveState,/, "the live state feeds the placement resolver");
  });

  it("15. trackingLost is not wired — tracking loss stays a safety-hold concern", () => {
    assert.doesNotMatch(
      source,
      /mapTrackingLossToAdaptiveOutcome|trackingLost/,
      "tracking loss must not be turned into an adaptive outcome here",
    );
  });
});
