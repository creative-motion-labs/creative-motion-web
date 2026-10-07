/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-public-copy.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  RASQ_DEMO_EXPERIENCE_HEADING,
  RASQ_DEMO_EXPERIENCE_KICKER,
  RASQ_DEMO_MOVEMENT_DISCLAIMER,
  RASQ_DEMO_PAGE_TITLE,
} from "./demo-copy";
import { RASQ_DEMO_VOICE_CUE_MANIFEST } from "./demo-voice-manifest";

const DEMO_UI_FILES = [
  "app/components/rasq-demo/RasqDemoExperience.tsx",
  "app/components/rasq-demo/RasqDemoMovementAnalysisSummary.tsx",
  "app/components/rasq-demo/RasqDemoUpperLimbMuscleFocusPanel.tsx",
  "app/demo/page.tsx",
];

describe("public demo copy", () => {
  it("uses interactive movement demo branding and disclaimer without Prototype wording", () => {
    assert.equal(RASQ_DEMO_EXPERIENCE_KICKER, "RASQ INTERACTIVE MOVEMENT DEMO");
    assert.equal(RASQ_DEMO_EXPERIENCE_HEADING, "Interactive movement demonstration");
    assert.equal(RASQ_DEMO_PAGE_TITLE, "RASQ Interactive Movement Demo | Creative Motion");
    assert.match(RASQ_DEMO_MOVEMENT_DISCLAIMER, /Movement demo for demonstration purposes only/i);
    assert.doesNotMatch(RASQ_DEMO_MOVEMENT_DISCLAIMER, /prototype/i);
    assert.doesNotMatch(RASQ_DEMO_EXPERIENCE_KICKER, /prototype/i);
    for (const value of Object.values(RASQ_DEMO_VOICE_CUE_MANIFEST)) {
      assert.doesNotMatch(value.script, /prototype/i);
    }
  });

  it("does not expose Prototype in demo UI sources", () => {
    for (const relative of DEMO_UI_FILES) {
      const filePath = path.join(process.cwd(), relative);
      const source = fs.readFileSync(filePath, "utf8");
      assert.doesNotMatch(source, /Prototype/i, `${relative} must not show Prototype to users`);
    }
  });

  it("keeps anatomy panel captions for the muscle image", () => {
    const panelPath = path.join(process.cwd(), "app/components/rasq-demo/RasqDemoUpperLimbMuscleFocusPanel.tsx");
    const source = fs.readFileSync(panelPath, "utf8");
    assert.match(source, /Upper-limb muscle focus/);
    assert.match(source, /Deltoid • Biceps • Triceps • Forearm/);
    assert.match(source, /right arm highlighted/i);
  });

  it("shows anatomy beside preview for entire live orchestrator session", () => {
    const orchestratorPath = path.join(
      process.cwd(),
      "app/components/rasq-demo/RasqDemoOrchestratorSession.tsx",
    );
    const source = fs.readFileSync(orchestratorPath, "utf8");
    assert.match(source, /liveMovementBlock/);
    assert.match(source, /RasqDemoUpperLimbMuscleFocusPanel/);
    assert.doesNotMatch(source, /isReachBlock \? <RasqDemoUpperLimbMuscleFocusPanel/);
  });
});
