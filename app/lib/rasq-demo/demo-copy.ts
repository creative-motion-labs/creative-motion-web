export const RASQ_DEMO_MOVEMENT_DISCLAIMER =
  "Movement demo for demonstration purposes only — not a medical diagnosis.";

/** @deprecated Use RASQ_DEMO_MOVEMENT_DISCLAIMER — kept for import stability in tests. */
export const RASQ_DEMO_PROTOTYPE_DISCLAIMER = RASQ_DEMO_MOVEMENT_DISCLAIMER;

export const RASQ_DEMO_EXPERIENCE_KICKER = "RASQ INTERACTIVE MOVEMENT DEMO";

export const RASQ_DEMO_EXPERIENCE_HEADING = "Interactive movement demonstration";

export const RASQ_DEMO_PAGE_TITLE = "RASQ Interactive Movement Demo | Creative Motion";

export const RASQ_DEMO_NO_RAW_VIDEO_NOTICE =
  "Camera processing runs in your browser. RASQ does not store raw video from this demo by default.";

export const RASQ_DEMO_MAIN_GOAL_OPTIONS = [
  { id: "sports", label: "Sports performance" },
  { id: "mobility", label: "Mobility and daily activity" },
  { id: "rehabilitation", label: "Rehabilitation support" },
] as const;

export type RasqDemoMainGoalId = (typeof RASQ_DEMO_MAIN_GOAL_OPTIONS)[number]["id"];
