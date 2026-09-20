#!/usr/bin/env -S npx tsx
/**
 * Shoulder Abduction Reach — dev-only capture inspection utility.
 * RASQ ML bridge, Slice 1 (2026-08-19).
 *
 * Prints a human-readable summary of every repetition captured in one (or
 * more) local JSONL file(s) written by the ML research capture pipeline —
 * no production UI, this is a dev script only.
 *
 * Usage:
 *   npx tsx scripts/ml-research/inspect-shoulder-abduction-capture.ts \
 *     dev-data/rasq-ml/shoulder-abduction/<devSessionId>.jsonl [more files...]
 */
import { readFileSync } from "node:fs";
import { computeCapturedAngleTrace } from "@/app/lib/ml-research/shoulder-abduction-reach/derived-features";
import type { ShoulderAbductionReachRepCaptureRecord } from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";

function formatAngleTrace(trace: (number | null)[]): string {
  const rounded = trace.map((angle) => (angle === null ? "·" : Math.round(angle).toString()));
  const MAX_SHOWN = 24;
  if (rounded.length <= MAX_SHOWN) return rounded.join(",");
  const step = Math.ceil(rounded.length / MAX_SHOWN);
  return rounded.filter((_, i) => i % step === 0).join(",") + ` (sampled every ${step} frames)`;
}

function inspectRecord(record: ShoulderAbductionReachRepCaptureRecord): void {
  const { context, frames, derivedFeatures } = record;
  const angleTrace = computeCapturedAngleTrace(frames, context.side);

  console.log(`\n${context.repetitionId}`);
  console.log(`  side:                    ${context.side}`);
  console.log(`  participant:             ${context.participantId}`);
  console.log(`  simulationCondition:     ${context.simulationCondition ?? "(none)"}`);
  console.log(`  captureSchemaVersion:    ${context.captureSchemaVersion}`);
  console.log(`  featureSchemaVersion:    ${context.featureSchemaVersion}`);
  console.log(`  frames:                  ${frames.length}`);
  console.log(`  duration:                ${derivedFeatures.movementDurationMs} ms`);
  console.log(
    `  tracking quality:       ${derivedFeatures.trackingQuality.framesWithUsableAngle}/${derivedFeatures.trackingQuality.framesTotal}` +
      ` usable (${
        derivedFeatures.trackingQuality.usableFrameRatio === null
          ? "n/a"
          : `${Math.round(derivedFeatures.trackingQuality.usableFrameRatio * 100)}%`
      })` +
      `; min core-joint visibility: ${derivedFeatures.trackingQuality.minCoreJointVisibility?.toFixed(3) ?? "n/a"}`,
  );
  console.log(
    `  peak shoulder angle (2D estimate): ${derivedFeatures.peakShoulderAngleDegrees ?? "n/a"} deg`,
  );
  console.log(`  peak angular velocity:   ${derivedFeatures.peakAngularVelocityDegPerSec?.toFixed(1) ?? "n/a"} deg/s`);
  console.log(
    `  peak normalized trunk drift ratio: ${derivedFeatures.peakNormalizedTrunkDriftRatio?.toFixed(4) ?? "n/a"}`,
  );
  console.log(`  shoulder-angle trace:    ${formatAngleTrace(angleTrace)}`);
}

function main(): void {
  const filePaths = process.argv.slice(2);
  if (filePaths.length === 0) {
    console.error("Usage: npx tsx scripts/ml-research/inspect-shoulder-abduction-capture.ts <file.jsonl> [...]");
    process.exit(1);
  }

  let totalReps = 0;
  for (const filePath of filePaths) {
    const lines = readFileSync(filePath, "utf8").split("\n").filter((line) => line.trim().length > 0);
    console.log(`\n=== ${filePath} (${lines.length} repetition${lines.length === 1 ? "" : "s"}) ===`);
    for (const line of lines) {
      const record = JSON.parse(line) as ShoulderAbductionReachRepCaptureRecord;
      inspectRecord(record);
      totalReps += 1;
    }
  }
  console.log(`\nTotal repetitions inspected: ${totalReps}`);
}

main();
