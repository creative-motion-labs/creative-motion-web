/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-camera-preview-mirror.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { drawBatteryMirroredCameraPreview } from "./battery-camera-preview-mirror";
import { resolveBatteryPrescribedSideForPatientDisplay } from "./battery-prescribed-side";
import { BLAZEPOSE_SIDE_INDICES } from "./battery-tracking";

const ROOT = process.cwd();
const MIRROR_MODULE = join(ROOT, "app/lib/remote-upper-limb-battery/battery-camera-preview-mirror.ts");
const CAMERA_SESSION = join(ROOT, "app/lib/remote-upper-limb-battery/battery-camera-session.ts");
const SESSION_UI = join(ROOT, "app/components/patient/RemoteUpperLimbBatterySession.tsx");
const OVERLAY = join(ROOT, "app/lib/cv/upper-limb-arm-pose-overlay.ts");

describe("battery camera preview mirror", () => {
  it("applies exactly one horizontal mirror transform per preview draw", () => {
    const mirrorSource = readFileSync(MIRROR_MODULE, "utf8");
    assert.equal(mirrorSource.match(/ctx\.scale\(-1,\s*1\)/g)?.length, 1);
    assert.equal(mirrorSource.includes("scaleX(-1)"), false);
    assert.match(mirrorSource, /ctx\.translate\(width,\s*0\)/);
    assert.match(mirrorSource, /ctx\.drawImage\(video/);
    assert.match(mirrorSource, /drawUpperLimbArmMotionGuidanceOverlay/);
  });

  it("sequences save, translate, scale, draw, restore once", () => {
    const calls: string[] = [];
    const ctx = {
      save() {
        calls.push("save");
      },
      restore() {
        calls.push("restore");
      },
      translate(x: number, y: number) {
        calls.push(`translate:${x},${y}`);
      },
      scale(x: number, y: number) {
        calls.push(`scale:${x},${y}`);
      },
      drawImage() {
        calls.push("drawImage");
      },
    } as CanvasRenderingContext2D;

    const video = {} as HTMLVideoElement;
    const canvas = { width: 640, height: 480 } as HTMLCanvasElement;

    drawBatteryMirroredCameraPreview(ctx, video, canvas, undefined, null);

    assert.deepEqual(calls, [
      "save",
      "translate:640,0",
      "scale:-1,1",
      "drawImage",
      "restore",
    ]);
  });

  it("maps raw image-space x to screen-right under a single mirror", () => {
    const width = 640;
    const imageSpaceX = 0.2 * width;
    const screenX = width - imageSpaceX;
    assert.equal(screenX, 0.8 * width);
  });

  it("mirrors video and overlay together while processors receive raw landmarks", () => {
    const source = readFileSync(CAMERA_SESSION, "utf8");
    const detectIdx = source.indexOf("detectForVideo(video");
    const drawIdx = source.indexOf("drawBatteryMirroredCameraPreview(");
    const processIdx = source.indexOf("this.processFrame(landmarks");
    assert.ok(detectIdx >= 0 && drawIdx > detectIdx);
    assert.ok(processIdx > drawIdx);

    assert.ok(drawIdx > detectIdx);
    assert.ok(processIdx > drawIdx);
    assert.equal(source.includes("scaleX(-1)"), false);
    assert.match(readFileSync(MIRROR_MODULE, "utf8"), /drawUpperLimbArmMotionGuidanceOverlay/);
  });

  it("does not mirror prescribed side resolution when preview mirror flag is set", () => {
    assert.equal(resolveBatteryPrescribedSideForPatientDisplay("left", true), "left");
    assert.equal(resolveBatteryPrescribedSideForPatientDisplay("right", true), "right");
  });

  it("highlights the prescribed BlazePose side indices without swapping for mirror", () => {
    const source = readFileSync(CAMERA_SESSION, "utf8");
    assert.equal(source.includes("motionGuidanceSide"), true);
    assert.equal(BLAZEPOSE_SIDE_INDICES.left.shoulder !== BLAZEPOSE_SIDE_INDICES.right.shoulder, true);
  });

  it("keeps arm overlay geometry in raw landmark space (no presentation flip in overlay)", () => {
    const overlay = readFileSync(OVERLAY, "utf8");
    assert.equal(overlay.includes("1 - lm.x"), false);
    assert.equal(overlay.includes("1 - point.x"), false);
    assert.equal(overlay.includes("scaleX(-1)"), false);
  });

  it("keeps session chrome and preview container free of CSS mirror transforms", () => {
    const ui = readFileSync(SESSION_UI, "utf8");
    assert.match(ui, /ref=\{canvasRef\}/);
    assert.match(ui, /ref=\{videoRef\}/);
    assert.match(ui, /Motion guidance active/);

    const previewBlock = ui.slice(
      ui.indexOf("aspect-[4/3]"),
      ui.indexOf("MovementFocusAnatomyCard"),
    );
    assert.equal(previewBlock.includes("scaleX(-1)"), false);
    assert.equal(previewBlock.includes("transform:"), false);
    assert.equal(previewBlock.includes("BATTERY_MIRRORED"), false);
  });
});
