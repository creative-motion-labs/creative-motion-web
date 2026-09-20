import type { InteractiveShoulderOutcomeReportRow } from "@/app/lib/interactive-shoulder/movement-outcome-persistence";

export type PatientInteractiveShoulderProgressSession = {
  id: string;
  completedAt: string;
  painAfter: number | null;
  effortScore: number | null;
};

export type PatientInteractiveShoulderProgressResponse = {
  sessions: PatientInteractiveShoulderProgressSession[];
};

export type InteractiveShoulderProgressSessionLogRow = {
  plan_session_id: string | null;
  pain_score: number | null;
  effort_score: number | null;
  completed_at: string;
};

export function buildPatientInteractiveShoulderProgressSessions(
  outcomes: readonly Pick<
    InteractiveShoulderOutcomeReportRow,
    "id" | "plan_session_id" | "created_at"
  >[],
  logs: readonly InteractiveShoulderProgressSessionLogRow[],
): PatientInteractiveShoulderProgressSession[] {
  const logsByPlanSessionId = new Map<
    string,
    { painAfter: number | null; effortScore: number | null; completedAt: string }
  >();

  for (const log of logs) {
    if (!log.plan_session_id) continue;
    logsByPlanSessionId.set(log.plan_session_id, {
      painAfter: log.pain_score,
      effortScore: log.effort_score,
      completedAt: log.completed_at,
    });
  }

  return [...outcomes]
    .sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )
    .map((outcome) => {
      const joined = outcome.plan_session_id
        ? logsByPlanSessionId.get(outcome.plan_session_id)
        : undefined;

      return {
        id: outcome.id,
        completedAt: joined?.completedAt ?? outcome.created_at,
        painAfter: joined?.painAfter ?? null,
        effortScore: joined?.effortScore ?? null,
      };
    });
}

export type PatientShoulderProgressPoint = {
  sessionId: string;
  sessionLabel: string;
  completedAt: string;
  painAfter: number | null;
  effortScore: number | null;
};

export function buildPatientShoulderProgressPointsFromSessions(
  sessions: readonly PatientInteractiveShoulderProgressSession[],
): PatientShoulderProgressPoint[] {
  return sessions.map((session, index) => ({
    sessionId: session.id,
    sessionLabel: `Session ${index + 1}`,
    completedAt: session.completedAt,
    painAfter: session.painAfter,
    effortScore: session.effortScore,
  }));
}

export function filterInteractiveShoulderOutcomeRowsToPlan(
  rows: readonly InteractiveShoulderOutcomeReportRow[],
  planId: string | null,
): InteractiveShoulderOutcomeReportRow[] {
  if (!planId) return [...rows];
  return rows.filter((row) => row.plan_id === planId);
}
