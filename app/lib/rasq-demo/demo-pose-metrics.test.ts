/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-pose-metrics.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDemoTrackingQuality, ingestDemoPoseSample, createEmptyDemoPoseSample } from "./demo-pose-metrics";

describe("demo pose metrics", () => {
  it("formats tracking quality only with enough frames", () => {
    assert.equal(formatDemoTrackingQuality(createEmptyDemoPoseSample()), null);
    const sample = ingestDemoPoseSample(createEmptyDemoPoseSample(), {
      framesWithPose: 40,
      framesTotal: 50,
      trackingQuality: "good",
    });
    assert.match(formatDemoTrackingQuality(sample)!, /80%/);
  });
});
