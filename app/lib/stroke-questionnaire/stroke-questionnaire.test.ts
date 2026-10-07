import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildStrokeActiveScreenQueue,
  buildStrokeBranchTrace,
  countActiveStrokeQuestions,
  resolveStrokeSafetyState,
  shouldShowUpperLimb,
} from "./stroke-branch-engine";
import { routeStrokeRasqModules } from "./stroke-module-routing";
import {
  buildStrokePtClinicalReport,
  sanitizeStrokeReportForSourceSafety,
  strokeReportContainsForbiddenDiagnosticUpgrade,
} from "./stroke-pt-clinical-report";
import {
  clinicalEnglishForStrokeDisplay,
  formatStrokeResponseValue,
  STROKE_PATHWAY,
  STROKE_QUESTIONS,
  STROKE_QUESTIONNAIRE_KIND,
  STROKE_QUESTIONNAIRE_VERSION,
  STROKE_UNCLEAR_CLINICAL_ENGLISH,
  compactStrokeResponsesForSubmission,
  type StrokeQuestionnaireSubmission,
  type StrokeResponse,
} from "./stroke-questionnaire-schema";
import {
  REMOTE_ASSESSMENT_MAX_STRING_LENGTH,
  validateRemoteAssessmentStructuredData,
} from "@/app/lib/remote-assessment-validation";
import { translateStrokeSubmission } from "./stroke-translation";

function response(
  rawValue: string | string[],
  provenance: StrokeResponse["provenance"] = "PATIENT_REPORTED",
): StrokeResponse {
  return {
    rawValue,
    rawLanguage: "en",
    responseMethod: Array.isArray(rawValue) ? "selection" : "text",
    provenance,
    reporterRole: provenance === "CAREGIVER_REPORTED" ? "caregiver" : "patient",
    clinicalEnglish: `${
      provenance === "CAREGIVER_REPORTED"
        ? "The caregiver reports"
        : "The patient reports"
    } ${Array.isArray(rawValue) ? rawValue.join(", ") : rawValue}.`,
    translation: { status: "approved" },
  };
}

function submission(
  responses: Record<string, StrokeResponse>,
  safetyState: StrokeQuestionnaireSubmission["safetyState"] = "PASS",
): StrokeQuestionnaireSubmission {
  return {
    questionnaireKind: STROKE_QUESTIONNAIRE_KIND,
    questionnaireVersion: STROKE_QUESTIONNAIRE_VERSION,
    pathway: STROKE_PATHWAY,
    assessmentLanguage: "en",
    safetyState,
    responses,
    branchTrace: [],
    strokeWorkflow: {
      translation: { status: "approved" },
      report: { status: "not_generated" },
    },
  };
}

describe("Stroke safety gate", () => {
  it("separates sudden neurological change from gradual worsening", () => {
    assert.equal(
      resolveStrokeSafetyState({
        sg_sudden_new_neurological_change: response("yes"),
      }),
      "URGENT_ESCALATION",
    );
    assert.equal(
      resolveStrokeSafetyState({
        sg_gradual_functional_worsening: response("yes"),
      }),
      "REQUIRES_CLINICIAN_REVIEW",
    );
    assert.equal(resolveStrokeSafetyState({}), "REQUIRES_CLINICIAN_REVIEW");
    assert.equal(
      resolveStrokeSafetyState({
        sg_sudden_new_neurological_change: response("no"),
        sg_chest_pain_or_severe_breathlessness: response("no"),
        sg_recent_fall_with_injury: response("no"),
        sg_gradual_functional_worsening: response("no"),
      }),
      "PASS",
    );
  });

  it("documents that PASS is only an intake-gate state", () => {
    const report = buildStrokePtClinicalReport(submission({}));
    const safety = report.sections.find((section) => section.id === "safety_considerations");
    assert.match(safety?.paragraphs.join(" ") ?? "", /does not indicate medical clearance/i);
  });
});

