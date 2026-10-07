/**
 * Run: npx tsx --test app/lib/interactive-shoulder/interactive-shoulder-arabic-localization.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interactiveShoulderUi } from "./interactive-shoulder-ui";
import { resolveBlockDisplayCopy } from "./resolve-block-display-copy";
import { resolveCatalogSessionDisplay } from "./resolve-catalog-session-display";
import { resolvePatientLiveInstructionStrip } from "./resolve-patient-live-instruction";
import { resolveCoolDownCoachingMessage } from "./resolve-cool-down-coaching";

const SESSION_ID = "stroke-upper-limb-recovery-foundation-v1-session-1";
const ENGLISH_SESSION_TITLE = "Session 1 — Activation and Functional Reaching";
const ENGLISH_REACH_INSTRUCTION =
  "Lift your arm out to the side and reach toward each therapeutic light. Move at a comfortable pace.";
const ENGLISH_D1_INSTRUCTION =
  "Follow the therapeutic light along the diagonal path. Move smoothly at a comfortable pace.";
const REQUIRED_AR_REACH = "ارفع ذراعك باتجاه الضوء وتحرك بوتيرة مريحة.";
const REQUIRED_AR_D1 = "اتبع الضوء على المسار القطري وتحرك بسلاسة وضمن مدى مريح.";

const KNOWN_ENGLISH_LEAKS = [
  ENGLISH_SESSION_TITLE,
  "Activation and Functional Reaching",
  ENGLISH_REACH_INSTRUCTION,
  ENGLISH_D1_INSTRUCTION,
  "Lift your arm out to the side",
  "Move at a comfortable pace",
  "Follow the therapeutic light",
];

function assertNoKnownEnglishLeaks(copy: string): void {
  for (const leak of KNOWN_ENGLISH_LEAKS) {
    assert.ok(!copy.includes(leak), `unexpected English leak: "${leak}" in "${copy}"`);
  }
}

describe("interactive shoulder Arabic localization QA", () => {
  it("localizes catalog session title and goal", () => {
    const display = resolveCatalogSessionDisplay(
      "ar",
      "8f3c2a10-4b5d-4e6f-9a0b-1c2d3e4f5a6b",
      ENGLISH_SESSION_TITLE,
      "Activation and Functional Reaching",
    );
    assertNoKnownEnglishLeaks(display.title);
    assertNoKnownEnglishLeaks(display.goal ?? "");
  });

  it("uses required Arabic Reach the Light instruction copy", () => {
    const copy = resolveBlockDisplayCopy(
      "ar",
      "stroke-ulrf-v1-session-1-reach-the-light",
      "Reach the Light",
      ENGLISH_REACH_INSTRUCTION,
    );
    assert.equal(copy.instructions, REQUIRED_AR_REACH);
    assertNoKnownEnglishLeaks(copy.instructions);
  });

  it("uses required Arabic D1 instruction copy", () => {
    const copy = resolveBlockDisplayCopy(
      "ar",
      "stroke-ulrf-v1-session-1-d1-diagonal-reach",
      "D1-Inspired Diagonal Reach",
      ENGLISH_D1_INSTRUCTION,
    );
    assert.equal(copy.instructions, REQUIRED_AR_D1);
    assertNoKnownEnglishLeaks(copy.instructions);
  });

  it("prefers localized block copy over orchestrator English instruction echo", () => {
    const reach = resolvePatientLiveInstructionStrip({
      language: "ar",
      blockId: "stroke-ulrf-v1-session-1-reach-the-light",
      fallbackTitle: "Reach the Light",
      fallbackInstructions: ENGLISH_REACH_INSTRUCTION,
      safetyLiveMessage: ENGLISH_REACH_INSTRUCTION,
    });
    assert.equal(reach, REQUIRED_AR_REACH);
    assertNoKnownEnglishLeaks(reach);

    const d1 = resolvePatientLiveInstructionStrip({
      language: "ar",
      blockId: "stroke-ulrf-v1-session-1-d1-diagonal-reach",
      fallbackTitle: "D1-Inspired Diagonal Reach",
      fallbackInstructions: ENGLISH_D1_INSTRUCTION,
      safetyLiveMessage: ENGLISH_D1_INSTRUCTION,
    });
    assert.equal(d1, REQUIRED_AR_D1);
    assertNoKnownEnglishLeaks(d1);
  });

  it("still surfaces Arabic pause and safety messages ahead of block copy", () => {
    const ui = interactiveShoulderUi("ar");
    const paused = resolvePatientLiveInstructionStrip({
      language: "ar",
      blockId: "stroke-ulrf-v1-session-1-reach-the-light",
      fallbackTitle: "Reach the Light",
      fallbackInstructions: ENGLISH_REACH_INSTRUCTION,
      safetyLiveMessage: ui.paused,
    });
    assert.equal(paused, ui.paused);
  });

  it("localizes warm-up, cool-down, pause/resume, sound, and complete shell copy", () => {
    const ui = interactiveShoulderUi("ar");
    const warmUp = resolveBlockDisplayCopy(
      "ar",
      "stroke-ulrf-v1-session-1-warm-up",
      "Warm-up",
      "Reach slowly and comfortably to prepare your shoulder.",
    );
    assertNoKnownEnglishLeaks(warmUp.instructions);

    const coolDown = resolveCoolDownCoachingMessage("ar", 10);
    assertNoKnownEnglishLeaks(coolDown);

    for (const copy of [
      ui.pause,
      ui.resume,
      ui.readyLabel,
      ui.beginLabel,
      ui.soundOnLabel,
      ui.soundOffLabel,
      ui.sessionCompleteTitle,
      ui.trackingLostHold,
      ui.compensationSafetyHold,
    ]) {
      assert.ok(copy.length > 0);
      assertNoKnownEnglishLeaks(copy);
    }
  });
});
