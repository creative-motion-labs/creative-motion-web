/**
 * Run: npx tsx --test app/lib/session-orchestrator/measured-sample-extraction.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractPeakAngleSampleDegrees,
  extractReactionTimeSampleMs,
} from "./measured-sample-extraction";

describe("measured-sample-extraction", () => {
  it("preserves finite non-negative reactionTimeMs values", () => {
    assert.equal(extractReactionTimeSampleMs(420), 420);
    assert.equal(extractReactionTimeSampleMs(0), 0);
  });

  it("rejects missing or invalid reactionTimeMs without fabricating samples", () => {
    assert.equal(extractReactionTimeSampleMs(undefined), null);
    assert.equal(extractReactionTimeSampleMs(Number.NaN), null);
    assert.equal(extractReactionTimeSampleMs(-1), null);
    assert.equal(extractReactionTimeSampleMs(Number.POSITIVE_INFINITY), null);
  });

  it("preserves finite peakAngleDegrees values from rep metrics", () => {
    assert.equal(extractPeakAngleSampleDegrees({ peakAngleDegrees: 82.5 }), 82.5);
    assert.equal(extractPeakAngleSampleDegrees({ peakAngleDegrees: 0 }), 0);
  });

  it("rejects missing or invalid peakAngleDegrees without fabricating samples", () => {
    assert.equal(extractPeakAngleSampleDegrees(undefined), null);
    assert.equal(extractPeakAngleSampleDegrees({}), null);
    assert.equal(extractPeakAngleSampleDegrees({ peakAngleDegrees: null }), null);
    assert.equal(extractPeakAngleSampleDegrees({ peakAngleDegrees: Number.NaN }), null);
  });
});
