/**
 * RASQ ML bridge, Slice 4 (2026-08-20) — guards that the manifest slice stays
 * local research tooling: no production persistence, no browser exposure, no
 * raw media, and no training/consensus decisions. Mirrors the posture of
 * `no-production-persistence.test.ts` and
 * `labeling-no-production-persistence.test.ts` for the new files.
 *
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/manifest-no-production-persistence.test.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveManifestJsonPath } from "./manifest-writer";

const MANIFEST_SLICE_FILES = [
  "app/lib/ml-research/shoulder-abduction-reach/manifest-schema.ts",
  "app/lib/ml-research/shoulder-abduction-reach/manifest-assembly.ts",
  "app/lib/ml-research/shoulder-abduction-reach/manifest-source-reader.ts",
  "app/lib/ml-research/shoulder-abduction-reach/manifest-builder.ts",
  "app/lib/ml-research/shoulder-abduction-reach/manifest-writer.ts",
  "scripts/ml-research/assemble-shoulder-abduction-manifest.ts",
];

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

/** `--untracked` so a not-yet-committed file is still searched; git grep exits 1 when nothing matches. */
function gitGrepFiles(pattern: string): string[] {
  try {
    return execFileSync(
      "git",
      ["grep", "-l", "--untracked", "-E", pattern, "--", "app", "scripts"],
      { cwd: process.cwd(), encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

describe("manifest slice — no production persistence", () => {
  for (const relativePath of MANIFEST_SLICE_FILES) {
    it(`${relativePath} never queries cv_session_metrics or imports a Supabase client`, () => {
      const source = readSource(relativePath);
      assert.doesNotMatch(source, /from\(["']cv_session_metrics["']\)/);
      assert.doesNotMatch(source, /@supabase\/supabase-js/);
      assert.doesNotMatch(source, /@supabase\/ssr/);
      assert.doesNotMatch(source, /createClient/);
    });
  }

  it("writes manifests only under the gitignored dev-data directory", () => {
    const manifestPath = resolveManifestJsonPath("gitignore-check-fixture");
    assert.match(manifestPath, /[\\/]dev-data[\\/]rasq-ml[\\/]shoulder-abduction-manifests[\\/]/);
    const ignored = execFileSync("git", ["check-ignore", manifestPath], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(ignored.trim().length > 0, true);
  });

  it("does not add any API route or page that could serve a manifest", () => {
    // The one existing labeling route must not have gained a manifest code path,
    // and no new route/page may import the manifest modules.
    const routeSource = readSource(
      "app/api/dev/ml-research/shoulder-abduction-reach-label/route.ts",
    );
    assert.doesNotMatch(routeSource, /manifest/i);

    const importers = gitGrepFiles("manifest-(builder|assembly|writer|source-reader|schema)");
    assert.ok(importers.length > 0, "expected the manifest modules to be found by git grep");
    for (const importer of importers) {
      assert.equal(
        importer.startsWith("app/lib/ml-research/shoulder-abduction-reach/") ||
          importer.startsWith("scripts/ml-research/"),
        true,
        `${importer} must not reference the manifest modules — they are local research tooling only`,
      );
      assert.doesNotMatch(importer, /^app\/api\//);
      assert.doesNotMatch(importer, /page\.tsx$/);
    }
  });

  it("declares no raw video/image/frame-payload field in the manifest schema", () => {
    const source = readSource("app/lib/ml-research/shoulder-abduction-reach/manifest-schema.ts");
    assert.doesNotMatch(source, /\b(video|image|frameBlob|base64|dataUrl|joints|landmark)\s*:/);
  });

  it("declares no training-eligibility, split, consensus, or prediction field", () => {
    for (const relativePath of MANIFEST_SLICE_FILES) {
      const source = readSource(relativePath);
      assert.doesNotMatch(
        source,
        /\b(trainingEligible|trainSplit|datasetSplit|consensusLabel|majorityLabel|referenceLabel|severityScore|predictedLabel|classWeight)\b/,
      );
    }
  });

  it("leaves the production CV guard and detector untouched by this slice", () => {
    const forbiddenKeys = readSource("app/lib/cv/cv-forbidden-keys.ts");
    assert.match(forbiddenKeys, /landmarks/i);
    assert.match(forbiddenKeys, /video/i);

    const changedFiles = execFileSync("git", ["diff", "--name-only", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const forbidden of [
      "app/lib/cv/shoulder-abduction-reach-pose-detector.ts",
      "app/lib/cv/shoulder-abduction-reach-compensation.ts",
      "app/lib/cv/cv-forbidden-keys.ts",
    ]) {
      assert.equal(
        changedFiles.includes(forbidden),
        false,
        `${forbidden} must not be modified by the manifest slice`,
      );
    }
  });
});
