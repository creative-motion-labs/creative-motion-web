import {
  STROKE_QUESTIONS,
  type StrokeQuestionDefinition,
  type StrokeResponse,
  type StrokeSafetyState,
  type StrokeSectionId,
} from "./stroke-questionnaire-schema";

export type StrokeScreenDefinition = {
  id: string;
  sectionId: StrokeSectionId;
  title: { en: string; ar: string };
  questionIds: string[];
  phase: "core" | "tailored";
};

function scalar(response: StrokeResponse | undefined): string {
  if (!response) return "";
  return Array.isArray(response.rawValue) ? response.rawValue.join(",") : response.rawValue;
}

function isYes(responses: Record<string, StrokeResponse>, id: string): boolean {
  return scalar(responses[id]) === "yes";
}

function values(responses: Record<string, StrokeResponse>, id: string): string[] {
  const rawValue = responses[id]?.rawValue;
  if (Array.isArray(rawValue)) return rawValue;
  return rawValue ? [rawValue] : [];
}

function hasAny(valuesToCheck: string[], candidates: string[]): boolean {
  return candidates.some((candidate) => valuesToCheck.includes(candidate));
}

function goalCorpus(responses: Record<string, StrokeResponse>): string {
  return [
    scalar(responses.goal_primary),
    scalar(responses.goal_second),
    scalar(responses.goal_third),
    scalar(responses.goal_most_important_change),
  ]
    .join(" ")
    .toLowerCase();
}

const ARABIC_UPPER_LIMB_GOAL =
  /(?:^|[\s،])(ال)?(?:ذراع|يد|كتف|وصول|إمساك|كوب|كتابة|هاتف|لبس|ملابس|أكل|عناية)(?:ي|ه|ها)?(?=$|[\s،.])/;

export function resolveStrokeSafetyState(
  responses: Record<string, StrokeResponse>,
): StrokeSafetyState {
  if (
    isYes(responses, "sg_sudden_new_neurological_change") ||
    isYes(responses, "sg_chest_pain_or_severe_breathlessness") ||
    isYes(responses, "sg_recent_fall_with_injury")
  ) {
    return "URGENT_ESCALATION";
  }
  if (
    isYes(responses, "sg_gradual_functional_worsening") ||
    scalar(responses.sg_other_safety_concern).trim()
  ) {
    return "REQUIRES_CLINICIAN_REVIEW";
  }
  const requiredSafetyQuestions = [
    "sg_sudden_new_neurological_change",
    "sg_chest_pain_or_severe_breathlessness",
    "sg_recent_fall_with_injury",
    "sg_gradual_functional_worsening",
  ];
  if (
    requiredSafetyQuestions.some(
      (id) => scalar(responses[id]) !== "no",
    )
  ) {
    return "REQUIRES_CLINICIAN_REVIEW";
  }
  return "PASS";
}

export function isNonambulatory(responses: Record<string, StrokeResponse>): boolean {
  return scalar(responses.mb_current_walking_status) === "nonambulatory";
}

export function shouldShowUpperLimb(
  responses: Record<string, StrokeResponse>,
): boolean {
  const explicitInvolvement = scalar(responses.sc_upper_limb_involvement);
  if (explicitInvolvement === "yes" || explicitInvolvement === "unsure") return true;

  const goals = goalCorpus(responses);
  const relevantGoal =
    /\b(arm|hand|reach|grasp|hold|release|write|dress|eat|groom|phone|cup)\b/.test(goals) ||
    ARABIC_UPPER_LIMB_GOAL.test(goals);
  const activityTrigger = hasAny(values(responses, "adl_self_care_group"), [
    "eating",
    "dressing",
    "grooming",
  ]);
  const relevantSymptom = [
    "ul_stiffness_tightness",
    "ul_movement_control",
    "ul_movement_accuracy",
    "ul_unintended_movement",
    "ul_pain",
    "ul_swelling_sensitivity",
  ].some((id) => isYes(responses, id));
  return relevantGoal || relevantSymptom || activityTrigger;
}

