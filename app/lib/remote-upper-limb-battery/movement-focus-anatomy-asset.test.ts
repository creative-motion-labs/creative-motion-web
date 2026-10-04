/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/movement-focus-anatomy-asset.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
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
  });
});
