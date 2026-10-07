/**
 * Gait walking observation pose detector camera startup regressions.
 * Run: npx tsx --test app/lib/cv/gait-walking-observation-pose-detector.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const DETECTOR_SOURCE_PATH = join(
  process.cwd(),
  "app/lib/cv/gait-walking-observation-pose-detector.ts",
);

function readDetectorSource(): string {
  return readFileSync(DETECTOR_SOURCE_PATH, "utf8");
}

describe("GaitWalkingObservationPoseDetector camera startup", () => {
  it("defines detachVideoPauseHandler and uses it in stop()", () => {
    const source = readDetectorSource();
    assert.match(source, /private detachVideoPauseHandler\(\): void/);
    assert.match(source, /stop\(\): void \{[\s\S]*?this\.detachVideoPauseHandler\(\)/);
  });

  it("detaches the pause handler before attaching a new listener in start()", () => {
    const source = readDetectorSource();
    const cameraBlock = source.slice(
      source.indexOf('this.initPhase = "camera"'),
      source.indexOf("this.previewActive = true"),
    );
    assert.match(cameraBlock, /this\.detachVideoPauseHandler\(\)/);
    assert.match(
      cameraBlock,
      /if \(!this\.previewActive \|\| video\.paused\) \{[\s\S]*?void video\.play\(\)\.catch/,
    );
    assert.doesNotMatch(cameraBlock, /if \(this\.previewActive && video\.paused\)/);
  });

  it("uses waitForDecodedVideoFrames instead of startVideoPlayback for camera startup", () => {
    const source = readDetectorSource();
    assert.match(source, /waitForDecodedVideoFrames/);
    assert.doesNotMatch(source, /startVideoPlayback/);
  });

  it("imports waitForDecodedVideoFrames from patient-camera-stream", () => {
    const source = readDetectorSource();
    assert.match(
      source,
      /from "@\/app\/lib\/cv\/patient-camera-stream"[\s\S]*?waitForDecodedVideoFrames/,
    );
  });
});
