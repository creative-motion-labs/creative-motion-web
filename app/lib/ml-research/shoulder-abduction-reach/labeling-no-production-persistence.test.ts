/**
 * RASQ ML bridge, First Labeling Slice (2026-08-19) — guards that the
 * labeling slice never touches production persistence, mirroring
 * `no-production-persistence.test.ts`'s checks on the capture slice.
 *
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/labeling-no-production-persistence.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const LABELING_FILES = [
  "app/lib/ml-research/shoulder-abduction-reach/label-schema.ts",
  "app/lib/ml-research/shoulder-abduction-reach/capture-reader.ts",
  "app/lib/ml-research/shoulder-abduction-reach/local-label-writer.ts",
  "app/lib/ml-research/shoulder-abduction-reach/label-reader.ts",
  "app/lib/ml-research/shoulder-abduction-reach/label-client.ts",
  "app/lib/ml-research/shoulder-abduction-reach/skeleton-replay.ts",
  "app/api/dev/ml-research/shoulder-abduction-reach-label/route.ts",
];

describe("labeling slice — no production persistence", () => {
  for (const relativePath of LABELING_FILES) {
    it(`${relativePath} never queries cv_session_metrics or imports a Supabase client`, () => {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      assert.doesNotMatch(source, /from\(["']cv_session_metrics["']\)/);
      assert.doesNotMatch(source, /@supabase\/supabase-js/);
      assert.doesNotMatch(source, /createClient/);
    });
  }

  it("the labeling API route refuses to run outside development (GET and POST)", () => {
    const source = readFileSync(
      join(process.cwd(), "app/api/dev/ml-research/shoulder-abduction-reach-label/route.ts"),
      "utf8",
    );
    assert.match(source, /NODE_ENV\s*!==\s*["']development["']/);
    assert.match(source, /export async function GET/);
    assert.match(source, /export async function POST/);
  });

  it("the labeling API route rejects forbidden video/image-shaped payload keys", () => {
    const source = readFileSync(
      join(process.cwd(), "app/api/dev/ml-research/shoulder-abduction-reach-label/route.ts"),
      "utf8",
    );
    assert.match(source, /video\|image/);
  });

  it("the labeling lab page refuses to render outside development", () => {
    const source = readFileSync(
      join(process.cwd(), "app/clinician/shoulder-abduction-reach-ml-labeling-lab/page.tsx"),
      "utf8",
    );
    assert.match(source, /NODE_ENV\s*!==\s*["']development["']/);
  });

  it("capture-reader.ts redacts simulationCondition, derivedFeatures, and participantId by construction", () => {
    const source = readFileSync(
      join(process.cwd(), "app/lib/ml-research/shoulder-abduction-reach/capture-reader.ts"),
      "utf8",
    );
    // The redaction function must not pass these fields through to its return shape.
    assert.doesNotMatch(source, /simulationCondition:\s*record/);
    assert.doesNotMatch(source, /derivedFeatures:\s*record/);
    assert.doesNotMatch(source, /participantId:\s*record/);
  });

  it("cv-forbidden-keys.ts (the production guard) is untouched by this slice", () => {
    const source = readFileSync(join(process.cwd(), "app/lib/cv/cv-forbidden-keys.ts"), "utf8");
    assert.match(source, /landmarks/i);
    assert.match(source, /video/i);
  });
});
