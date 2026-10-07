/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/movement-focus-anatomy-asset.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { MOVEMENT_FOCUS_ANATOMY_SRC } from "@/app/components/patient/remote-upper-limb-battery/MovementFocusAnatomyCard";

describe("remote upper-limb movement focus anatomy asset", () => {
  it("commits the muscle focus image under public/images/rasq/", () => {
    assert.equal(MOVEMENT_FOCUS_ANATOMY_SRC, "/images/rasq/upper-limb-muscle-focus.png");
    const relative = MOVEMENT_FOCUS_ANATOMY_SRC.replace(/^\//, "");
    const absolute = join(process.cwd(), "public", relative);
    assert.ok(existsSync(absolute), `missing file: public/${relative}`);
    assert.ok(statSync(absolute).size > 10_000);
    const buf = readFileSync(absolute);
    assert.ok(
      buf.length >= 8 &&
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47,
      "expected PNG file signature",
    );
    // IHDR color type byte: 4 = grayscale+alpha, 6 = RGBA
    assert.ok(buf.length >= 26 && (buf[25] === 4 || buf[25] === 6), "expected PNG alpha (color type 4 or 6)");
  });
});