function upperLimbClusters(
  responses: Record<string, StrokeResponse>,
): Set<string> {
  const selected = new Set(values(responses, "ul_priority_tasks"));
  const activities = values(responses, "adl_self_care_group");
  if (activities.includes("eating")) selected.add("cup_eating");
  if (activities.includes("dressing") || activities.includes("grooming")) {
    selected.add("dressing_grooming");
  }
  const goals = goalCorpus(responses);
  if (/(reach|overhead|behind|وصول|أعلى|خلف)/.test(goals)) selected.add("reach");
  if (/(open|close|فتح|إغلاق)/.test(goals)) selected.add("hand_open_close");
  if (/(grasp|hold|release|إمساك|ترك)/.test(goals)) selected.add("grasp_release");
  if (/(cup|bottle|eat|كوب|زجاج|أكل)/.test(goals)) selected.add("cup_eating");
  if (/(dress|groom|ملابس|لبس|عناية)/.test(goals)) selected.add("dressing_grooming");
  if (/(write|phone|كتابة|هاتف)/.test(goals)) selected.add("writing_phone");
  return selected;
}

function screen(
  id: string,
  sectionId: StrokeSectionId,
  en: string,
  ar: string,
  questionIds: string[],
  phase: "core" | "tailored",
): StrokeScreenDefinition {
  return {
    id,
    sectionId,
    title: { en, ar },
    questionIds,
    phase,
  };
}

/**
 * Functional-first queue. Branch screens are appended from clinically
 * meaningful core answers; progress can therefore use this queue alone.
 */
