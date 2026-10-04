/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-anatomy-asset.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const DEMO_MUSCLE_IMAGE = "upper-limb-muscles-front.png";

describe("RASQ demo anatomy asset", () => {
  it("commits the upper-limb muscle image under public/images/rasq-demo/", () => {
    const filePath = path.join(process.cwd(), "public", "images", "rasq-demo", DEMO_MUSCLE_IMAGE);
    assert.ok(fs.existsSync(filePath), `missing ${filePath}`);
    assert.ok(fs.statSync(filePath).size > 10_000, "image file appears empty or truncated");
  });
});
