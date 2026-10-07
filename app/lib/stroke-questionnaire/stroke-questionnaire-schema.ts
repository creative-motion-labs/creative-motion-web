export const STROKE_QUESTIONNAIRE_KIND = "stroke_v1" as const;
export const STROKE_QUESTIONNAIRE_VERSION = 1 as const;
export const STROKE_PATHWAY = "remote_neurorehab_intake" as const;

export type StrokeSafetyState =
  | "PASS"
  | "REQUIRES_CLINICIAN_REVIEW"
  | "URGENT_ESCALATION";

export type ClinicalProvenance =
  | "PATIENT_REPORTED"
  | "CAREGIVER_REPORTED"
  | "CLINICIAN_OBSERVED"
  | "OBJECTIVELY_MEASURED";

export type StrokeReporterRole = "patient" | "caregiver";
export type StrokeResponseMethod = "text" | "voice" | "selection";
export type StrokeTranslationStatus = "not_generated" | "review_required" | "approved";

export type StrokeResponse = {
  rawValue: string | string[];
  rawLanguage: "en" | "ar";
  responseMethod?: StrokeResponseMethod;
  provenance: Extract<ClinicalProvenance, "PATIENT_REPORTED" | "CAREGIVER_REPORTED">;
  reporterRole: StrokeReporterRole;
  clinicalEnglish?: string;
  translation?: {
    status: StrokeTranslationStatus;
    generatedAt?: string;
    approvedAt?: string;
    approvedBy?: string;
  };
};

export type StrokeSectionId =
  | "safety_gate"
  | "stroke_context"
  | "upper_limb_hand"
  | "mobility_balance_falls"
  | "sensation_fatigue_pain"
  | "adl_participation_support"
  | "patient_goals";

export type StrokeQuestionKind =
  | "short_text"
  | "long_text"
  | "single_select"
  | "multi_select"
  | "date";

export type StrokeQuestionOption = {
  value: string;
  en: string;
  ar: string;
};

export type StrokeQuestionDefinition = {
  id: string;
  sectionId: StrokeSectionId;
  kind: StrokeQuestionKind;
  en: string;
  ar: string;
  options?: StrokeQuestionOption[];
  /** Controls adaptive navigation only and is not persisted or reported. */
  navigationOnly?: boolean;
};

const yesNoUnsure: StrokeQuestionOption[] = [
  { value: "yes", en: "Yes", ar: "نعم" },
  { value: "no", en: "No", ar: "لا" },
  { value: "unsure", en: "Not sure", ar: "غير متأكد" },
];

const difficulty: StrokeQuestionOption[] = [
  { value: "no_difficulty", en: "No difficulty", ar: "لا توجد صعوبة" },
  { value: "some_difficulty", en: "Some difficulty", ar: "صعوبة بسيطة" },
  { value: "much_difficulty", en: "A lot of difficulty", ar: "صعوبة كبيرة" },
  { value: "unable", en: "Unable", ar: "غير قادر" },
  { value: "not_tried_or_na", en: "Have not tried / Not applicable", ar: "لم أحاول / لا ينطبق" },
  { value: "unsure", en: "Not sure", ar: "غير متأكد" },
];

function q(
  id: string,
  sectionId: StrokeSectionId,
  kind: StrokeQuestionKind,
  en: string,
  ar: string,
  options?: StrokeQuestionOption[],
  navigationOnly = false,
): StrokeQuestionDefinition {
  return { id, sectionId, kind, en, ar, options, navigationOnly };
}