describe("Stroke adaptive branching", () => {
  it("does not open upper limb from affected side alone", () => {
    assert.equal(
      shouldShowUpperLimb({
        sc_affected_side: response("right"),
        sc_upper_limb_involvement: response("no"),
      }),
      false,
    );
  });

  it("opens upper limb from explicit involvement or relevant goal", () => {
    assert.equal(
      shouldShowUpperLimb({ sc_upper_limb_involvement: response("yes") }),
      true,
    );
    assert.equal(
      shouldShowUpperLimb({
        sc_upper_limb_involvement: response("no"),
        goal_primary: response("Use my hand to hold a cup"),
      }),
      true,
    );
  });

  it("does not mistake the Arabic word for 'I want' as a hand goal", () => {
    assert.equal(
      shouldShowUpperLimb({
        sc_upper_limb_involvement: response("no"),
        goal_primary: response("أريد المشي بأمان خارج المنزل"),
      }),
      false,
    );
  });

  it("records nonambulatory branch suppression", () => {
    assert.ok(
      buildStrokeBranchTrace({
        mb_current_walking_status: response("nonambulatory"),
      }).includes("NONAMBULATORY_WALKING_BRANCH_SKIPPED"),
    );
  });

  it("uses a concise core and opens only relevant functional branches", () => {
    const core = buildStrokeActiveScreenQueue({});
    const coreQuestionCount = new Set(
      core
        .filter((screen) => screen.phase === "core")
        .flatMap((screen) => screen.questionIds),
    ).size;
    assert.equal(coreQuestionCount, 15);

    const responses = {
      sc_upper_limb_involvement: response("yes"),
      ul_priority_tasks: response(["cup_eating"]),
      mb_current_walking_status: response("nonambulatory"),
      sfp_functional_symptoms: response(["none"]),
    };
    const activeIds = new Set(
      buildStrokeActiveScreenQueue(responses).flatMap(
        (screen) => screen.questionIds,
      ),
    );
    assert.equal(activeIds.has("ul_cup_bottle_hold"), true);
    assert.equal(activeIds.has("ul_overhead_reach"), false);
    assert.equal(activeIds.has("mb_bed_mobility"), true);
    assert.equal(activeIds.has("mb_walking_turning_difficulty"), false);
    assert.equal(activeIds.has("mb_falls_screen"), true);
    assert.equal(activeIds.has("sfp_pain_location_description"), false);
  });

  it("uses one-question screens after communication support is flagged", () => {
    const screens = buildStrokeActiveScreenQueue({
      sc_information_source: response("patient_with_caregiver"),
      sc_communication_support_needed: response("yes"),
    });
    assert.ok(
      screens
        .filter((screen) => screen.id !== "safety")
        .every((screen) => screen.questionIds.length === 1),
    );
  });

  it("keeps a typical ambulatory path within the 19-24 question target", () => {
    const typical = {
      sg_sudden_new_neurological_change: response("no"),
      sg_chest_pain_or_severe_breathlessness: response("no"),
      sg_recent_fall_with_injury: response("no"),
      sg_gradual_functional_worsening: response("no"),
      sc_information_source: response("patient"),
      sc_stroke_date: response("2026-01-01"),
      sc_current_rehab_setting: response("home"),
      adl_self_care_group: response(["none"]),
      sc_upper_limb_involvement: response("no"),
      mb_current_walking_status: response("outdoor"),
      sfp_functional_symptoms: response(["none"]),
    };
    assert.equal(countActiveStrokeQuestions(typical), 23);
  });
});

describe("Stroke RASQ module routing safety", () => {
  it("fall alone does not recommend Single-Leg Stance", () => {
    const result = routeStrokeRasqModules(
      submission({ mb_fall_reported: response("yes") }),
    );
    assert.equal(result.some((item) => item.id === "single_leg_stance"), false);
  });

  it("upper-limb issue alone does not recommend Functional Reach", () => {
    const result = routeStrokeRasqModules(
      submission({ ul_grasp: response("much_difficulty") }),
    );
    assert.equal(result.some((item) => item.id === "functional_reach"), false);
    assert.equal(result.some((item) => item.id === "upper_limb_motor_screen"), true);
  });

  it("nonambulatory does not recommend TUG or Gait Observation", () => {
    const result = routeStrokeRasqModules(
      submission({
        mb_current_walking_status: response("nonambulatory"),
        mb_walking_turning_difficulty: response("yes"),
        mb_integrated_rise_walk_turn_sit: response("yes"),
      }),
    );
    assert.equal(result.some((item) => item.id === "timed_up_and_go"), false);
    assert.equal(result.some((item) => item.id === "gait_observation"), false);
  });

  it("defers all suggestions when safety review is required", () => {
    const result = routeStrokeRasqModules(
      submission(
        { ul_grasp: response("much_difficulty") },
        "REQUIRES_CLINICIAN_REVIEW",
      ),
    );
    assert.ok(result.every((item) => item.disposition === "DEFER_PENDING_SAFETY_REVIEW"));
  });
});

