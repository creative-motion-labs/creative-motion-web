import {
  formatStrokeResponseValue,
  isStrokeResponseUnresolved,
  strokeQuestionById,
  type ClinicalProvenance,
  type StrokeQuestionnaireSubmission,
  type StrokeResponse,
} from "./stroke-questionnaire-schema";
import {
  routeStrokeRasqModules,
  strokeModuleSuggestionText,
} from "./stroke-module-routing";

export const STROKE_PT_REPORT_SECTION_SPECS = [
  ["encounter_information_source", "Encounter & Information Source"],
  ["stroke_rehabilitation_context", "Stroke & Rehabilitation Context"],
  ["patient_reported_motor_presentation", "Key Patient-Reported Motor Presentation"],
  ["upper_limb_hand_function", "Upper-Limb & Hand Function"],
  ["mobility_transfers_balance_falls", "Mobility / Transfers / Balance / Falls"],
  ["sensation_fatigue_pain", "Sensation / Fatigue / Pain"],
  ["safety_considerations", "Safety Flags"],
  ["functional_priorities", "Functional Priorities"],
  ["suggested_objective_assessment", "Suggested Objective Assessment / Next Steps"],
  ["clinical_disclaimer", "Clinical Disclaimer & Therapist Review"],
  ["objective_examination", "Objective Examination"],
  ["full_patient_reported_responses", "Appendix — Full Patient-Reported Responses"],
] as const;

export const STROKE_PT_REPORT_APPENDIX_SECTION_ID =
  "full_patient_reported_responses" as const;

export type StrokePtReportSectionId =
  (typeof STROKE_PT_REPORT_SECTION_SPECS)[number][0];

export type StrokePtReportSection = {
  id: StrokePtReportSectionId;
  title: string;
  paragraphs: string[];
  bullets: string[];
  allowedProvenance: ClinicalProvenance[];
};

export type StrokePtClinicalReport = {
  schemaVersion: 1;
  title: "Stroke-Oriented PT Clinical Report";
  disclaimer: string;
  lifecycleNote: string;
  generatedAt: string;
  sourceLanguage: "en" | "ar";
  generationMethod: "structured_fallback" | "ai";
  sections: StrokePtReportSection[];
};

const FORBIDDEN_UPGRADES = [
  "spasticity",
  "hemiparesis",
  "foot drop",
  "neglect",
  "proprioceptive deficit",
  "aphasia",
  "ataxic gait",
  "hemiplegic gait",
  "severe balance impairment",
] as const;

function rawText(response: StrokeResponse): string {
  return Array.isArray(response.rawValue)
    ? response.rawValue.join(", ")
    : response.rawValue;
}

function compactTopicLabel(id: string): string {
  const question = strokeQuestionById(id);
  const en = question?.en ?? "";
  const difficulty = en.match(
    /^How much difficulty (?:is there |does the patient have )?(.+?)\??$/i,
  );
  if (difficulty) {
    return difficulty[1].replace(/^(with|there) (the )?/i, "");
  }
  const howIs = en.match(/^How is (.+) with the affected arm or hand\??$/i);
  if (howIs) {
    const topic = howIs[1];
    return topic.charAt(0).toUpperCase() + topic.slice(1);
  }
  const fromId = id
    .replace(/^(sg|sc|ul|mb|sfp|adl|support|goal)_/, "")
    .replaceAll("_", " ");
  const humanized = fromId.charAt(0).toUpperCase() + fromId.slice(1);
  if (!en || en.length > 70) return humanized;
  return en.replace(/\?$/, "");
}

function compactResponseText(id: string, response: StrokeResponse): string {
  const question = strokeQuestionById(id);
  const raw = rawText(response).trim();
  if (!raw) return "";
  if (isStrokeResponseUnresolved(id, response)) return "";
  const who =
    response.provenance === "CAREGIVER_REPORTED"
      ? "caregiver-reported"
      : "patient-reported";
  if (
    question?.options &&
    (response.responseMethod === "selection" ||
      response.responseMethod === undefined)
  ) {
    return `${compactTopicLabel(id)}: ${formatStrokeResponseValue(id, response)} (${who}).`;
  }
  if (response.clinicalEnglish?.trim()) return response.clinicalEnglish.trim();
  if (response.rawLanguage === "en") {
    return `${compactTopicLabel(id)}: ${raw} (${who}).`;
  }
  return "";
}

