/**
 * Completed catalog sessions that have NO saved movement outcome.
 *
 * Why this exists: the patient-reported completion (effort, pain) and the camera-derived
 * movement outcome are two separate saves. If the second one fails -- or the feature was off
 * when the session was done -- the session shows as completed, yet no motion analysis exists
 * for it. Without this, the clinician would see either nothing or an empty state that reads
 * "nothing recorded yet", which hides the fact that a session WAS done.
 *
 * Rules:
 *   - Count only what is provable from existing rows: a completed catalog-sourced plan
 *     session with no outcome row. Nothing is inferred, estimated or back-filled.
 *   - The movement data for such a session cannot be reconstructed from the completion
 *     record, and this module never tries to.
 */

export type CatalogPlanSessionStatusRow = {
  id: string;
  status: string;
};

export function countCompletedCatalogSessionsWithoutOutcome(
  catalogSessions: readonly CatalogPlanSessionStatusRow[],
  outcomePlanSessionIds: ReadonlySet<string>,
): number {
  let count = 0;
  for (const session of catalogSessions) {
    if (session.status === "completed" && !outcomePlanSessionIds.has(session.id)) count += 1;
  }
  return count;
}

export const COMPLETED_WITHOUT_OUTCOME_TITLE = "Completed without saved movement data";

/** Null when every completed session has its movement outcome. */
export function describeCompletedWithoutOutcomeNotice(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const sessions = count === 1 ? "1 completed session" : `${count} completed sessions`;
  const verb = count === 1 ? "has" : "have";
  return (
    `${sessions} in this plan ${verb} no saved movement outcome. ` +
    "The patient's own pain and effort report was recorded, but the camera-derived movement data " +
    "was not saved for " +
    (count === 1 ? "this session" : "these sessions") +
    " and cannot be reconstructed."
  );
}