export function buildStrokeActiveScreenQueue(
  responses: Record<string, StrokeResponse>,
): StrokeScreenDefinition[] {
  const source = scalar(responses.sc_information_source);
  const activities = values(responses, "adl_self_care_group");
  const walkingStatus = scalar(responses.mb_current_walking_status);
  const nonambulatory = walkingStatus === "nonambulatory";
  const ambulatory = Boolean(walkingStatus) && !nonambulatory;
  const clusters = upperLimbClusters(responses);
  const screens: StrokeScreenDefinition[] = [
    screen(
      "safety",
      "safety_gate",
      "A short safety check",
      "فحص سلامة قصير",
      [
        "sg_sudden_new_neurological_change",
        "sg_chest_pain_or_severe_breathlessness",
        "sg_recent_fall_with_injury",
        "sg_gradual_functional_worsening",
        "sg_other_safety_concern",
      ],
      "core",
    ),
    screen(
      "context",
      "stroke_context",
      "About this stroke and rehabilitation",
      "عن السكتة والتأهيل",
      [
        "sc_information_source",
        "sc_stroke_date",
        ...(scalar(responses.sc_stroke_date) ? [] : ["sc_stroke_timing"]),
        "sc_current_rehab_setting",
        ...(source === "caregiver" || source === "patient_with_caregiver"
          ? ["sc_communication_support_needed"]
          : []),
      ],
      "core",
    ),
    screen(
      "current_function",
      "adl_participation_support",
      "What currently needs help?",
      "ما الذي يحتاج إلى مساعدة حالياً؟",
      ["adl_self_care_group"],
      "core",
    ),
    screen(
      "priority",
      "stroke_context",
      "What is most difficult now?",
      "ما هو الأصعب حالياً؟",
      ["sc_main_current_limitation", "sc_upper_limb_involvement"],
      "core",
    ),
    screen(
      "mobility_level",
      "mobility_balance_falls",
      "Current mobility level",
      "مستوى الحركة الحالي",
      ["mb_current_walking_status"],
      "core",
    ),
    ...(activities.length > 0 && !activities.includes("none")
      ? [
          screen(
            "support",
            "adl_participation_support" as const,
            "Available support",
            "الدعم المتوفر",
            ["support_caregiver_available"],
            "core" as const,
          ),
        ]
      : []),
    screen(
      "goals",
      "patient_goals",
      "What matters most to regain?",
      "ما الأكثر أهمية لاستعادته؟",
      [
        "goal_primary",
        "goal_most_important_change",
        ...(responses.goal_second ? ["goal_second"] : []),
      ],
      "core",
    ),
  ];

  if (shouldShowUpperLimb(responses)) {
    screens.push(
      screen(
        "upper_limb_priorities",
        "upper_limb_hand",
        "Choose the arm and hand activities that matter",
        "اختر أنشطة الذراع واليد المهمة",
        ["ul_priority_tasks"],
        "tailored",
      ),
    );
    if (clusters.has("reach")) {
      screens.push(
        screen(
          "upper_limb_reach",
          "upper_limb_hand",
          "Reaching",
          "الوصول",
          ["ul_reaching_forward", "ul_overhead_reach", "ul_reaching_behind"],
          "tailored",
        ),
      );
    }
    if (clusters.has("hand_open_close")) {
      screens.push(
        screen(
          "upper_limb_hand",
          "upper_limb_hand",
          "Opening and closing the hand",
          "فتح وإغلاق اليد",
          ["ul_hand_opening", "ul_hand_closing"],
          "tailored",
        ),
      );
    }
    if (clusters.has("grasp_release")) {
      screens.push(
        screen(
          "upper_limb_grasp",
          "upper_limb_hand",
          "Grasp and release",
          "الإمساك والترك",
          ["ul_grasp", "ul_release", "ul_lifting", "ul_carrying"],
          "tailored",
        ),
      );
    }
    if (clusters.has("cup_eating")) {
      screens.push(
        screen(
          "upper_limb_cup_eating",
          "upper_limb_hand",
          "Cup use and eating",
          "استخدام الكوب والأكل",
          ["ul_cup_bottle_hold", "ul_utensils_eating"],
          "tailored",
        ),
      );
    }
    if (clusters.has("dressing_grooming")) {
      screens.push(
        screen(
          "upper_limb_self_care",
          "upper_limb_hand",
          "Dressing and grooming",
          "ارتداء الملابس والعناية الشخصية",
          ["ul_dressing", "ul_grooming"],
          "tailored",
        ),
      );
    }
    if (clusters.has("writing_phone")) {
      screens.push(
        screen(
          "upper_limb_communication_tasks",
          "upper_limb_hand",
          "Writing and phone use",
          "الكتابة واستخدام الهاتف",
          ["ul_writing", "ul_phone_use"],
          "tailored",
        ),
      );
    }
    if (clusters.has("daily_use")) {
      screens.push(
        screen(
          "upper_limb_daily_use",
          "upper_limb_hand",
          "Daily use of the affected arm",
          "الاستخدام اليومي للذراع المتأثرة",
          ["ul_affected_arm_daily_use"],
          "tailored",
        ),
      );
    }
    if (clusters.has("symptoms")) {
      screens.push(
        screen(
          "upper_limb_symptoms",
          "upper_limb_hand",
          "Relevant arm or hand symptoms",
          "أعراض الذراع أو اليد المهمة",
          ["ul_symptom_screen"],
          "tailored",
        ),
      );
      if (
        values(responses, "ul_symptom_screen").some(
          (value) => value !== "none",
        )
      ) {
        screens.push(
          screen(
            "upper_limb_symptom_details",
            "upper_limb_hand",
            "How do these symptoms affect function?",
            "كيف تؤثر هذه الأعراض على الوظيفة؟",
            ["ul_symptom_details"],
            "tailored",
          ),
        );
      }
    }
  }

  if (nonambulatory) {
    screens.push(
      screen(
        "nonambulatory_transfers",
        "mobility_balance_falls",
        "Bed mobility and transfers",
        "الحركة في السرير والانتقال",
        ["mb_bed_mobility", "mb_transfer_bed_chair", "mb_transfer_assistance"],
        "tailored",
      ),
      screen(
        "nonambulatory_support",
        "mobility_balance_falls",
        "Sitting, standing, and mobility support",
        "دعم الجلوس والوقوف والحركة",
        ["mb_sitting_support", "mb_standing_support", "mb_wheelchair_support_needs"],
        "tailored",
      ),
      screen(
        "falls",
        "mobility_balance_falls",
        "Falls and near-falls",
        "السقوط وشبه السقوط",
        [
          "mb_falls_screen",
          ...(hasAny(values(responses, "mb_falls_screen"), ["fall", "near_fall"])
            ? ["mb_fall_details"]
            : []),
        ],
        "tailored",
      ),
    );
  } else if (ambulatory) {
    screens.push(
      screen(
        "walking",
        "mobility_balance_falls",
        "Walking",
        "المشي",
        [
          "mb_walking_aid_use",
          "mb_walking_turning_difficulty",
          "mb_foot_catching_dragging",
        ],
        "tailored",
      ),
    );
    if (activities.includes("transfers")) {
      screens.push(
        screen(
          "ambulatory_transfers",
          "mobility_balance_falls",
          "Transfers and rising",
          "الانتقال والنهوض",
          [
            "mb_transfer_chair_rise",
            "mb_transfer_bed_chair",
            "mb_integrated_rise_walk_turn_sit",
          ],
          "tailored",
        ),
      );
    }
    if (activities.includes("stairs")) {
      screens.push(
        screen(
          "stairs",
          "mobility_balance_falls",
          "Stairs",
          "الدرج",
          ["mb_stairs"],
          "tailored",
        ),
      );
    }
    if (
      walkingStatus === "outdoor" ||
      activities.includes("community")
    ) {
      screens.push(
        screen(
          "outdoor_mobility",
          "mobility_balance_falls",
          "Outdoor mobility",
          "الحركة خارج المنزل",
          ["mb_outdoor_walking"],
          "tailored",
        ),
      );
    }
    screens.push(
      screen(
        "falls",
        "mobility_balance_falls",
        "Falls and near-falls",
        "السقوط وشبه السقوط",
        [
          "mb_falls_screen",
          ...(hasAny(values(responses, "mb_falls_screen"), ["fall", "near_fall"])
            ? ["mb_fall_details"]
            : []),
        ],
        "tailored",
      ),
    );
    if (
      activities.includes("walking") ||
      activities.includes("transfers") ||
      hasAny(values(responses, "mb_falls_screen"), ["fall", "near_fall"])
    ) {
      screens.push(
        screen(
          "standing_balance",
          "mobility_balance_falls",
          "Standing balance",
          "توازن الوقوف",
          ["mb_independent_standing", "mb_standing_reach_balance_concern"],
          "tailored",
        ),
      );
    }
  }

  screens.push(
    screen(
      "symptom_screen",
      "sensation_fatigue_pain",
      "Symptoms affecting function",
      "الأعراض المؤثرة على الوظيفة",
      ["sfp_functional_symptoms"],
      "tailored",
    ),
  );
  const functionalSymptoms = values(responses, "sfp_functional_symptoms");
  if (functionalSymptoms.includes("sensation")) {
    screens.push(
      screen(
        "sensation_details",
        "sensation_fatigue_pain",
        "Sensation details",
        "تفاصيل الإحساس",
        ["sfp_left_side_inattention_reported", "sfp_other_symptoms"],
        "tailored",
      ),
    );
  }
  if (functionalSymptoms.includes("fatigue")) {
    screens.push(
      screen(
        "fatigue_impact",
        "sensation_fatigue_pain",
        "Fatigue impact",
        "تأثير التعب",
        ["sfp_fatigue_impact"],
        "tailored",
      ),
    );
  }
  if (
    functionalSymptoms.includes("fatigue") &&
    ["some_difficulty", "much_difficulty", "unable"].includes(
      scalar(responses.sfp_fatigue_impact),
    )
  ) {
    screens.push(
      screen(
        "fatigue_details",
        "sensation_fatigue_pain",
        "Fatigue impact",
        "تأثير التعب",
        ["sfp_fatigue_details"],
        "tailored",
      ),
    );
  }
  if (functionalSymptoms.includes("pain")) {
    screens.push(
      screen(
        "pain_details",
        "sensation_fatigue_pain",
        "Pain affecting activity",
        "الألم المؤثر على النشاط",
        ["sfp_pain_location_description"],
        "tailored",
      ),
    );
  }

  screens.push(
    screen(
      "stroke_background",
      "stroke_context",
      "Additional stroke background",
      "معلومات إضافية عن السكتة",
      [
        "sc_previous_stroke_history",
        "sc_reported_stroke_type",
        ...(shouldShowUpperLimb(responses)
          ? ["sc_affected_side", "sc_pre_stroke_hand_dominance"]
          : []),
        ...(walkingStatus ? ["sc_pre_stroke_walking_status"] : []),
        ...(activities.length > 0 && !activities.includes("none")
          ? ["sc_pre_stroke_adl_assistance"]
          : []),
      ],
      "tailored",
    ),
  );

  if (
    nonambulatory ||
    activities.some((activity) =>
      ["meal_prep", "household", "community", "work_education", "other"].includes(activity),
    )
  ) {
    screens.push(
      screen(
        "support_details",
        "adl_participation_support",
        "Equipment and participation support",
        "معدات ودعم المشاركة",
        ["support_devices_equipment", "support_additional_details"],
        "tailored",
      ),
    );
  }
  const activeScreens = screens.filter((item) => item.questionIds.length > 0);
  if (!isYes(responses, "sc_communication_support_needed")) {
    return activeScreens;
  }
  return activeScreens.flatMap((item) =>
    item.id === "safety" || item.questionIds.length === 1
      ? [item]
      : item.questionIds.map((questionId, index) => ({
          ...item,
          id: `${item.id}_${index + 1}`,
          questionIds: [questionId],
        })),
  );
}

