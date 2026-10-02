/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-camera-preview-mirror.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  BATTERY_MIRRORED_CAMERA_PREVIEW_TRANSFORM,
  withBatteryMirroredCameraPreviewDraw,
} from "./battery-camera-preview-mirror";
import { resolveBatteryPrescribedSideForPatientDisplay } from "./battery-prescribed-side";
import { BLAZEPOSE_SIDE_INDICES } from "./battery-tracking";

const ROOT = process.cwd();
const CAMERA_SESSION = join(ROOT, "app/lib/remote-upper-limb-battery/battery-camera-session.ts");
const SESSION_UI = join(ROOT, "app/components/patient/RemoteUpperLimbBatterySession.tsx");

describe("battery camera preview mirror", () => {
  it("uses scaleX(-1) presentation constant", () => {
    assert.equal(BATTERY_MIRRORED_CAMERA_PREVIEW_TRANSFORM, "scaleX(-1)");
  });

  it("applies horizontal mirror transform around preview draw only", () => {
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
    } as CanvasRenderingContext2D;

    withBatteryMirroredCameraPreviewDraw(ctx, 640, () => {
      calls.push("draw");
    });

    assert.deepEqual(calls, ["save", "translate:640,0", "scale:-1,1", "draw", "restore"]);
  });

  it("mirrors video and overlay together while processors receive raw landmarks", () => {
    const source = readFileSync(CAMERA_SESSION, "utf8");
    const mirrorStart = source.indexOf("withBatteryMirroredCameraPreviewDraw(ctx,");
    assert.ok(mirrorStart >= 0);
    const mirrorClose = source.indexOf("});", mirrorStart);
    const processCall = source.indexOf("this.processFrame(landmarks", mirrorStart);
    assert.ok(mirrorClose >= 0 && processCall > mirrorClose);
    const mirrorBlock = source.slice(mirrorStart, mirrorClose);
    assert.match(mirrorBlock, /drawImage\(video/);
    assert.match(mirrorBlock, /drawUpperLimbArmMotionGuidanceOverlay/);
    assert.equal(mirrorBlock.includes("processFrame"), false);
  });

  it("does not mirror prescribed side resolution when preview mirror flag is set", () => {
    assert.equal(resolveBatteryPrescribedSideForPatientDisplay("left", true), "left");
    assert.equal(resolveBatteryPrescribedSideForPatientDisplay("right", true), "right");
  });

  it("highlights the prescribed BlazePose side indices without swapping for mirror", () => {
    const source = readFileSync(CAMERA_SESSION, "utf8");
    assert.equal(source.includes("motionGuidanceSide"), true);
    assert.equal(source.includes("1 - "), false);
    assert.equal(BLAZEPOSE_SIDE_INDICES.left.shoulder !== BLAZEPOSE_SIDE_INDICES.right.shoulder, true);
  });

  it("keeps session chrome outside the mirrored canvas draw path", () => {
    const ui = readFileSync(SESSION_UI, "utf8");
    assert.match(ui, /ref=\{canvasRef\}/);
    assert.equal(ui.includes("BATTERY_MIRRORED_CAMERA_PREVIEW_TRANSFORM"), false);
    assert.match(ui, /Motion guidance active/);
    assert.equal(ui.includes("scaleX(-1)"), false);
  });
});
