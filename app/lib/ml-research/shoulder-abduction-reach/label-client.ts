/**
 * Shoulder Abduction Reach — dev-only browser fetch helpers for labeling.
 * RASQ ML bridge, First Labeling Slice (2026-08-19).
 *
 * Mirrors `dev-capture-sink.ts`'s `postDevRepCaptureRecord` client-fetch
 * convention. Browser-only — do not import from a Node context.
 */

import type { ShoulderAbductionCaptureSessionSummary, ShoulderAbductionReachRepForLabeling } from "./capture-reader";
import type { ShoulderAbductionReachLabelForRater, ShoulderAbductionReachLabelSubmission } from "./label-schema";

const LABEL_ENDPOINT = "/api/dev/ml-research/shoulder-abduction-reach-label";

export async function fetchLabelingSessions(): Promise<{
  ok: boolean;
  sessions: ShoulderAbductionCaptureSessionSummary[];
  error?: string;
}> {
  const response = await fetch(LABEL_ENDPOINT);
  const body = (await response.json().catch(() => ({}))) as {
    sessions?: ShoulderAbductionCaptureSessionSummary[];
    error?: string;
  };
  return { ok: response.ok, sessions: body.sessions ?? [], error: body.error };
}

/**
 * `raterId` is required — the API route only ever returns the labels
 * belonging to this exact rater, never anyone else's (structural
 * enforcement of rater independence; see the route's doc comment).
 *
 * Labels come back as the rater-facing projection, without `participantId`.
 */
export async function fetchSessionForLabeling(
  devSessionId: string,
  raterId: string,
): Promise<{
  ok: boolean;
  reps: ShoulderAbductionReachRepForLabeling[];
  labels: ShoulderAbductionReachLabelForRater[];
  error?: string;
}> {
  const response = await fetch(
    `${LABEL_ENDPOINT}?devSessionId=${encodeURIComponent(devSessionId)}&raterId=${encodeURIComponent(raterId)}`,
  );
  const body = (await response.json().catch(() => ({}))) as {
    reps?: ShoulderAbductionReachRepForLabeling[];
    labels?: ShoulderAbductionReachLabelForRater[];
    error?: string;
  };
  return { ok: response.ok, reps: body.reps ?? [], labels: body.labels ?? [], error: body.error };
}

/**
 * `record` is deliberately the submission shape — no `participantId`,
 * `labelSchemaVersion`, `datasetVersion`, or `labeledAtMs` — those are stamped server-side.
 */
export async function postShoulderAbductionReachLabel(
  record: ShoulderAbductionReachLabelSubmission,
): Promise<{ ok: boolean; filePath?: string; error?: string }> {
  const response = await fetch(LABEL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
  const body = (await response.json().catch(() => ({}))) as { filePath?: string; error?: string };
  return { ok: response.ok, ...body };
}