function appendixResponseText(id: string, response: StrokeResponse): string {
  const question = strokeQuestionById(id);
  const original = formatStrokeResponseValue(id, response).trim() || rawText(response).trim();
  if (!original) return "";
  const provenance = response.provenance.replaceAll("_", " ");
  const clinical = response.clinicalEnglish?.trim();
  const questionText = question?.en ?? id;
  return clinical && clinical !== original
    ? `${questionText} Original (${provenance}, ${response.reporterRole}): ${original}. Clinical English: ${clinical}`
    : `${questionText} Original (${provenance}, ${response.reporterRole}): ${original}.`;
}

function linesFor(
  submission: StrokeQuestionnaireSubmission,
  predicate: (id: string) => boolean,
): string[] {
  return Object.entries(submission.responses)
    .filter(
      ([id, response]) =>
        !strokeQuestionById(id)?.navigationOnly &&
        predicate(id) &&
        rawText(response).trim(),
    )
    .map(([id, response]) => compactResponseText(id, response))
    .filter(Boolean);
}

function appendixLines(submission: StrokeQuestionnaireSubmission): string[] {
  return Object.entries(submission.responses)
    .filter(
      ([id, response]) =>
        !strokeQuestionById(id)?.navigationOnly && rawText(response).trim(),
    )
    .map(([id, response]) => appendixResponseText(id, response))
    .filter(Boolean);
}

function section(
  id: StrokePtReportSectionId,
  paragraphs: string[] = [],
  bullets: string[] = [],
  allowedProvenance: ClinicalProvenance[] = [
    "PATIENT_REPORTED",
    "CAREGIVER_REPORTED",
  ],
): StrokePtReportSection {
  const title =
    STROKE_PT_REPORT_SECTION_SPECS.find(([sectionId]) => sectionId === id)?.[1] ?? id;
  return { id, title, paragraphs, bullets, allowedProvenance };
}

export function strokeReportContainsForbiddenDiagnosticUpgrade(
  report: StrokePtClinicalReport,
): string[] {
  const corpus = report.sections
    .flatMap((item) => [...item.paragraphs, ...item.bullets])
    .join(" ")
    .toLowerCase();
  return FORBIDDEN_UPGRADES.filter((term) => corpus.includes(term));
}

