/**
 * Run: npx tsx --test app/lib/interactive-shoulder/resolve-patient-live-instruction.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePatientLiveInstructionStrip } from "./resolve-patient-live-instruction";

const ENGLISH_FALLBACK =
  "Lift your arm out to the side and reach toward each therapeutic light. Move at a comfortable pace.";

describe("resolvePatientLiveInstructionStrip", () => {
  it("returns Arabic Reach the Light copy instead of English block.instructions fallback", () => {
    const message = resolvePatientLiveInstructionStrip({
      language: "ar",
      blockId: "stroke-ulrf-v1-session-1-reach-the-light",
      fallbackTitle: "Reach the Light",
      fallbackInstructions: ENGLISH_FALLBACK,
    });
    assert.equal(message, "ارفع ذراعك باتجاه الضوء وتحرك بوتيرة مريحة.");
    assert.ok(!message.includes("Lift your arm"));
  });

  it("returns Arabic D1 copy instead of English block.instructions fallback", () => {
    const message = resolvePatientLiveInstructionStrip({
      language: "ar",
      blockId: "stroke-ulrf-v1-session-1-d1-diagonal-reach",
      fallbackTitle: "D1-Inspired Diagonal Reach",
      fallbackInstructions: "Follow the therapeutic light along the diagonal path.",
    });
    assert.equal(message, "اتبع الضوء على المسار القطري وتحرك بسلاسة وضمن مدى مريح.");
    assert.ok(!message.includes("Follow the therapeutic"));
  });

  it("returns Arabic warm-up and cool-down copy for instructional blocks", () => {
    const warmUp = resolvePatientLiveInstructionStrip({
      language: "ar",
      blockId: "stroke-ulrf-v1-session-1-warm-up",
      fallbackTitle: "Warm-up",
      fallbackInstructions: "Reach slowly and comfortably to prepare your shoulder.",
    });
    assert.equal(warmUp, "حرّك ذراعك ببطء وضمن مدى مريح لتهيئة كتفك.");

    const coolDown = resolvePatientLiveInstructionStrip({
      language: "ar",
      blockId: "stroke-ulrf-v1-session-1-cool-down",
      fallbackTitle: "Cool-down",
      fallbackInstructions: "Slow down your movement and relax your shoulder.",
    });
    assert.equal(coolDown, "أعد ذراعك ببطء إلى وضع مريح ومدعوم.");
  });

  it("prefers target-hit announcement over localized instruction", () => {
    const message = resolvePatientLiveInstructionStrip({
      language: "ar",
      blockId: "stroke-ulrf-v1-session-1-reach-the-light",
      fallbackTitle: "Reach the Light",
      fallbackInstructions: ENGLISH_FALLBACK,
      targetHitAnnouncement: "وصول جيد",
    });
    assert.equal(message, "وصول جيد");
  });

  it("prefers localized instruction over orchestrator English block.instructions echo", () => {
    const message = resolvePatientLiveInstructionStrip({
      language: "ar",
      blockId: "stroke-ulrf-v1-session-1-reach-the-light",
      fallbackTitle: "Reach the Light",
      fallbackInstructions: ENGLISH_FALLBACK,
      safetyLiveMessage: ENGLISH_FALLBACK,
    });
    assert.equal(message, "ارفع ذراعك باتجاه الضوء وتحرك بوتيرة مريحة.");
    assert.ok(!message.includes("Lift your arm"));
  });
});
