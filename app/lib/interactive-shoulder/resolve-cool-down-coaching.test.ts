/**
 * Run: npx tsx --test app/lib/interactive-shoulder/resolve-cool-down-coaching.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveCoolDownCoachingMessage,
  resolveCoolDownCoachingPhase,
} from "./resolve-cool-down-coaching";

const SAFETY_EN =
  "If you feel shoulder pain or cannot control the arm comfortably, stop and support the arm.";
const SAFETY_AR =
  "إذا شعرت بألم في الكتف أو لم تستطع التحكم بالذراع براحة، توقف وضع الذراع على المسند.";

describe("resolveCoolDownCoachingMessage", () => {
  it("rotates Arabic supported-return coaching copy by elapsed time", () => {
    assert.equal(resolveCoolDownCoachingMessage("ar", 2), "اكتمل التمرين.");
    assert.equal(
      resolveCoolDownCoachingMessage("ar", 10),
      `أعد ذراعك ببطء إلى وضع مريح ومدعوم. لا تُجبر الحركة.\n${SAFETY_AR}`,
    );
    assert.equal(
      resolveCoolDownCoachingMessage("ar", 25),
      `دع ذراعك يستقر بشكل مريح على المسند.\n${SAFETY_AR}`,
    );
    assert.equal(
      resolveCoolDownCoachingMessage("ar", 35),
      `أبقِ ذراعك مدعومًا وتنفس بهدوء.\n${SAFETY_AR}`,
    );
  });

  it("rotates English supported-return coaching copy by elapsed time", () => {
    assert.equal(resolveCoolDownCoachingMessage("en", 2), "Exercise complete.");
    assert.equal(
      resolveCoolDownCoachingMessage("en", 10),
      `Slowly bring your arm back to a comfortable, supported position. Do not force the movement.\n${SAFETY_EN}`,
    );
    assert.equal(
      resolveCoolDownCoachingMessage("en", 25),
      `Let your arm rest comfortably on the support.\n${SAFETY_EN}`,
    );
    assert.equal(
      resolveCoolDownCoachingMessage("en", 35),
      `Keep your arm supported and breathe normally.\n${SAFETY_EN}`,
    );
  });

  it("does not include removed return-to-neutral or lowering copy", () => {
    for (const elapsed of [0, 5, 15, 30, 60, 85]) {
      const en = resolveCoolDownCoachingMessage("en", elapsed);
      const ar = resolveCoolDownCoachingMessage("ar", elapsed);
      assert.ok(!en.toLowerCase().includes("lower your arm"));
      assert.ok(!en.toLowerCase().includes("relax your shoulder"));
      assert.ok(!ar.includes("اخفض ذراعك"));
      assert.ok(!ar.includes("أرخِ كتفك"));
    }
  });
});

describe("resolveCoolDownCoachingPhase", () => {
  it("maps elapsed seconds to supported-return phases", () => {
    assert.equal(resolveCoolDownCoachingPhase(2), "complete");
    assert.equal(resolveCoolDownCoachingPhase(10), "protectedReturn");
    assert.equal(resolveCoolDownCoachingPhase(25), "restOnSupport");
    assert.equal(resolveCoolDownCoachingPhase(35), "supportedStillness");
    assert.equal(resolveCoolDownCoachingPhase(80), "supportedStillness");
  });
});
