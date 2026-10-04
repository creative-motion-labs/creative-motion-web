/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-battery-scope.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execSync } from "node:child_process";

describe("demo polish scope", () => {
  it("does not modify Remote Upper-Limb Battery paths on this branch", () => {
    let diff = "";
    try {
      diff = execSync("git diff --name-only upstream/dev...HEAD", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      diff = execSync("git diff --name-only HEAD~20...HEAD", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    }
    const lines = diff
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const batteryTouches = lines.filter(
      (line) =>
        line.includes("remote-upper-limb-battery") &&
        !line.includes("extract-battery-payload") &&
        !line.includes("movement-focus-anatomy") &&
        !line.includes("MovementFocusAnatomyCard") &&
        !line.includes("battery-camera-preview-mirror") &&
        !line.includes("RemoteUpperLimbBatterySession"),
    );
    assert.deepEqual(
      batteryTouches,
      [],
      `unexpected battery changes: ${batteryTouches.join(", ")}`,
    );
  });
});
