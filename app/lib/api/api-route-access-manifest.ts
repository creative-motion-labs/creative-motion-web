/**
 * Server API route access classification (documentation + regression tests).
 *
 * A = approved-provider-only (Supabase session + approved provider)
 * B = admin-only (platform admin allowlist or approved admin role)
 * C = patient-token (token validated server-side)
 * D = intentionally public
 * E = dev-only
 */

export type ApiRouteAccessClass = "A" | "B" | "C" | "D" | "E";

export type ApiRouteAccessEntry = {
  path: string;
  class: ApiRouteAccessClass;
  /** Source file under app/api (forward slashes). */
  file: string;
};

/** Routes that must enforce approved-provider authorization before clinical/service-role use. */
export const APPROVED_PROVIDER_API_ROUTE_FILES = [
  "app/api/assemblyai/status/route.ts",
  "app/api/assemblyai/transcribe/route.ts",
  "app/api/assessments/route.ts",
  "app/api/assessments/[id]/route.ts",
  "app/api/assessments/[id]/stroke-pt-clinical-report/route.ts",
  "app/api/assessments/[id]/translate/route.ts",
  "app/api/assessments/[id]/translate-stroke-questionnaire/route.ts",
  "app/api/assessments/translate-health/route.ts",
  "app/api/clinician/ai-session-summary/route.ts",
  "app/api/clinician/ai-session-summary/approve/route.ts",
  "app/api/clinician/clinical-reviews/route.ts",
  "app/api/clinician/objective-results/route.ts",
  "app/api/clinician/patient-progress/route.ts",
  "app/api/clinician/progress-outcomes/route.ts",
  "app/api/clinician/results/route.ts",
  "app/api/clinician/stats/route.ts",
  "app/api/cv/session-metrics/route.ts",
  "app/api/health/openai/route.ts",
  "app/api/patients/route.ts",
  "app/api/patients/[id]/route.ts",
  "app/api/plans/route.ts",
  "app/api/plans/[id]/route.ts",
  "app/api/plans/catalog-programs/route.ts",
  "app/api/plans/from-catalog-program/route.ts",
  "app/api/remote-assessments/route.ts",
  "app/api/upper-limb-motor-screen/assignments/route.ts",
  "app/api/upper-limb-motor-screen/remote-links/route.ts",
  "app/api/upper-limb-motor-screen/session-results/route.ts",
  "app/api/upper-limb-motor-screen/session-results/[id]/finalize/route.ts",
] as const;

export const APPROVED_PROVIDER_SHARED_AUTH_FILES = [
  "app/lib/reports/assessment-workflow-route-auth.ts",
] as const;

export const APPROVED_PROVIDER_GUARD_MARKERS = [
  "guardApprovedProviderApiAccess",
  "requireAuthenticatedApprovedUser",
  "requireApprovedProviderSession",
  "requireClinicianSession",
  "validatePatientOwnership",
  "loadRemoteQuestionnaireAssessment",
] as const;

export const API_ROUTE_ACCESS_REGISTRY: ApiRouteAccessEntry[] = [
  ...APPROVED_PROVIDER_API_ROUTE_FILES.map((file) => ({
    path: file.replace(/^app\/api\//, "/api/").replace(/\/route\.ts$/, ""),
    class: "A" as const,
    file,
  })),
  {
    path: "/api/admin/provider-access-requests",
    class: "B",
    file: "app/api/admin/provider-access-requests/route.ts",
  },
  {
    path: "/api/auth/create-provider",
    class: "A",
    file: "app/api/auth/create-provider/route.ts",
  },
  {
    path: "/api/auth/provider-access-request",
    class: "A",
    file: "app/api/auth/provider-access-request/route.ts",
  },
  {
    path: "/api/auth/post-login-destination",
    class: "A",
    file: "app/api/auth/post-login-destination/route.ts",
  },
  { path: "/api/auth/callback", class: "D", file: "app/api/auth/callback/route.ts" },
  { path: "/api/health/supabase", class: "D", file: "app/api/health/supabase/route.ts" },
  { path: "/api/public/rasq-demo/analytics", class: "D", file: "app/api/public/rasq-demo/analytics/route.ts" },
  { path: "/api/public/rasq-demo/leads", class: "D", file: "app/api/public/rasq-demo/leads/route.ts" },
  { path: "/api/patient/validate-token", class: "C", file: "app/api/patient/validate-token/route.ts" },
  { path: "/api/patient/logs", class: "C", file: "app/api/patient/logs/route.ts" },
  { path: "/api/patient/plan", class: "C", file: "app/api/patient/plan/route.ts" },
  { path: "/api/patient/session-complete", class: "C", file: "app/api/patient/session-complete/route.ts" },
  { path: "/api/patient/movement-check", class: "C", file: "app/api/patient/movement-check/route.ts" },
  { path: "/api/patient/cv-session-metrics", class: "C", file: "app/api/patient/cv-session-metrics/route.ts" },
  { path: "/api/patient/interactive-shoulder-progress", class: "C", file: "app/api/patient/interactive-shoulder-progress/route.ts" },
  { path: "/api/patient/interactive-shoulder-outcomes", class: "C", file: "app/api/patient/interactive-shoulder-outcomes/route.ts" },
  { path: "/api/patient/assessment/[token]", class: "C", file: "app/api/patient/assessment/[token]/route.ts" },
  { path: "/api/patient/assessment/[token]/battery-results", class: "C", file: "app/api/patient/assessment/[token]/battery-results/route.ts" },
  { path: "/api/patient/assessment/[token]/session-results", class: "C", file: "app/api/patient/assessment/[token]/session-results/route.ts" },
  { path: "/api/remote-assessments/[token]", class: "C", file: "app/api/remote-assessments/[token]/route.ts" },
  { path: "/api/remote-assessments/[token]/submit", class: "C", file: "app/api/remote-assessments/[token]/submit/route.ts" },
  { path: "/api/remote-assessments/[token]/extract", class: "C", file: "app/api/remote-assessments/[token]/extract/route.ts" },
  { path: "/api/remote-assessments/[token]/transcribe", class: "C", file: "app/api/remote-assessments/[token]/transcribe/route.ts" },
  { path: "/api/remote-assessments/[token]/translate", class: "C", file: "app/api/remote-assessments/[token]/translate/route.ts" },
  { path: "/api/research/volunteer/sessions", class: "D", file: "app/api/research/volunteer/sessions/route.ts" },
  { path: "/api/research/volunteer/movement-sessions", class: "D", file: "app/api/research/volunteer/movement-sessions/route.ts" },
  { path: "/api/research/volunteer/session/complete", class: "D", file: "app/api/research/volunteer/session/complete/route.ts" },
  { path: "/api/research/volunteer/repetitions", class: "D", file: "app/api/research/volunteer/repetitions/route.ts" },
  {
    path: "/api/dev/ml-research/shoulder-abduction-reach-capture",
    class: "E",
    file: "app/api/dev/ml-research/shoulder-abduction-reach-capture/route.ts",
  },
  {
    path: "/api/dev/ml-research/shoulder-abduction-reach-label",
    class: "E",
    file: "app/api/dev/ml-research/shoulder-abduction-reach-label/route.ts",
  },
];