export const STROKE_QUESTIONS: StrokeQuestionDefinition[] = [
  q("sg_sudden_new_neurological_change", "safety_gate", "single_select", "Are you having any sudden new weakness, numbness, facial droop, speech difficulty, vision change, severe dizziness, or severe new headache now?", "هل تعاني الآن من ضعف أو خدر مفاجئ جديد، أو تدلي الوجه، أو صعوبة في الكلام، أو تغير في الرؤية، أو دوخة شديدة، أو صداع شديد جديد؟", yesNoUnsure),
  q("sg_chest_pain_or_severe_breathlessness", "safety_gate", "single_select", "Are you having chest pain or severe difficulty breathing now?", "هل تعاني الآن من ألم في الصدر أو صعوبة شديدة في التنفس؟", yesNoUnsure),
  q("sg_recent_fall_with_injury", "safety_gate", "single_select", "Have you had a recent fall with a possible serious injury or been unable to get up?", "هل تعرضت لسقوط حديث مع إصابة محتملة خطيرة أو لم تتمكن من النهوض؟", yesNoUnsure),
  q("sg_gradual_functional_worsening", "safety_gate", "single_select", "Have your usual abilities gradually or generally worsened recently, without a sudden new neurological change?", "هل تراجعت قدراتك المعتادة تدريجياً أو بشكل عام مؤخراً، دون تغير عصبي مفاجئ جديد؟", yesNoUnsure),
  q("sg_other_safety_concern", "safety_gate", "long_text", "Is there another current safety concern your therapist should review?", "هل توجد مخاوف أخرى حالية تتعلق بالسلامة يجب أن يراجعها المعالج؟"),

  q("sc_information_source", "stroke_context", "single_select", "Who is providing these answers?", "من يقدم هذه الإجابات؟", [
    { value: "patient", en: "Patient", ar: "المريض" },
    { value: "caregiver", en: "Caregiver", ar: "مقدم الرعاية" },
    { value: "patient_with_caregiver", en: "Patient with caregiver assistance", ar: "المريض بمساعدة مقدم الرعاية" },
  ]),
  q("sc_stroke_date", "stroke_context", "date", "Stroke date, if known", "تاريخ السكتة الدماغية، إن كان معروفاً"),
  q("sc_stroke_timing", "stroke_context", "single_select", "If the date is uncertain, approximately when did the stroke occur?", "إذا كان التاريخ غير مؤكد، فمتى حدثت السكتة تقريباً؟", [
    { value: "under_3_months", en: "Less than 3 months ago", ar: "منذ أقل من 3 أشهر" },
    { value: "3_to_12_months", en: "3–12 months ago", ar: "منذ 3–12 شهراً" },
    { value: "over_12_months", en: "More than 12 months ago", ar: "منذ أكثر من 12 شهراً" },
    { value: "unsure", en: "Not sure", ar: "غير متأكد" },
  ]),
  q("sc_previous_stroke_history", "stroke_context", "single_select", "Has the patient had a previous stroke?", "هل تعرض المريض لسكتة دماغية سابقة؟", yesNoUnsure),
  q("sc_reported_stroke_type", "stroke_context", "single_select", "What stroke type were you told, if known?", "ما نوع السكتة الذي تم إبلاغك به، إن كان معروفاً؟", [
    { value: "ischemic", en: "Ischemic", ar: "إقفارية" },
    { value: "hemorrhagic", en: "Hemorrhagic", ar: "نزفية" },
    { value: "other", en: "Other reported type", ar: "نوع آخر تم الإبلاغ عنه" },
    { value: "unknown", en: "Not known", ar: "غير معروف" },
  ]),
  q("sc_affected_side", "stroke_context", "multi_select", "Which side does the patient identify as affected?", "أي جانب يصفه المريض بأنه متأثر؟", [
    { value: "left", en: "Left", ar: "الأيسر" },
    { value: "right", en: "Right", ar: "الأيمن" },
    { value: "both", en: "Both", ar: "كلاهما" },
    { value: "unsure", en: "Not sure", ar: "غير متأكد" },
  ]),
  q("sc_pre_stroke_hand_dominance", "stroke_context", "single_select", "Which hand was used most before the stroke?", "أي يد كانت الأكثر استخداماً قبل السكتة؟", [
    { value: "right", en: "Right", ar: "اليمنى" },
    { value: "left", en: "Left", ar: "اليسرى" },
    { value: "both", en: "Both equally", ar: "كلتاهما بالتساوي" },
    { value: "unsure", en: "Not sure", ar: "غير متأكد" },
  ]),
  q("sc_pre_stroke_walking_status", "stroke_context", "single_select", "Before the stroke, how did the patient usually move around?", "قبل السكتة، كيف كان المريض يتنقل عادة؟", [
    { value: "independent", en: "Walked independently", ar: "يمشي بشكل مستقل" },
    { value: "walking_aid", en: "Walked with an aid", ar: "يمشي باستخدام وسيلة مساعدة" },
    { value: "wheelchair", en: "Used a wheelchair", ar: "يستخدم كرسياً متحركاً" },
    { value: "assistance", en: "Needed another person's assistance", ar: "يحتاج إلى مساعدة شخص آخر" },
    { value: "unsure", en: "Not sure", ar: "غير متأكد" },
  ]),
  q("sc_pre_stroke_adl_assistance", "stroke_context", "single_select", "Before the stroke, was help needed for daily activities?", "قبل السكتة، هل كانت هناك حاجة للمساعدة في الأنشطة اليومية؟", [
    { value: "none", en: "No help", ar: "لا توجد مساعدة" },
    { value: "some", en: "Some help", ar: "بعض المساعدة" },
    { value: "much", en: "A lot of help", ar: "مساعدة كبيرة" },
    { value: "unsure", en: "Not sure", ar: "غير متأكد" },
  ]),
  q("sc_current_rehab_setting", "stroke_context", "single_select", "What is the current rehabilitation setting?", "ما هو مكان التأهيل الحالي؟", [
    { value: "inpatient", en: "Inpatient rehabilitation", ar: "تأهيل داخلي" },
    { value: "outpatient", en: "Outpatient clinic", ar: "عيادة خارجية" },
    { value: "home", en: "Home rehabilitation", ar: "تأهيل منزلي" },
    { value: "none", en: "Not currently receiving rehabilitation", ar: "لا يتلقى تأهيلاً حالياً" },
    { value: "other", en: "Other", ar: "أخرى" },
  ]),
  q("sc_main_current_limitation", "stroke_context", "long_text", "What is the main current limitation?", "ما هو التحدي أو القيد الرئيسي حالياً؟"),
  q("sc_upper_limb_involvement", "stroke_context", "single_select", "Is an arm or hand currently affected?", "هل الذراع أو اليد متأثرة حالياً؟", yesNoUnsure),
  q("sc_communication_support_needed", "stroke_context", "single_select", "Does the patient need help understanding or communicating answers?", "هل يحتاج المريض إلى مساعدة لفهم الإجابات أو التعبير عنها؟", yesNoUnsure),

  q("ul_priority_tasks", "upper_limb_hand", "multi_select", "Which arm or hand activities should we ask about?", "ما أنشطة الذراع أو اليد التي تريد أن نسأل عنها؟", [
    { value: "reach", en: "Reaching", ar: "الوصول" },
    { value: "hand_open_close", en: "Opening or closing the hand", ar: "فتح أو إغلاق اليد" },
    { value: "grasp_release", en: "Grasping or releasing objects", ar: "الإمساك بالأشياء أو تركها" },
    { value: "cup_eating", en: "Cup use or eating", ar: "استخدام الكوب أو الأكل" },
    { value: "dressing_grooming", en: "Dressing or grooming", ar: "ارتداء الملابس أو العناية الشخصية" },
    { value: "writing_phone", en: "Writing or phone use", ar: "الكتابة أو استخدام الهاتف" },
    { value: "daily_use", en: "Daily use of the affected arm", ar: "الاستخدام اليومي للذراع المتأثرة" },
    { value: "symptoms", en: "Stiffness, control, pain, or swelling", ar: "التيبس أو التحكم أو الألم أو التورم" },
  ], true),

  ...[
    ["ul_reaching_forward", "Reaching forward", "الوصول إلى الأمام"],
    ["ul_overhead_reach", "Reaching overhead", "الوصول إلى أعلى"],
    ["ul_reaching_behind", "Reaching behind the body", "الوصول خلف الجسم"],
    ["ul_lifting", "Lifting an object", "رفع جسم"],
    ["ul_carrying", "Carrying an object", "حمل جسم"],
    ["ul_hand_opening", "Opening the hand", "فتح اليد"],
    ["ul_hand_closing", "Closing the hand", "إغلاق اليد"],
    ["ul_grasp", "Grasping an object", "الإمساك بجسم"],
    ["ul_cup_bottle_hold", "Holding a cup or bottle", "إمساك كوب أو زجاجة"],
    ["ul_release", "Releasing an object", "ترك جسم"],
    ["ul_utensils_eating", "Using utensils or eating", "استخدام أدوات الطعام أو الأكل"],
    ["ul_grooming", "Grooming", "العناية الشخصية"],
    ["ul_dressing", "Dressing", "ارتداء الملابس"],
    ["ul_writing", "Writing", "الكتابة"],
    ["ul_phone_use", "Using a phone", "استخدام الهاتف"],
  ].map(([id, en, ar]) =>
    q(id, "upper_limb_hand", "single_select", `How is ${en.toLowerCase()} with the affected arm or hand?`, `كيف هي القدرة على ${ar} باستخدام الذراع أو اليد المتأثرة؟`, difficulty),
  ),
  q("ul_affected_arm_daily_use", "upper_limb_hand", "single_select", "How often is the affected arm used in daily activities?", "كم مرة يتم استخدام الذراع المتأثرة في الأنشطة اليومية؟", [
    { value: "usual", en: "About as often as usual", ar: "بالقدر المعتاد تقريباً" },
    { value: "sometimes", en: "Sometimes", ar: "أحياناً" },
    { value: "rarely", en: "Rarely", ar: "نادراً" },
    { value: "never", en: "Not used", ar: "لا تُستخدم" },
    { value: "not_applicable", en: "Not applicable", ar: "لا ينطبق" },
  ]),
  q("ul_symptom_screen", "upper_limb_hand", "multi_select", "Which arm or hand symptoms are currently relevant?", "ما أعراض الذراع أو اليد المهمة حالياً؟", [
    { value: "stiffness", en: "Stiffness or tightness", ar: "تيبس أو شد" },
    { value: "control_accuracy", en: "Movement control or accuracy", ar: "التحكم بالحركة أو دقتها" },
    { value: "unintended_movement", en: "Unintended movement", ar: "حركة غير مقصودة" },
    { value: "pain", en: "Pain", ar: "ألم" },
    { value: "swelling_sensitivity", en: "Swelling or sensitivity", ar: "تورم أو حساسية" },
    { value: "none", en: "None of these", ar: "لا شيء مما سبق" },
  ]),
  ...[
    ["ul_stiffness_tightness", "stiffness or tightness", "تيبس أو شد"],
    ["ul_movement_control", "difficulty controlling movement", "صعوبة في التحكم بالحركة"],
    ["ul_movement_accuracy", "difficulty with movement accuracy", "صعوبة في دقة الحركة"],
    ["ul_unintended_movement", "unintended movement", "حركة غير مقصودة"],
    ["ul_pain", "pain", "ألم"],
    ["ul_swelling_sensitivity", "swelling or sensitivity", "تورم أو حساسية"],
  ].map(([id, symptom, ar]) =>
    q(id, "upper_limb_hand", "single_select", `Does the patient report ${symptom} in the affected arm or hand?`, `هل يذكر المريض وجود ${ar} في الذراع أو اليد المتأثرة؟`, yesNoUnsure),
  ),
  q("ul_symptom_details", "upper_limb_hand", "long_text", "Please describe any arm or hand symptoms that matter most.", "يرجى وصف أهم أعراض الذراع أو اليد."),

  q("mb_transfer_chair_rise", "mobility_balance_falls", "single_select", "How difficult is standing up from a chair?", "ما مدى صعوبة النهوض من الكرسي؟", difficulty),
  q("mb_transfer_bed_chair", "mobility_balance_falls", "single_select", "How difficult is moving between a bed and chair?", "ما مدى صعوبة الانتقال بين السرير والكرسي؟", difficulty),
  q("mb_bed_mobility", "mobility_balance_falls", "single_select", "How difficult is moving or changing position in bed?", "ما مدى صعوبة الحركة أو تغيير الوضعية في السرير؟", difficulty),
  q("mb_transfer_assistance", "mobility_balance_falls", "single_select", "How much help is currently needed for transfers?", "ما مقدار المساعدة المطلوبة حالياً للانتقال؟", [
    { value: "none", en: "No help", ar: "لا أحتاج مساعدة" },
    { value: "supervision", en: "Supervision or someone nearby", ar: "إشراف أو وجود شخص قريب" },
    { value: "some", en: "Some physical help", ar: "بعض المساعدة الجسدية" },
    { value: "much", en: "A lot of physical help", ar: "مساعدة جسدية كبيرة" },
    { value: "unable", en: "Unable without full assistance", ar: "غير قادر دون مساعدة كاملة" },
  ]),
  q("mb_sitting_support", "mobility_balance_falls", "single_select", "What support is needed to sit safely?", "ما الدعم المطلوب للجلوس بأمان؟", [
    { value: "independent", en: "Sits independently", ar: "يجلس بشكل مستقل" },
    { value: "supervision", en: "Needs supervision", ar: "يحتاج إلى إشراف" },
    { value: "physical_support", en: "Needs physical support", ar: "يحتاج إلى دعم جسدي" },
    { value: "unable", en: "Unable to sit without full support", ar: "غير قادر على الجلوس دون دعم كامل" },
  ]),
  q("mb_standing_support", "mobility_balance_falls", "single_select", "What support is needed to stand?", "ما الدعم المطلوب للوقوف؟", [
    { value: "independent", en: "Stands independently", ar: "يقف بشكل مستقل" },
    { value: "aid_or_supervision", en: "Needs an aid or supervision", ar: "يحتاج وسيلة مساعدة أو إشرافاً" },
    { value: "physical_support", en: "Needs physical support", ar: "يحتاج إلى دعم جسدي" },
    { value: "unable", en: "Not currently standing", ar: "لا يقف حالياً" },
  ]),
  q("mb_wheelchair_support_needs", "mobility_balance_falls", "long_text", "Describe any wheelchair, positioning, or mobility support needs.", "صف أي احتياجات للكرسي المتحرك أو الوضعية أو دعم الحركة."),
  q("mb_current_walking_status", "mobility_balance_falls", "single_select", "What is the patient's current walking status?", "ما هي حالة المشي الحالية للمريض؟", [
    { value: "nonambulatory", en: "Not currently walking", ar: "لا يمشي حالياً" },
    { value: "few_steps_assisted", en: "A few steps with assistance", ar: "بضع خطوات مع المساعدة" },
    { value: "indoor", en: "Walks indoors", ar: "يمشي داخل المنزل" },
    { value: "outdoor", en: "Walks outdoors", ar: "يمشي خارج المنزل" },
    { value: "unsure", en: "Not sure", ar: "غير متأكد" },
  ]),
  q("mb_walking_turning_difficulty", "mobility_balance_falls", "single_select", "Is walking or turning difficult?", "هل المشي أو الدوران صعب؟", yesNoUnsure),
  q("mb_foot_catching_dragging", "mobility_balance_falls", "single_select", "Does the patient report the foot catching, the leg dragging, or the leg giving way while walking?", "هل يذكر المريض تعثر القدم أو جر الساق أو ضعف ثبات الساق أثناء المشي؟", yesNoUnsure),
  q("mb_walking_aid_use", "mobility_balance_falls", "multi_select", "Which mobility aids are currently used?", "ما وسائل المساعدة على الحركة المستخدمة حالياً؟", [
    { value: "none", en: "None", ar: "لا شيء" },
    { value: "cane", en: "Cane", ar: "عصا" },
    { value: "walker", en: "Walker", ar: "مشاية" },
    { value: "wheelchair", en: "Wheelchair", ar: "كرسي متحرك" },
    { value: "person_assistance", en: "Another person's assistance", ar: "مساعدة شخص آخر" },
  ]),
  q("mb_integrated_rise_walk_turn_sit", "mobility_balance_falls", "single_select", "Does the patient report difficulty rising, walking a short distance, turning, and sitting down?", "هل يذكر المريض صعوبة في النهوض والمشي لمسافة قصيرة والدوران والجلوس؟", yesNoUnsure),
  q("mb_outdoor_walking", "mobility_balance_falls", "single_select", "How difficult is walking outdoors?", "ما مدى صعوبة المشي خارج المنزل؟", difficulty),
  q("mb_stairs", "mobility_balance_falls", "single_select", "How difficult is using stairs, when relevant?", "ما مدى صعوبة استخدام الدرج، إذا كان ذلك مناسباً؟", difficulty),
  q("mb_standing_reach_balance_concern", "mobility_balance_falls", "single_select", "Is there a concern about balance while standing or reaching?", "هل توجد مخاوف بشأن التوازن أثناء الوقوف أو الوصول؟", yesNoUnsure),
  q("mb_independent_standing", "mobility_balance_falls", "single_select", "Can the patient stand independently according to the information provided?", "هل يستطيع المريض الوقوف بشكل مستقل وفقاً للمعلومات المقدمة؟", yesNoUnsure),
  q("mb_fall_reported", "mobility_balance_falls", "single_select", "Has the patient fallen in the last 3 months?", "هل سقط المريض خلال الأشهر الثلاثة الماضية؟", yesNoUnsure),
  q("mb_near_fall_reported", "mobility_balance_falls", "single_select", "Has the patient nearly fallen or needed sudden support in the last 3 months?", "هل كاد المريض أن يسقط أو احتاج دعماً مفاجئاً خلال الأشهر الثلاثة الماضية؟", yesNoUnsure),
  q("mb_falls_screen", "mobility_balance_falls", "multi_select", "In the last 3 months, has the patient had any of these?", "خلال الأشهر الثلاثة الماضية، هل حدث أي مما يلي؟", [
    { value: "fall", en: "A fall", ar: "سقوط" },
    { value: "near_fall", en: "A near-fall or sudden need for support", ar: "شبه سقوط أو حاجة مفاجئة للدعم" },
    { value: "none", en: "Neither", ar: "لا شيء منهما" },
  ]),
  q("mb_fall_details", "mobility_balance_falls", "long_text", "Please describe the fall or falls.", "يرجى وصف السقوط."),

  q("sfp_sensation_change", "sensation_fatigue_pain", "single_select", "Does the patient report numbness, tingling, altered sensation, or reduced awareness of touch?", "هل يذكر المريض خدراً أو وخزاً أو تغيراً في الإحساس أو انخفاضاً في إدراك اللمس؟", yesNoUnsure),
  q("sfp_functional_symptoms", "sensation_fatigue_pain", "multi_select", "Which symptoms currently affect important activities?", "ما الأعراض التي تؤثر حالياً على الأنشطة المهمة؟", [
    { value: "sensation", en: "Numbness, tingling, or altered sensation", ar: "خدر أو وخز أو تغير في الإحساس" },
    { value: "fatigue", en: "Fatigue or low endurance", ar: "تعب أو انخفاض التحمل" },
    { value: "pain", en: "Pain", ar: "ألم" },
    { value: "none", en: "None of these", ar: "لا شيء مما سبق" },
  ]),
  q("sfp_left_side_inattention_reported", "sensation_fatigue_pain", "single_select", "Does the patient or caregiver report sometimes missing things on the left side?", "هل يذكر المريض أو مقدم الرعاية أحياناً عدم ملاحظة أشياء على الجانب الأيسر؟", yesNoUnsure),
  q("sfp_fatigue_impact", "sensation_fatigue_pain", "single_select", "How much does fatigue affect daily activity?", "إلى أي مدى يؤثر التعب على النشاط اليومي؟", difficulty),
  q("sfp_fatigue_details", "sensation_fatigue_pain", "long_text", "How does fatigue limit the activities that matter most?", "كيف يحد التعب من الأنشطة الأكثر أهمية؟"),
  q("sfp_pain_present", "sensation_fatigue_pain", "single_select", "Is pain currently affecting rehabilitation or daily activity?", "هل يؤثر الألم حالياً على التأهيل أو النشاط اليومي؟", yesNoUnsure),
  q("sfp_pain_location_description", "sensation_fatigue_pain", "long_text", "Where is the pain and how does it affect activity?", "أين يوجد الألم وكيف يؤثر على النشاط؟"),
  q("sfp_other_symptoms", "sensation_fatigue_pain", "long_text", "Describe any other sensory, fatigue, stiffness, or coordination symptoms.", "صف أي أعراض أخرى متعلقة بالإحساس أو التعب أو التيبس أو التناسق."),

  q("adl_self_care_group", "adl_participation_support", "multi_select", "Which activities currently require help?", "ما الأنشطة التي تحتاج إلى مساعدة حالياً؟", [
    { value: "none", en: "None reported", ar: "لا توجد صعوبات مذكورة" },
    { value: "transfers", en: "Transfers", ar: "الانتقال" },
    { value: "walking", en: "Walking", ar: "المشي" },
    { value: "stairs", en: "Stairs", ar: "الدرج" },
    { value: "dressing", en: "Dressing", ar: "ارتداء الملابس" },
    { value: "bathing", en: "Bathing", ar: "الاستحمام" },
    { value: "toileting", en: "Toileting", ar: "استخدام الحمام" },
    { value: "eating", en: "Eating", ar: "الأكل" },
    { value: "grooming", en: "Grooming", ar: "العناية الشخصية" },
    { value: "meal_prep", en: "Meal preparation", ar: "إعداد الطعام" },
    { value: "household", en: "Household activities", ar: "الأنشطة المنزلية" },
    { value: "community", en: "Community or social activities", ar: "الأنشطة المجتمعية أو الاجتماعية" },
    { value: "work_education", en: "Work or education", ar: "العمل أو التعليم" },
    { value: "other", en: "Another important activity", ar: "نشاط مهم آخر" },
  ]),
  q("adl_home_community_group", "adl_participation_support", "multi_select", "Which home or community activities are restricted?", "ما الأنشطة المنزلية أو المجتمعية المقيدة؟", [
    { value: "none", en: "None reported", ar: "لا توجد قيود مذكورة" },
    { value: "meal_prep", en: "Preparing meals", ar: "إعداد الطعام" },
    { value: "household", en: "Household tasks", ar: "المهام المنزلية" },
    { value: "shopping", en: "Shopping", ar: "التسوق" },
    { value: "transport", en: "Transport or driving", ar: "التنقل أو القيادة" },
    { value: "social", en: "Social activities", ar: "الأنشطة الاجتماعية" },
    { value: "work_education", en: "Work or education", ar: "العمل أو التعليم" },
  ]),
  q("support_caregiver_available", "adl_participation_support", "single_select", "Is caregiver or family support available?", "هل تتوفر مساعدة من مقدم رعاية أو الأسرة؟", yesNoUnsure),
  q("support_devices_equipment", "adl_participation_support", "long_text", "List any devices, equipment, or home support currently used.", "اذكر أي أجهزة أو معدات أو دعم منزلي مستخدم حالياً."),
  q("support_additional_details", "adl_participation_support", "long_text", "Add any important details about daily activities, participation, or support.", "أضف أي تفاصيل مهمة عن الأنشطة اليومية أو المشاركة أو الدعم."),

  q("goal_primary", "patient_goals", "long_text", "What is the patient's primary rehabilitation goal, in their own words?", "ما هو هدف التأهيل الأساسي للمريض بكلماته؟"),
  q("goal_second", "patient_goals", "long_text", "What is the second goal, in the patient's own words?", "ما هو الهدف الثاني بكلمات المريض؟"),
  q("goal_third", "patient_goals", "long_text", "What is the third goal, in the patient's own words?", "ما هو الهدف الثالث بكلمات المريض؟"),
  q("goal_most_important_change", "patient_goals", "long_text", "What single change would matter most to the patient?", "ما هو التغيير الواحد الأكثر أهمية للمريض؟"),
];

