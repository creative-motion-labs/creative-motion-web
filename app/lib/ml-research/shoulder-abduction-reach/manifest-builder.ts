/**
 * Shoulder Abduction Reach — dev-only manifest build orchestration (node-only).
 * RASQ ML bridge, Slice 4 (2026-08-20).
 *
 * The one seam that goes disk → assembler: reads the named sessions' raw
 * capture and label lines, then hands them to the pure assembler. Read-only on
 * research source data; persisting a manifest is a separate, explicit step
 * (`manifest-writer.ts`).
 */

import {
  assembleShoulderAbductionReachManifest,
  evaluateShoulderAbductionReachManifestIntegrity,
  type ManifestIntegrityVerdict,
} from "./manifest-assembly";
import { readShoulderAbductionManifestSessionInputs } from "./manifest-source-reader";
import type { ShoulderAbductionReachResearchManifest } from "./manifest-schema";

export type BuiltShoulderAbductionReachManifest = {
  manifest: ShoulderAbductionReachResearchManifest;
  integrity: ManifestIntegrityVerdict;
};

/** Builds a manifest for an EXPLICIT list of dev session ids. Writes nothing. */
export async function buildShoulderAbductionReachManifest(
  devSessionIds: readonly string[],
): Promise<BuiltShoulderAbductionReachManifest> {
  const sessions = await readShoulderAbductionManifestSessionInputs(devSessionIds);
  const manifest = assembleShoulderAbductionReachManifest(sessions);
  return { manifest, integrity: evaluateShoulderAbductionReachManifestIntegrity(manifest.diagnostics) };
}