export function countActiveStrokeQuestions(
  responses: Record<string, StrokeResponse>,
): number {
  return new Set(
    buildStrokeActiveScreenQueue(responses).flatMap((item) => item.questionIds),
  ).size;
}

export function visibleStrokeSections(
  responses: Record<string, StrokeResponse>,
): StrokeSectionId[] {
  const sections: StrokeSectionId[] = ["safety_gate", "stroke_context"];
  if (shouldShowUpperLimb(responses)) sections.push("upper_limb_hand");
  sections.push(
    "mobility_balance_falls",
    "sensation_fatigue_pain",
    "adl_participation_support",
    "patient_goals",
  );
  return sections;
}

export function isStrokeQuestionVisible(
  question: StrokeQuestionDefinition,
  responses: Record<string, StrokeResponse>,
): boolean {
  return buildStrokeActiveScreenQueue(responses).some((item) =>
    item.questionIds.includes(question.id),
  );
}

export function visibleStrokeQuestions(
  sectionId: StrokeSectionId,
  responses: Record<string, StrokeResponse>,
): StrokeQuestionDefinition[] {
  return STROKE_QUESTIONS.filter(
    (question) =>
      question.sectionId === sectionId && isStrokeQuestionVisible(question, responses),
  );
}

export function buildStrokeBranchTrace(
  responses: Record<string, StrokeResponse>,
): string[] {
  const trace: string[] = [`SAFETY_${resolveStrokeSafetyState(responses)}`];
  if (!shouldShowUpperLimb(responses)) trace.push("UPPER_LIMB_SKIPPED");
  if (isNonambulatory(responses)) trace.push("NONAMBULATORY_WALKING_BRANCH_SKIPPED");
  if (
    hasAny(values(responses, "mb_falls_screen"), ["fall", "near_fall"])
  ) {
    trace.push("FALL_DETAILS_OPENED");
  }
  if (!values(responses, "sfp_functional_symptoms").includes("pain")) {
    trace.push("PAIN_DETAILS_SKIPPED");
  }
  if (isYes(responses, "sc_communication_support_needed")) {
    trace.push("COMMUNICATION_SUPPORT_RECOMMENDED");
  }
  return trace;
}