export const STROKE_SECTION_TITLES: Record<StrokeSectionId, { en: string; ar: string }> = {
  safety_gate: { en: "Safety Gate", ar: "بوابة السلامة" },
  stroke_context: { en: "Stroke Context / Baseline", ar: "سياق السكتة والحالة الأساسية" },
  upper_limb_hand: { en: "Upper Limb & Hand", ar: "الطرف العلوي واليد" },
  mobility_balance_falls: { en: "Mobility / Balance / Falls", ar: "الحركة والتوازن والسقوط" },
  sensation_fatigue_pain: { en: "Sensation / Fatigue / Pain", ar: "الإحساس والتعب والألم" },
  adl_participation_support: { en: "Daily Activity / Participation / Support", ar: "النشاط اليومي والمشاركة والدعم" },
  patient_goals: { en: "Patient Goals", ar: "أهداف المريض" },
};

export type StrokeQuestionnaireSubmission = {
  questionnaireKind: typeof STROKE_QUESTIONNAIRE_KIND;
  questionnaireVersion: typeof STROKE_QUESTIONNAIRE_VERSION;
  pathway: typeof STROKE_PATHWAY;
  assessmentLanguage: "en" | "ar";
  safetyState: StrokeSafetyState;
  responses: Record<string, StrokeResponse>;
  branchTrace: string[];
  strokeWorkflow: {
    translation: { status: StrokeTranslationStatus; approvedAt?: string };
    report: { status: "not_generated" | "draft_ready" | "finalized" | "failed" };
  };
};

