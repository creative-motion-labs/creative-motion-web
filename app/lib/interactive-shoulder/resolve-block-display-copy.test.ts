/**
 * Run: npx tsx --test app/lib/interactive-shoulder/resolve-block-display-copy.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isCoolDownBlock,
  isWarmUpBlock,
  resolveBlockDisplayCopy,
} from "./resolve-block-display-copy";

describe("resolveBlockDisplayCopy", () => {
  it("returns localized warm-up and cool-down copy", () => {
    const warmUpEn = resolveBlockDisplayCopy(
      "en",
      "stroke-ulrf-v1-session-1-warm-up",
      "Fallback",
      "Fallback instructions",
    );
    const warmUpAr = resolveBlockDisplayCopy(
      "ar",
      "stroke-ulrf-v1-session-1-warm-up",
      "Fallback",
      "Fallback instructions",
    );
    assert.equal(warmUpEn.phaseLabel, "Warm-up");
    assert.ok(warmUpEn.instructions.includes("shoulder"));
    assert.equal(warmUpAr.phaseLabel, "الإحماء");
    assert.equal(warmUpAr.instructions, "حرّك ذراعك ببطء وضمن مدى مريح لتهيئة كتفك.");

    const coolDownEn = resolveBlockDisplayCopy(
      "en",
      "stroke-ulrf-v1-session-1-cool-down",
      "Fallback",
      "Fallback instructions",
    );
    const coolDownAr = resolveBlockDisplayCopy(
      "ar",
      "stroke-ulrf-v1-session-1-cool-down",
      "Fallback",
      "English fallback instructions",
    );
    assert.equal(coolDownEn.phaseLabel, "Cool-down");
    assert.ok(coolDownEn.instructions.toLowerCase().includes("supported"));
    assert.equal(coolDownAr.instructions, "أعد ذراعك ببطء إلى وضع مريح ومدعوم.");
    assert.ok(!coolDownAr.instructions.includes("English"));
  });

  it("returns simplified Arabic D1 patient title", () => {
    const d1Ar = resolveBlockDisplayCopy(
      "ar",
      "stroke-ulrf-v1-session-1-d1-diagonal-reach",
      "Fallback",
      "Fallback",
    );
    assert.equal(d1Ar.title, "الوصول القطري D1");
    assert.equal(d1Ar.instructions, "اتبع الضوء على المسار القطري وتحرك بسلاسة وضمن مدى مريح.");
  });

  it("falls back to provided title and instructions for unknown blocks", () => {
    const copy = resolveBlockDisplayCopy("en", "unknown-block", "Custom title", "Custom instructions");
    assert.equal(copy.title, "Custom title");
    assert.equal(copy.instructions, "Custom instructions");
  });

  it("identifies warm-up and cool-down block ids", () => {
    assert.equal(isWarmUpBlock("stroke-ulrf-v1-session-1-warm-up"), true);
    assert.equal(isCoolDownBlock("stroke-ulrf-v1-session-1-cool-down"), true);
    assert.equal(isWarmUpBlock("stroke-ulrf-v1-session-1-reach-the-light"), false);
  });
});
