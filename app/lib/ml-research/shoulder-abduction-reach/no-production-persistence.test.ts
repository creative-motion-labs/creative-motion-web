/**
 * RASQ ML bridge, Slice 1 (2026-08-19); extended for the First Labeling
 * Slice (2026-08-19) — guards that this dev-only research capture AND
 * labeling pipeline never touches production persistence, never persists
 * raw video, and stays under the gitignored dev-data directory.
 *
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/no-production-persistence.test.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveDevSessionJsonlPath } from "@/app/lib/ml-research/shoulder-abduction-reach/local-jsonl-writer";
import { resolveDevSessionLabelsJsonlPath } from "@/app/lib/ml-research/shoulder-abduction-reach/local-label-writer";

const ML_RESEARCH_FILES = [
  "app/lib/ml-research/shoulder-abduction-reach/capture-schema.ts",
  "app/lib/ml-research/shoulder-abduction-reach/rep-recorder.ts",
  "app/lib/ml-research/shoulder-abduction-reach/derived-features.ts",
  "app/lib/ml-research/shoulder-abduction-reach/local-jsonl-writer.ts",
  "app/lib/ml-research/shoulder-abduction-reach/dev-capture-sink.ts",
  "app/api/dev/ml-research/shoulder-abduction-reach-capture/route.ts",
  "app/lib/ml-research/shoulder-abduction-reach/label-schema.ts",
  "app/lib/ml-research/shoulder-abduction-reach/local-label-writer.ts",
  "app/lib/ml-research/shoulder-abduction-reach/label-reader.ts",
  "app/lib/ml-research/shoulder-abduction-reach/label-client.ts",
  "app/lib/ml-research/shoulder-abduction-reach/capture-reader.ts",
  "app/lib/ml-research/shoulder-abduction-reach/skeleton-replay.ts",
  "app/api/dev/ml-research/shoulder-abduction-reach-label/route.ts",
];

const DEV_ONLY_ROUTE_FILES = [
  "app/api/dev/ml-research/shoulder-abduction-reach-capture/route.ts",
  "app/api/dev/ml-research/shoulder-abduction-reach-label/route.ts",
];

describe("no production persistence", () => {
  for (const relativePath of ML_RESEARCH_FILES) {
    it(`${relativePath} never queries cv_session_metrics or imports a Supabase client`, () => {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      // Doc comments are allowed to name cv_session_metrics (to explain it is NOT used) —
      // what must never appear is an actual query against it or a Supabase import.
      assert.doesNotMatch(source, /from\(["']cv_session_metrics["']\)/);
      assert.doesNotMatch(source, /@supabase\/supabase-js/);
      assert.doesNotMatch(source, /createClient/);
    });
  }

  for (const relativePath of DEV_ONLY_ROUTE_FILES) {
    it(`${relativePath} refuses to run outside development`, () => {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      assert.match(source, /NODE_ENV\s*!==\s*["']development["']/);
    });
  }

  it("cv-forbidden-keys.ts (the production guard) is untouched by this slice", () => {
    // Regression: this slice must not weaken the existing production guard on
    // cv_session_metrics. It should still forbid landmark/raw-video-shaped keys.
    const source = readFileSync(join(process.cwd(), "app/lib/cv/cv-forbidden-keys.ts"), "utf8");
    assert.match(source, /landmarks/i);
    assert.match(source, /video/i);
  });

  it("the label schema type never includes a video/image-shaped field", () => {
    const source = readFileSync(
      join(process.cwd(), "app/lib/ml-research/shoulder-abduction-reach/label-schema.ts"),
      "utf8",
    );
    assert.doesNotMatch(source, /\b(video|image|frameBlob|base64|dataUrl)\s*:/);
  });

  it("capture and label JSONL paths both resolve under the gitignored dev-data directory", () => {
    const capturePath = resolveDevSessionJsonlPath("gitignore-check-fixture");
    const labelPath = resolveDevSessionLabelsJsonlPath("gitignore-check-fixture");
    assert.match(capturePath, /[\\/]dev-data[\\/]/);
    assert.match(labelPath, /[\\/]dev-data[\\/]/);

    const ignored = execFileSync("git", ["check-ignore", capturePath, labelPath], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const ignoredLines = ignored.trim().split("\n").filter(Boolean);
    assert.equal(ignoredLines.length, 2, "both the capture and label paths must be reported as gitignored");
  });
});