export function isStrokeQuestionnaireData(value: unknown): value is StrokeQuestionnaireSubmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as Record<string, unknown>).questionnaireKind === STROKE_QUESTIONNAIRE_KIND;
}

export function validateStrokeIntakeProvenance(
  value: unknown,
): { ok: true } | { ok: false; error: string } {
  if (!isStrokeQuestionnaireData(value)) {
    return { ok: false, error: "Invalid Stroke questionnaire payload." };
  }
  if (!value.responses || typeof value.responses !== "object") {
    return { ok: false, error: "Stroke responses are required." };
  }
  for (const response of Object.values(value.responses)) {
    if (
      response.provenance !== "PATIENT_REPORTED" &&
      response.provenance !== "CAREGIVER_REPORTED"
    ) {
      return {
        ok: false,
        error: "Remote intake may only create patient- or caregiver-reported data.",
      };
    }
  }
  return { ok: true };
}

export function strokeQuestionById(id: string): StrokeQuestionDefinition | undefined {
  return STROKE_QUESTIONS.find((question) => question.id === id);
}

export const STROKE_UNCLEAR_CLINICAL_ENGLISH =
  "Response unclear / requires clinician review.";

const AMBIGUOUS_TEXT_RESPONSES = new Set([
  "a",
  "an",
  "the",
  "al",
  "n/a",
  "na",
  "unknown",
  "unclear",
  "not sure",
  "ال",
  "غير واضح",
  "غير معروف",
  "لا أعرف",
]);

