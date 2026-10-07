/**
 * Run: npx tsx --test app/lib/interactive-shoulder/resolve-shoulder-live-hud-metrics.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createEmptyPatternInteractionMetrics } from "./motion-patterns/pattern-lifecycle";
import { resolveShoulderLiveHudMetrics } from "./resolve-shoulder-live-hud-metrics";
import { createEmptyShoulderInteractionMetrics } from "./types";

const FORBIDDEN_EN_REP_WORDING = ["Measured repetitions", "Reps completed", "Repetitions completed"];
const FORBIDDEN_AR_REP_WORDING = ["التكرارات المقاسة", "التكرارات المكتملة"];

function assertNoRepWording(metrics: Array<{ label: string; value: string }>): void {
  const serialized = JSON.stringify(metrics);
  for (const phrase of [...FORBIDDEN_EN_REP_WORDING, ...FORBIDDEN_AR_REP_WORDING]) {
    assert.ok(!serialized.includes(phrase), `unexpected repetition wording: "${phrase}"`);
  }
}

describe("resolveShoulderLiveHudMetrics — patient live metrics", () => {
  it("Reach the Light EN shows interaction targets only, not measured repetitions", () => {
    const metrics = resolveShoulderLiveHudMetrics({
      language: "en",
      feedbackMode: "reach-the-light-targets",
      targetInteraction: {
        ...createEmptyShoulderInteractionMetrics(),
        targetsReached: 2,
        targetsShown: 5,
      },
      patternInteraction: createEmptyPatternInteractionMetrics(),
    });

    assert.equal(metrics.length, 1);
    assert.equal(metrics[0]?.label, "Interaction targets");
    assert.equal(metrics[0]?.value, "2/5");
    assertNoRepWording(metrics);
  });

  it("Reach the Light AR shows interaction targets only, not measured repetitions", () => {
    const metrics = resolveShoulderLiveHudMetrics({
      language: "ar",
      feedbackMode: "reach-the-light-targets",
      targetInteraction: {
        ...createEmptyShoulderInteractionMetrics(),
        targetsReached: 1,
        targetsShown: 4,
      },
      patternInteraction: createEmptyPatternInteractionMetrics(),
    });

    assert.equal(metrics.length, 1);
    assert.equal(metrics[0]?.label, "أهداف التفاعل");
    assert.equal(metrics[0]?.value, "1/4");
    assertNoRepWording(metrics);
  });

  it("D1 EN shows path progress only, not measured repetitions", () => {
    const metrics = resolveShoulderLiveHudMetrics({
      language: "en",
      feedbackMode: "motion-pattern",
      targetInteraction: createEmptyShoulderInteractionMetrics(),
      patternInteraction: {
        ...createEmptyPatternInteractionMetrics(),
        patternsCompleted: 3,
        patternsShown: 6,
      },
    });

    assert.equal(metrics.length, 1);
    assert.equal(metrics[0]?.label, "Paths completed");
    assert.equal(metrics[0]?.value, "3/6");
    assertNoRepWording(metrics);
  });

  it("D1 AR shows path progress only, not measured repetitions", () => {
    const metrics = resolveShoulderLiveHudMetrics({
      language: "ar",
      feedbackMode: "motion-pattern",
      targetInteraction: createEmptyShoulderInteractionMetrics(),
      patternInteraction: {
        ...createEmptyPatternInteractionMetrics(),
        patternsCompleted: 2,
        patternsShown: 5,
      },
    });

    assert.equal(metrics.length, 1);
    assert.equal(metrics[0]?.label, "المسارات المكتملة");
    assert.equal(metrics[0]?.value, "2/5");
    assertNoRepWording(metrics);
  });

  it("EN and AR expose the same metric count for Reach and D1", () => {
    const reachEn = resolveShoulderLiveHudMetrics({
      language: "en",
      feedbackMode: "reach-the-light-targets",
      targetInteraction: createEmptyShoulderInteractionMetrics(),
      patternInteraction: createEmptyPatternInteractionMetrics(),
    });
    const reachAr = resolveShoulderLiveHudMetrics({
      language: "ar",
      feedbackMode: "reach-the-light-targets",
      targetInteraction: createEmptyShoulderInteractionMetrics(),
      patternInteraction: createEmptyPatternInteractionMetrics(),
    });
    const d1En = resolveShoulderLiveHudMetrics({
      language: "en",
      feedbackMode: "motion-pattern",
      targetInteraction: createEmptyShoulderInteractionMetrics(),
      patternInteraction: createEmptyPatternInteractionMetrics(),
    });
    const d1Ar = resolveShoulderLiveHudMetrics({
      language: "ar",
      feedbackMode: "motion-pattern",
      targetInteraction: createEmptyShoulderInteractionMetrics(),
      patternInteraction: createEmptyPatternInteractionMetrics(),
    });

    assert.equal(reachEn.length, 1);
    assert.equal(reachAr.length, 1);
    assert.equal(d1En.length, 1);
    assert.equal(d1Ar.length, 1);
  });
});

describe("resolveShoulderLiveHudMetrics — shipped HUD wiring", () => {
  it("ShoulderSessionHud uses the resolver and does not pass measured repetition props", () => {
    const hudPath = join(
      process.cwd(),
      "app/components/patient/interactive-shoulder/ShoulderSessionHud.tsx",
    );
    const source = readFileSync(hudPath, "utf8");

    assert.match(source, /resolveShoulderLiveHudMetrics/);
    assert.doesNotMatch(source, /measuredReps/);
    assert.doesNotMatch(source, /measuredRepsLabel/);
    assert.doesNotMatch(source, /repProgressLabel/);
  });

  it("OrchestratorCvSessionCore no longer passes measuredReps into the live HUD", () => {
    const corePath = join(
      process.cwd(),
      "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx",
    );
    const source = readFileSync(corePath, "utf8");

    assert.doesNotMatch(source, /measuredReps=\{measuredReps\}/);
  });
});
