import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  batchTranslateRemoteQuestionnaire,
  collectTranslatableDraftFields,
} from "./batch-translate-remote-questionnaire";

describe("collectTranslatableDraftFields", () => {
  it("collects Arabic text fields and skips painScore", () => {
    const fields = collectTranslatableDraftFields({
      pain: {
        chiefComplaint: "ألم في الكتف",
        painLocation: "الكتف الأيمن",
        painScore: "7",
        aggravating: "",
        easing: "",
        dailyImpact: "",
        goals: "",
      },
    });

    assert.equal(fields.length, 2);
    assert.deepEqual(fields.map((f) => f.fieldKey), ["chiefComplaint", "painLocation"]);
  });
});

describe("batchTranslateRemoteQuestionnaire", () => {
  it("skips translation for English submissions", async () => {
    const input = {
      assessmentLanguage: "en",
      pain: { chiefComplaint: "Shoulder pain", painLocation: "", painScore: "", aggravating: "", easing: "", dailyImpact: "", goals: "" },
    };

    const result = await batchTranslateRemoteQuestionnaire(input, "sk-test");
    assert.equal(result.translationAttempted, false);
    assert.equal(result.structuredData, input);
  });

  it("marks failure when API key is missing", async () => {
    const input = {
      assessmentLanguage: "ar",
      pain: {
        chiefComplaint: "ألم في الكتف",
        painLocation: "",
        painScore: "",
        aggravating: "",
        easing: "",
        dailyImpact: "",
        goals: "",
      },
    };

    const result = await batchTranslateRemoteQuestionnaire(input, null);
    assert.equal(result.translationAttempted, true);
    assert.equal(result.failedFieldKeys.length, 1);
    assert.equal(result.structuredData.clinical_translation_status, "failed");
    assert.match(String(result.structuredData.clinical_translation_warning), /therapist review/i);
    assert.equal((result.structuredData as typeof input).pain.chiefComplaint, "ألم في الكتف");
  });

  it("writes _en keys without overwriting originals", async () => {
    const input = {
      assessmentLanguage: "ar",
      pain: {
        chiefComplaint: "ألم في الكتف",
        painLocation: "",
        painScore: "",
        aggravating: "",
        easing: "",
        dailyImpact: "",
        goals: "",
      },
    };

    const result = await batchTranslateRemoteQuestionnaire(
      input,
      "sk-test",
      async () => ({ ok: true, translation: "Clinical English shoulder pain" }),
    );
    assert.equal(result.structuredData.chiefComplaint_en, "Clinical English shoulder pain");
    assert.equal((result.structuredData as typeof input).pain.chiefComplaint, "ألم في الكتف");
    assert.equal(result.structuredData.clinical_translation_status, "complete");
  });
});
