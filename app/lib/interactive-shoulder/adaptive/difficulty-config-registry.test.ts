/**
 * CHANGE-006 — difficulty configuration resolution.
 *
 * Run: npx tsx --test app/lib/interactive-shoulder/adaptive/difficulty-config-registry.test.ts
 *
 * Every value referenced here is a development fixture with no clinical validation. These
 * tests assert resolution mechanics and the disabled-by-default guarantee only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEVELOPMENT_ADAPTIVE_DIFFICULTY_CONFIG,
  getRegisteredDifficultyConfig,
  resolveAdaptiveDifficultyFeatureFlag,
  resolveDifficultyConfigForBlock,
  resolveDifficultyConfigForSession,
  resolveDifficultyConfigForSessionFromEnv,
} from "./difficulty-config-registry";
import { validateDifficultyConfig } from "./adaptive-difficulty";
import { REACH_THE_LIGHT_TARGET_FEEDBACK_PROFILE } from "../motion-patterns/motion-pattern-registry";
import { SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION } from "../shoulder-abduction-reach-session-definition";
import type { SessionDefinition } from "@/app/lib/session-orchestrator/types";

const ENABLED = true;
const DISABLED = false;

/** A session whose only block uses an unregistered feedback profile. */
const UNREGISTERED_SESSION: SessionDefinition = {
  ...SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION,
  blocks: SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION.blocks.map((block) => ({
    ...block,
    feedbackProfile: "some-unregistered-profile",
  })),
};

describe("difficulty config registry — feature flag", () => {
  it("1. only the exact string \"true\" enables adaptive difficulty", () => {
    assert.equal(resolveAdaptiveDifficultyFeatureFlag("true"), true);
    for (const value of [undefined, "", "false", "TRUE", "True", "1", "yes", "0"]) {
      assert.equal(
        resolveAdaptiveDifficultyFeatureFlag(value),
        false,
        `${String(value)} must not enable adaptive difficulty`,
      );
    }
  });
});

describe("difficulty config registry — resolution", () => {
  it("2. a registered feedback profile resolves the development fixture", () => {
    const config = resolveDifficultyConfigForBlock(
      REACH_THE_LIGHT_TARGET_FEEDBACK_PROFILE,
      ENABLED,
    );
    assert.deepEqual(config, DEVELOPMENT_ADAPTIVE_DIFFICULTY_CONFIG);
  });

  it("3. an unknown feedback profile resolves to null — never a fabricated config", () => {
    assert.equal(resolveDifficultyConfigForBlock("not-a-real-profile", ENABLED), null);
    assert.equal(resolveDifficultyConfigForBlock(undefined, ENABLED), null);
    assert.equal(resolveDifficultyConfigForBlock(null, ENABLED), null);
    assert.equal(resolveDifficultyConfigForBlock("", ENABLED), null);
  });

  it("4. the flag being off resolves to null even for a registered profile", () => {
    assert.equal(
      resolveDifficultyConfigForBlock(REACH_THE_LIGHT_TARGET_FEEDBACK_PROFILE, DISABLED),
      null,
    );
    assert.equal(
      resolveDifficultyConfigForSession(SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION, DISABLED),
      null,
    );
  });

  it("5. the registered configuration is valid, so it can never throw at session start", () => {
    // createAdaptiveDifficultyState throws on an invalid config, and it is called inside
    // the component's session start. A registry entry that failed validation would turn
    // that into a thrown error on a live session.
    const validation = validateDifficultyConfig(DEVELOPMENT_ADAPTIVE_DIFFICULTY_CONFIG);
    assert.equal(validation.valid, true, validation.issues.join(" "));
    assert.ok(getRegisteredDifficultyConfig(REACH_THE_LIGHT_TARGET_FEEDBACK_PROFILE));
  });

  it("6. the development fixture can actually reach its extended-timeout edge", () => {
    // Guards the fixture's usefulness, not a clinical property: if the extended window
    // equalled the normal one, the CHANGE-006 feedback proof would assert nothing.
    const config = DEVELOPMENT_ADAPTIVE_DIFFICULTY_CONFIG;
    assert.ok(
      config.extendedAttemptTimeoutMs > config.normalAttemptTimeoutMs,
      "the fixture must make a timeout change observable",
    );
    assert.ok(config.startLevel > config.minLevel, "the decrease edge must be reachable");
  });
});

describe("difficulty config registry — session resolution", () => {
  it("7. the production session definition resolves a config when enabled", () => {
    const config = resolveDifficultyConfigForSession(
      SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION,
      ENABLED,
    );
    assert.deepEqual(config, DEVELOPMENT_ADAPTIVE_DIFFICULTY_CONFIG);
  });

  it("8. a session with no registered block resolves to null", () => {
    assert.equal(resolveDifficultyConfigForSession(UNREGISTERED_SESSION, ENABLED), null);
  });

  it("9. a session with no blocks at all resolves to null", () => {
    const empty: SessionDefinition = {
      ...SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION,
      blocks: [],
    };
    assert.equal(resolveDifficultyConfigForSession(empty, ENABLED), null);
  });
});

describe("difficulty config registry — environment default", () => {
  it("10. PRODUCTION DEFAULT: an unset environment variable leaves adaptive off", () => {
    // The single most important assertion in this file. Shipping with the flag unset must
    // mean no adaptive runtime behaviour at all.
    assert.equal(
      resolveDifficultyConfigForSessionFromEnv(SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION, undefined),
      null,
    );
    assert.equal(
      resolveDifficultyConfigForSessionFromEnv(SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION, "false"),
      null,
    );
  });

  it("11. an explicit \"true\" enables it", () => {
    assert.deepEqual(
      resolveDifficultyConfigForSessionFromEnv(SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION, "true"),
      DEVELOPMENT_ADAPTIVE_DIFFICULTY_CONFIG,
    );
  });

  it("12. resolution is deterministic and does not mutate the definition", () => {
    const snapshot = structuredClone(SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION);
    const first = resolveDifficultyConfigForSession(SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION, ENABLED);
    const second = resolveDifficultyConfigForSession(SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION, ENABLED);
    assert.deepEqual(first, second);
    assert.deepEqual(SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION, snapshot);
  });
});
