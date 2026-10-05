import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  RASQ_DEMO_PNF_D1_ILLUSTRATION,
  RASQ_DEMO_REACH_TO_RIGHT_ILLUSTRATION,
} from "./demo-exercise-illustrations";

describe("RASQ demo exercise illustration assets", () => {
  it("commits WebP guides under public/images/rasq-demo/", () => {
    for (const asset of [RASQ_DEMO_REACH_TO_RIGHT_ILLUSTRATION, RASQ_DEMO_PNF_D1_ILLUSTRATION]) {
      const filePath = path.join(process.cwd(), "public", asset.src.replace(/^\//, ""));
      assert.ok(fs.existsSync(filePath), `missing ${filePath}`);
      assert.ok(fs.statSync(filePath).size > 8_000, `${asset.src} appears truncated`);
    }
  });

  it("uses descriptive alt text for accessibility", () => {
    assert.match(RASQ_DEMO_REACH_TO_RIGHT_ILLUSTRATION.alt, /right arm/i);
    assert.match(RASQ_DEMO_PNF_D1_ILLUSTRATION.alt, /diagonal/i);
  });
});