export function isStrokeSourceResponseUnclear(
  id: string,
  response: StrokeResponse,
): boolean {
  if (strokeQuestionById(id)?.options) return false;
  const raw = Array.isArray(response.rawValue)
    ? response.rawValue.join(" ")
    : response.rawValue;
  const normalized = raw.normalize("NFKC").trim().toLowerCase();
  if (!normalized) return false;
  if (AMBIGUOUS_TEXT_RESPONSES.has(normalized)) return true;
  if (/^[-–—_.,،…/\\\s]+$/u.test(normalized)) return true;
  const meaningfulCharacters = normalized.match(/[\p{L}\p{N}]/gu) ?? [];
  return meaningfulCharacters.length < 3;
}

export function isStrokeResponseUnresolved(
  id: string,
  response: StrokeResponse,
): boolean {
  return isStrokeSourceResponseUnclear(id, response);
}

export function clinicalEnglishForStrokeDisplay(
  id: string,
  response: StrokeResponse,
): string | undefined {
  const raw = Array.isArray(response.rawValue)
    ? response.rawValue.join(" ").trim()
    : response.rawValue.trim();
  if (!raw) return undefined;
  if (isStrokeResponseUnresolved(id, response)) {
    return STROKE_UNCLEAR_CLINICAL_ENGLISH;
  }
  return response.clinicalEnglish?.trim() || undefined;
}

