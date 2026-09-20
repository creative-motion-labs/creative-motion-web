import type { StrokeQuestionnaireSubmission, StrokeResponse } from "./stroke-questionnaire-schema";
import { isNonambulatory } from "./stroke-branch-engine";

export type StrokeModuleSuggestion = {
  id:
    | "upper_limb_motor_screen"
    | "sit_to_stand"
    | "gait_observation"
    | "timed_up_and_go"
    | "functional_reach"
    | "single_leg_stance"
    | "mini_squat";
  label: string;
  disposition: "CONSIDER" | "DEFER_PENDING_SAFETY_REVIEW";
  rationale: string;
};

function value(responses: Record<string, StrokeResponse>, id: string): string {
  const raw = responses[id]?.rawValue;
  return Array.isArray(raw) ? raw.join(",") : raw ?? "";
}

function reportsDifficulty(responses: Record<string, StrokeResponse>, ids: string[]): boolean {
  return ids.some((id) =>
    ["some_difficulty", "much_difficulty", "unable", "yes"].includes(value(responses, id)),
  );
}

export function routeStrokeRasqModules(
  submission: Pick<StrokeQuestionnaireSubmission, "responses" | "safetyState">,
): StrokeModuleSuggestion[] {
  const { responses, safetyState } = submission;
  const suggestions: StrokeModuleSuggestion[] = [];
  const disposition =
    safetyState === "PASS" ? "CONSIDER" : "DEFER_PENDING_SAFETY_REVIEW";
  const add = (
    id: StrokeModuleSuggestion["id"],
    label: string,
    rationale: string,
  ) => {
    if (!suggestions.some((item) => item.id === id)) {
      suggestions.push({ id, label, disposition, rationale });
    }
  };

  if (
    reportsDifficulty(responses, [
      "ul_reaching_forward",
      "ul_overhead_reach",
      "ul_reaching_behind",
      "ul_lifting",
      "ul_carrying",
      "ul_hand_opening",
      "ul_hand_closing",
      "ul_grasp",
      "ul_cup_bottle_hold",
      "ul_release",
      "ul_utensils_eating",
      "ul_grooming",
      "ul_dressing",
      "ul_writing",
      "ul_phone_use",
      "ul_movement_control",
      "ul_movement_accuracy",
    ])
  ) {
    add(
      "upper_limb_motor_screen",
      "Upper-Limb Motor Screen / Remote Upper-Limb Battery",
      "Patient- or caregiver-reported upper-limb functional difficulty.",
    );
  }

  if (reportsDifficulty(responses, ["mb_transfer_chair_rise"])) {
    add("sit_to_stand", "Sit-to-Stand", "Reported chair-rise or transfer difficulty.");
  }

  if (
    !isNonambulatory(responses) &&
    (reportsDifficulty(responses, [
      "mb_walking_turning_difficulty",
      "mb_foot_catching_dragging",
    ]) ||
      !["", "none"].includes(value(responses, "mb_walking_aid_use")))
  ) {
    add(
      "gait_observation",
      "Gait Observation",
      "Reported walking, turning, foot-catching/dragging, or walking-aid use.",
    );
  }

  if (
    !isNonambulatory(responses) &&
    value(responses, "mb_integrated_rise_walk_turn_sit") === "yes"
  ) {
    add(
      "timed_up_and_go",
      "Timed Up and Go",
      "Reported difficulty with the integrated rise, walk, turn, and sit sequence; safety review is required before testing.",
    );
  }

  const independentStanding = value(responses, "mb_independent_standing") === "yes";
  if (
    independentStanding &&
    value(responses, "mb_standing_reach_balance_concern") === "yes"
  ) {
    add(
      "functional_reach",
      "Functional Reach",
      "Reported standing reach/balance concern with independent standing reported; therapist must confirm standing safety.",
    );
  }

  // SLS is intentionally never routed from falls alone. It is only a higher-level
  // option when independent standing and no current balance concern are reported.
  if (
    independentStanding &&
    value(responses, "mb_standing_reach_balance_concern") === "no" &&
    !isNonambulatory(responses)
  ) {
    add(
      "single_leg_stance",
      "Single-Leg Stance",
      "Higher-level assessment option only after therapist review.",
    );
  }

  if (
    independentStanding &&
    reportsDifficulty(responses, ["mb_transfer_chair_rise"]) &&
    !isNonambulatory(responses)
  ) {
    add(
      "mini_squat",
      "Mini Squat",
      "Independent standing is reported and lower-limb loading/control review may be relevant.",
    );
  }

  return suggestions.slice(0, 4);
}

export function strokeModuleSuggestionText(suggestion: StrokeModuleSuggestion): string {
  if (suggestion.disposition === "DEFER_PENDING_SAFETY_REVIEW") {
    return `Defer pending safety review: ${suggestion.label}.`;
  }
  return `Consider for therapist review: ${suggestion.label}, if clinically appropriate.`;
}
