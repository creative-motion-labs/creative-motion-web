/**
 * Run: npx tsx --test app/clinician/shoulder-abduction-reach-ml-capture-lab/page.test.ts
 *
 * Slice 1.1 (2026-08-19) — regression guard for the cross-side-overlap root
 * cause. This page's `start()` handler is what a real live-capture session
 * calls, and it cannot be exercised as a pure function (it drives a real
 * camera + MediaPipe + React state) — matching the established pattern
 * elsewhere in this codebase for this class of lifecycle bug
 * (`orchestrator-cv-session-core.test.ts`'s "resolves therapeutic side from
 * session block scan, not blocks[0] only" test), this asserts the FIX is
 * present directly in the component's source rather than mounting it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const PAGE_PATH = join(
  process.cwd(),
  "app/clinician/shoulder-abduction-reach-ml-capture-lab/page.tsx",
);

describe("no simultaneous cross-side recording", () => {
  it("start() calls stop() before constructing a new detector, so one physical time interval can never be observed by two live detector instances at once", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    const startBody = source.slice(source.indexOf("const start = useCallback"), source.indexOf("], [side, sink, stop]"));
    assert.ok(startBody.length > 0, "expected to find the start() callback body");
    // stop() must be called BEFORE `new ShoulderAbductionReachPoseDetector`.
    const stopCallIndex = startBody.indexOf("stop();");
    const constructorIndex = startBody.indexOf("new ShoulderAbductionReachPoseDetector");
    assert.ok(stopCallIndex >= 0, "start() must call stop() unconditionally");
    assert.ok(constructorIndex > stopCallIndex, "stop() must run before a new detector is constructed");
  });

  it("the side and participant controls are disabled while a session is running", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    const controlsSection = source.slice(source.indexOf("Participant ID:"), source.indexOf("</div>\n      {running"));
    assert.match(controlsSection, /disabled=\{running\}/);
  });

  it("the Start button is disabled while already running", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    assert.match(source, /onClick=\{start\}\s+disabled=\{starting \|\| running\}/);
  });
});