const STROKE_DISPLAY_VALUE_OVERRIDES: Record<string, string> = {
  much_difficulty: "A lot of difficulty",
  some_difficulty: "Some difficulty",
  walking_aid: "Uses walking aid",
  near_fall: "Near fall reported",
};

export function formatStrokeResponseValue(
  id: string,
  response: Pick<StrokeResponse, "rawValue">,
): string {
  const question = strokeQuestionById(id);
  const values = Array.isArray(response.rawValue)
    ? response.rawValue
    : [response.rawValue];
  return values
    .map((value) => {
      if (STROKE_DISPLAY_VALUE_OVERRIDES[value]) {
        return STROKE_DISPLAY_VALUE_OVERRIDES[value];
      }
      const optionLabel = question?.options?.find(
        (option) => option.value === value,
      )?.en;
      if (optionLabel) return optionLabel;
      if (/^[a-z0-9_]+$/i.test(value) && value.includes("_")) {
        const humanized = value.replaceAll("_", " ");
        return humanized.charAt(0).toUpperCase() + humanized.slice(1);
      }
      return value;
    })
    .join(", ");
}

/**
 * Patient submission transport deliberately excludes translation state and
 * generated Clinical English. A selection response's method is implied by the
 * server-owned question registry; typed/voice methods remain explicit.
 */
export function compactStrokeResponsesForSubmission(
  responses: Record<string, StrokeResponse>,
): Record<string, StrokeResponse> {
  return Object.fromEntries(
    Object.entries(responses)
      .filter(([questionId]) => !strokeQuestionById(questionId)?.navigationOnly)
      .map(([questionId, response]) => {
      const question = strokeQuestionById(questionId);
      const responseMethod =
        response.responseMethod === "selection" && question?.options
          ? undefined
          : response.responseMethod;
      return [
        questionId,
        {
          rawValue: response.rawValue,
          rawLanguage: response.rawLanguage,
          ...(responseMethod ? { responseMethod } : {}),
          provenance: response.provenance,
          reporterRole: response.reporterRole,
        },
      ];
      }),
  );
}
