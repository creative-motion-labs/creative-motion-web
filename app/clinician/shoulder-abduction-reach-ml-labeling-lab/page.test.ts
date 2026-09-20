/**
 * Run: npx tsx --test app/clinician/shoulder-abduction-reach-ml-labeling-lab/page.test.ts
 *
 * Source-level regression guards for the labeling page — matching the
 * established pattern used for the capture lab page (mounting a full React
 * component isn't part of this codebase's test setup, so lifecycle/UI
 * guarantees are asserted against the component's own source instead).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const PAGE_PATH = join(
  process.cwd(),
  "app/clinician/shoulder-abduction-reach-ml-labeling-lab/page.tsx",
);

describe("dev-only guard", () => {
  it("refuses to render outside development", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    assert.match(source, /NODE_ENV\s*!==\s*["']development["']/);
  });
});

describe("therapist-blind requirement", () => {
  it("never imports or references a derived-feature or compensation-flag value", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    for (const forbidden of [
      "peakNormalizedTrunkDriftRatio",
      "peakShoulderAngleDegrees",
      "peakAngularVelocityDegPerSec",
      "compensationFlagged",
      "derivedFeatures",
    ]) {
      assert.doesNotMatch(source, new RegExp(forbidden));
    }
  });

  it("states the blindness guarantee to the rater in the page copy", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    assert.match(source, /never shows the rule-based compensation flag/);
  });
});

describe("movement-plane guidance", () => {
  it("includes neutral guidance distinguishing abduction from flexion", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    assert.match(source, /Movement-plane guidance/);
    assert.match(source, /Wrong movement plane/);
    assert.match(source, /Not reviewable/i);
  });
});

describe("label taxonomy", () => {
  it("offers all three compensation severities and all three exclusion flags, mutually exclusive via one radio group", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    assert.match(source, /SHOULDER_ABDUCTION_REACH_COMPENSATION_LABELS\.map/);
    assert.match(source, /SHOULDER_ABDUCTION_REACH_EXCLUSION_FLAGS\.map/);
    // Both option sets render under the same `name="labelChoice"` group, which is what
    // makes them mutually exclusive as native radio buttons rather than two independent
    // toggles that could both end up checked.
    const nameOccurrences = source.match(/name="labelChoice"/g) ?? [];
    assert.equal(nameOccurrences.length, 2, "expected exactly two labelChoice radio groups (compensation + exclusion)");
  });

  it("disables submit until a label choice AND a confidence level are both chosen", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    assert.match(source, /canSubmit\s*=\s*labelChoice !== null && raterConfidence !== null/);
  });
});

describe("rater independence", () => {
  it("requires a non-empty raterId before loading any repetitions", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    assert.match(source, /if \(devSessionId && raterId\.trim\(\)\) void loadSession/);
  });

  it("passes raterId through to fetchSessionForLabeling rather than fetching all raters' labels", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    assert.match(source, /fetchSessionForLabeling\(id, rater\)/);
  });
});

describe("default session", () => {
  it("defaults to the validated retest session for this first slice", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    assert.match(source, /DEFAULT_LABELING_SESSION_ID = "dev-session-2026-08-18T23-18-39-738Z"/);
  });
});

describe("replay controls", () => {
  it("provides play, pause, restart, step, and scrub controls", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    assert.match(source, /Play/);
    assert.match(source, /Pause/);
    assert.match(source, /Restart/);
    assert.match(source, /step/);
    assert.match(source, /type="range"/);
  });

  it("draws frames strictly from resolveFrameIndexForElapsedMs — no interpolation between captured frames", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    assert.match(source, /resolveFrameIndexForElapsedMs\(currentRep\.frames, elapsedMs\)/);
  });
});

describe("technical quality badge", () => {
  it("renders the review-caution badge only from the redacted rep's own reviewCaution flag", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    assert.match(source, /currentRep\.reviewCaution/);
    assert.match(source, /REVIEW WITH CAUTION/);
  });
});

describe("anatomical guide overlay", () => {
  it("draws the skeleton first, then layers the guide overlay on top, every time the frame/toggle/midline changes", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    const drawEffect = source.slice(
      source.indexOf("// Draw whenever the elapsed time"),
      source.indexOf("}, [elapsedMs, currentRep, showGuides, staticMidline]);") + 50,
    );
    const skeletonCallIndex = drawEffect.indexOf("drawShoulderAbductionSkeletonFrame(");
    const overlayCallIndex = drawEffect.indexOf("drawAnatomicalGuideOverlay(");
    assert.ok(skeletonCallIndex >= 0 && overlayCallIndex >= 0, "expected both draw calls in the frame-draw effect");
    assert.ok(overlayCallIndex > skeletonCallIndex, "the guide overlay must be drawn after (on top of) the skeleton");
  });

  it("computes the static midline once per repetition via useMemo keyed on currentRep, not per frame", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    assert.match(source, /const staticMidline[\s\S]{0,200}useMemo\(\s*\(\) => \(currentRep \? computeInitialBodyMidline\(currentRep\.frames\) : null\),\s*\[currentRep\],/);
  });

  it("defaults the 'Show anatomical guides' toggle to ON", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    assert.match(source, /const \[showGuides, setShowGuides\] = useState\(true\)/);
    assert.match(source, /Show anatomical guides/);
  });

  it("never sends the guide-visibility preference to the API or includes it in a submitted label", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    const submissionBlock = source.slice(
      source.indexOf("const submission: ShoulderAbductionReachLabelSubmission"),
      source.indexOf("const result = await postShoulderAbductionReachLabel"),
    );
    assert.doesNotMatch(submissionBlock, /showGuides/);
  });

  it("adds no orientation prediction, movement-plane classification, or new label option", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    for (const forbidden of [
      "FRONT_ALIGNED",
      "ROTATED_LEFT",
      "ROTATED_RIGHT",
      "ORIENTATION_UNCERTAIN",
      "orientationEstimate",
      "movementPlane",
    ]) {
      assert.doesNotMatch(source, new RegExp(forbidden));
    }
  });

  it("adds no compensation score, percentage, or threshold anywhere in the page", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    for (const forbidden of ["compensationScore", "trunkDeviationDeg", "driftThreshold", "%\\}"]) {
      assert.doesNotMatch(source, new RegExp(forbidden));
    }
  });

  it("does not introduce red/green pass-fail styling for the guide overlay", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    // The guide's own color constants live in skeleton-replay.ts, not here — this just
    // guards against the page itself introducing traffic-light colors for the overlay.
    assert.doesNotMatch(source, /guideColor.*(#\s*ff0000|#\s*00ff00|red|green)/i);
  });
});