export function sanitizeStrokeReportForSourceSafety(
  report: StrokePtClinicalReport,
  submission: StrokeQuestionnaireSubmission,
): StrokePtClinicalReport {
  const unsupportedStatements = new Set(
    Object.entries(submission.responses)
      .filter(([id, response]) => isStrokeResponseUnresolved(id, response))
      .map(([, response]) => response.clinicalEnglish?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  if (unsupportedStatements.size === 0) return report;

  return {
    ...report,
    sections: report.sections.map((reportSection) => ({
      ...reportSection,
      paragraphs: reportSection.paragraphs.filter(
        (paragraph) => !unsupportedStatements.has(paragraph.trim()),
      ),
      bullets: reportSection.bullets.filter(
        (bullet) => !unsupportedStatements.has(bullet.trim()),
      ),
    })),
  };
}

export function buildStrokePtClinicalReport(
  submission: StrokeQuestionnaireSubmission,
): StrokePtClinicalReport {
  const context = linesFor(
    submission,
    (id) => id.startsWith("sc_") && id !== "sc_information_source",
  );
  const upperLimb = linesFor(submission, (id) => id.startsWith("ul_"));
  const transfers = linesFor(
    submission,
    (id) =>
      id.startsWith("mb_transfer_") ||
      [
        "mb_bed_mobility",
        "mb_sitting_support",
        "mb_standing_support",
        "mb_wheelchair_support_needs",
      ].includes(id),
  );
  const gait = linesFor(
    submission,
    (id) =>
      id.startsWith("mb_") &&
      !id.startsWith("mb_transfer_") &&
      ![
        "mb_bed_mobility",
        "mb_sitting_support",
        "mb_standing_support",
        "mb_wheelchair_support_needs",
      ].includes(id),
  );
  const sensation = linesFor(
    submission,
    (id) =>
      id === "sfp_sensation_change" ||
      id === "sfp_left_side_inattention_reported" ||
      id === "sfp_other_symptoms",
  );
  const fatiguePain = linesFor(
    submission,
    (id) =>
      id === "sfp_fatigue_impact" ||
      id === "sfp_fatigue_details" ||
      id === "sfp_pain_present" ||
      id === "sfp_pain_location_description",
  );
  const adl = linesFor(submission, (id) => id.startsWith("adl_"));
  const support = linesFor(submission, (id) => id.startsWith("support_"));
  const goals = linesFor(submission, (id) => id.startsWith("goal_"));
  const safety =
    submission.safetyState === "PASS"
      ? [
          "Safety gate state: PASS. PASS indicates completion of the intake gate only and does not indicate medical clearance for exercise.",
        ]
      : submission.safetyState === "REQUIRES_CLINICIAN_REVIEW"
        ? [
            "Safety gate state: REQUIRES CLINICIAN REVIEW. Clinician safety review is required before considering performance assessment. This status does not indicate medical clearance for exercise.",
          ]
        : [
            "Safety gate state: URGENT ESCALATION. An urgent escalation response was recorded; do not authorize performance assessment from this intake.",
          ];
  const objectivePrompts = [
    upperLimb.length
      ? "Consider therapist-authorized objective assessment of upper-limb movement and task performance."
      : "",
    transfers.length
      ? "Consider therapist-authorized assessment of transfer performance."
      : "",
    gait.length
      ? "Consider therapist-authorized assessment of mobility, gait, and standing balance after safety review."
      : "",
  ].filter(Boolean);
  const moduleBullets = routeStrokeRasqModules(submission).map(
    strokeModuleSuggestionText,
  );
  const informationSourceResponse = submission.responses.sc_information_source;
  const informationSource = informationSourceResponse
    ? `Information source: ${formatStrokeResponseValue(
        "sc_information_source",
        informationSourceResponse,
      )}.`
    : "Information source not specified.";

  const report: StrokePtClinicalReport = {
    schemaVersion: 1,
    title: "Stroke-Oriented PT Clinical Report",
    disclaimer:
      "Clinical decision-support draft derived from patient- and caregiver-reported intake information. Not a diagnosis and not a substitute for objective examination or clinician judgment.",
    lifecycleNote:
      "AI-assisted draft for physiotherapist review. Therapist confirmation required before clinical use.",
    generatedAt: new Date().toISOString(),
    sourceLanguage: submission.assessmentLanguage,
    generationMethod: "structured_fallback",
    sections: [
      section("encounter_information_source", [informationSource]),
      section("stroke_rehabilitation_context", [], context),
      section("patient_reported_motor_presentation", [
        [
          upperLimb.length
            ? "The intake describes patient- or caregiver-reported upper-limb functional difficulty; objective motor findings have not been established."
            : "",
          transfers.length || gait.length
            ? "The intake includes patient- or caregiver-reported mobility information that requires therapist review and objective assessment."
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      ].filter(Boolean)),
      section("upper_limb_hand_function", [], upperLimb),
      section(
        "mobility_transfers_balance_falls",
        [],
        [...transfers, ...gait],
      ),
      section("sensation_fatigue_pain", [], [...sensation, ...fatiguePain]),
      section("safety_considerations", safety, linesFor(submission, (id) => id.startsWith("sg_"))),
      section("functional_priorities", [], [...goals, ...adl, ...support]),
      section(
        "suggested_objective_assessment",
        [
          "The submitted information identifies patient- and/or caregiver-reported rehabilitation priorities that require physiotherapist review and objective examination. No neurological impairment, gait classification, or diagnosis is inferred from this intake.",
        ],
        [...objectivePrompts, ...moduleBullets],
      ),
      section("clinical_disclaimer", [
        "Clinical decision-support draft derived from patient- and caregiver-reported intake information. Not a diagnosis and not a substitute for objective examination or clinician judgment.",
        "AI-assisted draft for physiotherapist review. Therapist confirmation required before clinical use.",
      ]),
      section(
        "objective_examination",
        [],
        [],
        ["CLINICIAN_OBSERVED", "OBJECTIVELY_MEASURED"],
      ),
      section("full_patient_reported_responses", [], appendixLines(submission)),
    ],
  };

  if (strokeReportContainsForbiddenDiagnosticUpgrade(report).length > 0) {
    throw new Error("Stroke report contains an unsupported diagnostic upgrade.");
  }
  return report;
}

export function prepareStrokeSubmission(
  input: Omit<StrokeQuestionnaireSubmission, "strokeWorkflow">,
): StrokeQuestionnaireSubmission {
  return {
    ...input,
    strokeWorkflow: {
      translation: {
        status: input.assessmentLanguage === "ar" ? "not_generated" : "approved",
      },
      report: { status: "not_generated" },
    },
  };
}