describe("Stroke report provenance and diagnostic safety", () => {
  it("clears stale substantive Clinical English for a blank source response", async () => {
    const blank = response("");
    blank.rawLanguage = "ar";
    blank.clinicalEnglish = "The patient reports no fatigue concerns.";
    const source = submission({ sfp_fatigue_details: blank });
    source.assessmentLanguage = "ar";
    source.strokeWorkflow.translation.status = "not_generated";

    const translated = await translateStrokeSubmission(source, "unused");
    assert.equal(
      translated.submission.responses.sfp_fatigue_details.clinicalEnglish,
      undefined,
    );
  });

  it("does not synthesize placeholder fatigue details", async () => {
    const source = submission({
      sfp_fatigue_details: {
        rawValue: "-",
        rawLanguage: "ar",
        responseMethod: "text",
        provenance: "PATIENT_REPORTED",
        reporterRole: "patient",
      },
    });
    source.assessmentLanguage = "ar";
    source.strokeWorkflow.translation.status = "not_generated";

    const translated = await translateStrokeSubmission(source, "unused");
    assert.equal(
      translated.submission.responses.sfp_fatigue_details.clinicalEnglish,
      STROKE_UNCLEAR_CLINICAL_ENGLISH,
    );
    const report = buildStrokePtClinicalReport(translated.submission);
    const fatigue = report.sections.find(
      (section) => section.id === "sensation_fatigue_pain",
    );
    assert.deepEqual(fatigue?.paragraphs, []);
    assert.deepEqual(fatigue?.bullets, []);
  });

  it("omits previously generated substantive text when its source is unresolved", () => {
    const unsafe = response("-");
    unsafe.clinicalEnglish =
      "The patient reports fatigue that substantially limits concentration.";
    const source = submission({ sfp_fatigue_details: unsafe });
    const persistedReport = buildStrokePtClinicalReport(submission({}));
    const persistedFatigue = persistedReport.sections.find(
      (section) => section.id === "sensation_fatigue_pain",
    );
    persistedFatigue?.paragraphs.push(unsafe.clinicalEnglish);

    const report = sanitizeStrokeReportForSourceSafety(persistedReport, source);
    const safeFatigue = report.sections.find(
      (section) => section.id === "sensation_fatigue_pain",
    );
    assert.deepEqual(safeFatigue?.paragraphs, []);
    assert.equal(
      clinicalEnglishForStrokeDisplay("sfp_fatigue_details", unsafe),
      STROKE_UNCLEAR_CLINICAL_ENGLISH,
    );
  });

  it("does not convert an incomplete Arabic safety response into no concern", async () => {
    const source = submission(
      {
        sg_other_safety_concern: {
          rawValue: "ال",
          rawLanguage: "ar",
          responseMethod: "text",
          provenance: "PATIENT_REPORTED",
          reporterRole: "patient",
        },
      },
      "REQUIRES_CLINICIAN_REVIEW",
    );
    source.assessmentLanguage = "ar";
    source.strokeWorkflow.translation.status = "not_generated";

    const translated = await translateStrokeSubmission(source, "unused");
    const clinicalEnglish =
      translated.submission.responses.sg_other_safety_concern.clinicalEnglish;
    assert.equal(clinicalEnglish, STROKE_UNCLEAR_CLINICAL_ENGLISH);
    assert.doesNotMatch(clinicalEnglish ?? "", /no (?:additional )?(?:current )?safety concern/i);
  });

  it("shows the clinician-review safety state explicitly", () => {
    const report = buildStrokePtClinicalReport(
      submission({}, "REQUIRES_CLINICIAN_REVIEW"),
    );
    const safety = report.sections.find(
      (section) => section.id === "safety_considerations",
    );
    assert.match(
      safety?.paragraphs.join(" ") ?? "",
      /REQUIRES CLINICIAN REVIEW/,
    );
    assert.doesNotMatch(
      safety?.paragraphs.join(" ") ?? "",
      /Safety gate state: PASS/,
    );
  });

  it("humanizes Stroke response enums for clinician-facing reports", () => {
    assert.equal(
      formatStrokeResponseValue("adl_self_care_group", response("much_difficulty")),
      "A lot of difficulty",
    );
    assert.equal(
      formatStrokeResponseValue("sc_pre_stroke_walking_status", response("walking_aid")),
      "Uses walking aid",
    );
    assert.equal(
      formatStrokeResponseValue("mb_falls_screen", response("near_fall")),
      "Near fall reported",
    );
  });

  it("preserves caregiver-reported provenance", () => {
    const report = buildStrokePtClinicalReport(
      submission({
        sc_main_current_limitation: response(
          "difficulty using the left hand",
          "CAREGIVER_REPORTED",
        ),
      }),
    );
    const context = report.sections.find(
      (section) => section.id === "stroke_rehabilitation_context",
    );
    assert.match(
      [...(context?.paragraphs ?? []), ...(context?.bullets ?? [])].join(" "),
      /caregiver reports/i,
    );
  });

  it("keeps Objective Examination independent and empty", () => {
    const report = buildStrokePtClinicalReport(
      submission({ ul_grasp: response("unable") }),
    );
    const objective = report.sections.find(
      (section) => section.id === "objective_examination",
    );
    assert.deepEqual(objective?.paragraphs, []);
    assert.deepEqual(objective?.bullets, []);
    assert.deepEqual(objective?.allowedProvenance, [
      "CLINICIAN_OBSERVED",
      "OBJECTIVELY_MEASURED",
    ]);
  });

  it("patient-reported stiffness is not converted to spasticity", () => {
    const report = buildStrokePtClinicalReport(
      submission({ ul_stiffness_tightness: response("yes") }),
    );
    assert.doesNotMatch(JSON.stringify(report), /spasticity/i);
  });

  it("dragging/catching leg is not converted to foot drop", () => {
    const report = buildStrokePtClinicalReport(
      submission({ mb_foot_catching_dragging: response("yes") }),
    );
    assert.doesNotMatch(JSON.stringify(report), /foot drop/i);
  });

  it("reported left-side inattention is not converted to neglect", () => {
    const report = buildStrokePtClinicalReport(
      submission({ sfp_left_side_inattention_reported: response("yes") }),
    );
    assert.doesNotMatch(JSON.stringify(report), /\bneglect\b/i);
    assert.deepEqual(strokeReportContainsForbiddenDiagnosticUpgrade(report), []);
  });

  it("keeps the main report concise and moves full questions to the appendix", () => {
    const report = buildStrokePtClinicalReport(
      submission({
        ul_reaching_forward: {
          rawValue: "much_difficulty",
          rawLanguage: "en",
          responseMethod: "selection",
          provenance: "PATIENT_REPORTED",
          reporterRole: "patient",
        },
        goal_primary: response("use my left hand to hold a cup"),
      }),
    );
    const mainCorpus = report.sections
      .filter((section) => section.id !== "full_patient_reported_responses")
      .flatMap((section) => [...section.paragraphs, ...section.bullets])
      .join(" ");
    assert.doesNotMatch(mainCorpus, /Patient-reported response —/);
    assert.match(mainCorpus, /patient-reported/);
    const appendix = report.sections.find(
      (section) => section.id === "full_patient_reported_responses",
    );
    assert.match(
      appendix?.bullets.join(" ") ?? "",
      /How is reaching forward with the affected arm or hand/i,
    );
    assert.match(appendix?.bullets.join(" ") ?? "", /patient reported/i);
  });

  it("preserves every source response in the appendix without repeating facts in the main report", () => {
    const source: StrokeQuestionnaireSubmission = {
      ...realisticFullSubmission("en"),
      strokeWorkflow: {
        translation: { status: "approved" },
        report: { status: "not_generated" },
      },
    };
    const report = buildStrokePtClinicalReport(source);
    const appendixText =
      report.sections
        .find((section) => section.id === "full_patient_reported_responses")
        ?.bullets.join("\n") ?? "";
    for (const [id, item] of Object.entries(source.responses)) {
      const question = STROKE_QUESTIONS.find((entry) => entry.id === id);
      if (!question || question.navigationOnly) continue;
      const raw = Array.isArray(item.rawValue)
        ? item.rawValue.join(", ")
        : item.rawValue;
      if (!raw.trim()) continue;
      assert.match(
        appendixText,
        new RegExp(question.en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }
    const focused = buildStrokePtClinicalReport(
      submission({
        ul_stiffness_tightness: {
          rawValue: "yes",
          rawLanguage: "en",
          responseMethod: "selection",
          provenance: "PATIENT_REPORTED",
          reporterRole: "patient",
        },
        ul_pain: {
          rawValue: "yes",
          rawLanguage: "en",
          responseMethod: "selection",
          provenance: "PATIENT_REPORTED",
          reporterRole: "patient",
        },
        sfp_pain_present: {
          rawValue: "yes",
          rawLanguage: "en",
          responseMethod: "selection",
          provenance: "PATIENT_REPORTED",
          reporterRole: "patient",
        },
      }),
    );
    assert.match(
      focused.sections.find((section) => section.id === "upper_limb_hand_function")
        ?.bullets.join(" ") ?? "",
      /stiffness/i,
    );
    assert.doesNotMatch(
      focused.sections.find((section) => section.id === "sensation_fatigue_pain")
        ?.bullets.join(" ") ?? "",
      /stiffness/i,
    );
    assert.match(
      focused.sections.find((section) => section.id === "sensation_fatigue_pain")
        ?.bullets.join(" ") ?? "",
      /pain currently affecting/i,
    );
  });
});

function realisticFullSubmission(
  rawLanguage: "en" | "ar",
  provenance: StrokeResponse["provenance"] = "PATIENT_REPORTED",
) {
  const reporterRole =
    provenance === "CAREGIVER_REPORTED" ? "caregiver" : "patient";
  const fullResponses = Object.fromEntries(
    STROKE_QUESTIONS.map((question) => [
      question.id,
      {
        rawValue:
          question.kind === "multi_select"
            ? [question.options?.[0]?.value ?? "none"]
            : question.options?.[0]?.value ??
              (rawLanguage === "ar"
                ? "وصف عربي واقعي للصعوبة الوظيفية الحالية"
                : "A realistic description of the current functional difficulty"),
        rawLanguage,
        responseMethod: question.options ? "selection" : "text",
        provenance,
        reporterRole,
        translation: { status: "not_generated" as const },
      },
    ]),
  ) as Record<string, StrokeResponse>;

  fullResponses.sg_sudden_new_neurological_change.rawValue = "no";
  fullResponses.sg_chest_pain_or_severe_breathlessness.rawValue = "no";
  fullResponses.sg_recent_fall_with_injury.rawValue = "no";
  fullResponses.sg_gradual_functional_worsening.rawValue = "no";
  fullResponses.sc_upper_limb_involvement.rawValue = "yes";
  fullResponses.mb_current_walking_status.rawValue = "indoor";
  fullResponses.mb_falls_screen.rawValue = ["fall", "near_fall"];
  fullResponses.sfp_functional_symptoms.rawValue = [
    "sensation",
    "fatigue",
    "pain",
  ];
  fullResponses.sfp_fatigue_impact.rawValue = "much_difficulty";
  fullResponses.ul_priority_tasks.rawValue = [
    "reach",
    "hand_open_close",
    "grasp_release",
    "cup_eating",
    "dressing_grooming",
    "writing_phone",
    "daily_use",
    "symptoms",
  ];
  const activeQuestionIds = new Set(
    buildStrokeActiveScreenQueue(fullResponses).flatMap(
      (screen) => screen.questionIds,
    ),
  );
  const activeResponses = Object.fromEntries(
    Object.entries(fullResponses).filter(([questionId]) =>
      activeQuestionIds.has(questionId),
    ),
  );

  return {
    questionnaireKind: STROKE_QUESTIONNAIRE_KIND,
    questionnaireVersion: STROKE_QUESTIONNAIRE_VERSION,
    pathway: STROKE_PATHWAY,
    assessmentLanguage: rawLanguage,
    safetyState: resolveStrokeSafetyState(fullResponses),
    responses: compactStrokeResponsesForSubmission(activeResponses),
    branchTrace: buildStrokeBranchTrace(activeResponses),
  };
}

describe("Stroke submission payload boundary", () => {
  it("accepts a realistic complete seven-section submission", () => {
    const payload = realisticFullSubmission("en");
    assert.equal(payload.responses.ul_priority_tasks, undefined);
    assert.ok(Object.keys(payload.responses).length < STROKE_QUESTIONS.length);
    assert.deepEqual(validateRemoteAssessmentStructuredData(payload), {
      ok: true,
      data: payload,
    });
  });

  it("accepts an Arabic upper-limb-heavy submission", () => {
    const payload = realisticFullSubmission("ar");
    assert.equal(payload.responses.ul_grasp.rawLanguage, "ar");
    assert.equal(payload.responses.ul_grasp.responseMethod, undefined);
    assert.equal(payload.responses.ul_grasp.translation, undefined);
    assert.equal(validateRemoteAssessmentStructuredData(payload).ok, true);
  });

  it("accepts caregiver provenance without weakening reporter identity", () => {
    const payload = realisticFullSubmission("ar", "CAREGIVER_REPORTED");
    assert.ok(
      Object.values(payload.responses).every(
        (item) =>
          item.provenance === "CAREGIVER_REPORTED" &&
          item.reporterRole === "caregiver",
      ),
    );
    assert.equal(validateRemoteAssessmentStructuredData(payload).ok, true);
  });

  it("still rejects an unreasonable oversized response", () => {
    const payload = realisticFullSubmission("en");
    payload.responses.goal_primary = {
      ...payload.responses.goal_primary,
      rawValue: "x".repeat(REMOTE_ASSESSMENT_MAX_STRING_LENGTH + 1),
    };
    assert.deepEqual(validateRemoteAssessmentStructuredData(payload), {
      ok: false,
      error: "Assessment data exceeds allowed size.",
    });
  });
});
