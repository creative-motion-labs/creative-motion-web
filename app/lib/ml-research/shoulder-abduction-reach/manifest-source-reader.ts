/**
 * Shoulder Abduction Reach — dev-only manifest source reader (node-only).
 * RASQ ML bridge, Slice 4 (2026-08-20).
 *
 * READ-ONLY on research data: `readFile` only, no writer import, nothing that
 * can modify or rewrite a capture/label JSONL file.
 *
 * Why this exists instead of reusing the labeling readers: the existing
 * `capture-reader.ts` skips an unparsable capture line, and `label-reader.ts`
 * drops any line that fails `isValidShoulderAbductionReachLabelRecord`
 * (including a version-incompatible one) before a caller can observe it. That
 * is correct for serving a labeling UI, but for dataset assembly it would mean
 * silent research-data loss and a malformed-record count that could never be
 * anything but zero. So this module hands EVERY non-empty line to the
 * assembler as raw JSON (or as an explicit "unparsable" marker) and lets the
 * assembler classify and report it. The labeling readers' behavior is
 * deliberately left untouched.
 */

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { resolveDevSessionJsonlPath } from "./local-jsonl-writer";
import { resolveDevSessionLabelsJsonlPath } from "./local-label-writer";
import type {
  ManifestRawJsonlLine,
  ManifestSessionInput,
  ManifestSourceFileInput,
} from "./manifest-assembly";

/** Repo-relative POSIX path, so a manifest is not tied to one machine's absolute paths. */
function toRepoRelativePosixPath(absolutePath: string): string {
  return relative(process.cwd(), absolutePath).split("\\").join("/");
}

function splitNonEmptyLines(raw: string): string[] {
  return raw.split("\n").filter((line) => line.trim().length > 0);
}

async function readRawJsonlFile(absolutePath: string): Promise<ManifestSourceFileInput> {
  const relativeFilePath = toRepoRelativePosixPath(absolutePath);
  let raw: string;
  try {
    raw = await readFile(absolutePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { relativeFilePath, exists: false, lines: [] };
    }
    throw err;
  }

  const lines: ManifestRawJsonlLine[] = splitNonEmptyLines(raw).map((line, lineIndex) => {
    try {
      return { lineIndex, kind: "json", value: JSON.parse(line) as unknown };
    } catch {
      // Reported, never dropped — the assembler counts it as a malformed record.
      return { lineIndex, kind: "unparsable" };
    }
  });

  return { relativeFilePath, exists: true, lines };
}

/**
 * Reads one session's capture and label JSONL files as raw lines.
 *
 * `lineIndex` is assigned over NON-EMPTY lines only, exactly matching how
 * `capture-reader.ts` derives `sourceLineIndex` — so the locator persisted in
 * a label record means the same thing here as it did at label time.
 */
export async function readShoulderAbductionManifestSessionInput(
  devSessionId: string,
): Promise<ManifestSessionInput> {
  const [capture, labels] = await Promise.all([
    readRawJsonlFile(resolveDevSessionJsonlPath(devSessionId)),
    readRawJsonlFile(resolveDevSessionLabelsJsonlPath(devSessionId)),
  ]);
  return { devSessionId, capture, labels };
}

/**
 * Reads an EXPLICIT list of sessions. There is no directory auto-discovery on
 * purpose: the existing tests write `test-fixture-*` sessions into the same
 * real `dev-data/rasq-ml/shoulder-abduction/` directory a real capture uses,
 * so a "assemble everything on disk" mode would silently pull synthetic
 * fixtures into a research manifest. Naming the sessions makes the scope
 * auditable and is recorded in `manifest.scope.devSessionIds`.
 *
 * Duplicate ids are collapsed so a repeated `--session` argument cannot
 * double-count a session's records.
 */
export async function readShoulderAbductionManifestSessionInputs(
  devSessionIds: readonly string[],
): Promise<ManifestSessionInput[]> {
  const uniqueIds = [...new Set(devSessionIds)];
  return Promise.all(uniqueIds.map(readShoulderAbductionManifestSessionInput));
}
