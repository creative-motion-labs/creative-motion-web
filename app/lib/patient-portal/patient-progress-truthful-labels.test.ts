/**
 * Run: npx tsx --test app/lib/patient-portal/patient-progress-truthful-labels.test.ts
 *
 * The percentage on the patient home and progress screens is sessions completed divided by
 * sessions planned. That is adherence. It says nothing about physical recovery, so no label
 * beside it may call it "recovery", "performance" or "improvement" -- in either language.
 * The "Movement check" card is fed by a different assessment (Functional Reach / balance
 * hold), so it must not appear, or promise results, when there are none.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PatientMovementCheckCard } from "@/app/components/patient/workspace/PatientMovementCheckCard";
import { buildPatientMovementCheckView } from "@/app/lib/patient-movement-check";
import { progressPortalV1Ui, workspaceUi } from "@/app/lib/patient-portal-ui";

const OVERCLAIM_EN = /\b(recover(y|ed|ing)?|performance|improv(e|ed|ement)|better|healed|cured)\b/i;
const OVERCLAIM_AR = /(تعافي|التعافي|شفاء|الأداء|تحسّن|تحسن)/;

describe("patient completion percentage labels", () => {
  for (const lang of ["en", "ar"] as const) {
    it(`[${lang}] none of the labels beside the percentage claim recovery, performance or improvement`, () => {
      const progress = progressPortalV1Ui(lang);
      const workspace = workspaceUi(lang);
      const labels = {
        "progress hero (recovery kind)": progress.recoveryProgress,
        "progress hero (performance kind)": progress.performanceProgress,
        "progress stat tile": progress.completionStat,
        "home progress card": workspace.progressSummary,
        "home hero ring": workspace.programProgressLabel,
      };
      for (const [where, text] of Object.entries(labels)) {
        assert.ok(text.trim().length > 0, `${where} has a label`);
        assert.doesNotMatch(text, lang === "en" ? OVERCLAIM_EN : OVERCLAIM_AR, `${where}: "${text}"`);
      }
    });
  }

  it("states what the number is: sessions of the plan that were completed", () => {
    assert.equal(progressPortalV1Ui("en").recoveryProgress, "Plan sessions completed");
    assert.equal(progressPortalV1Ui("en").performanceProgress, "Plan sessions completed");
    assert.equal(workspaceUi("en").progressSummary, "Plan sessions completed");
    assert.ok(/[؀-ۿ]/.test(progressPortalV1Ui("ar").recoveryProgress));
  });
});

describe("PatientMovementCheckCard", () => {
  const render = (view: Parameters<typeof buildPatientMovementCheckView>[0] | null, lang: "en" | "ar" = "en") =>
    renderToStaticMarkup(
      createElement(PatientMovementCheckCard, {
        view: view === null ? null : buildPatientMovementCheckView(view),
        lang,
        arClass: "",
        textDir: lang === "ar" ? "rtl" : "ltr",
      }),
    );

  it("renders nothing while the data has not loaded", () => {
    assert.equal(render(null), "");
  });

  it("renders nothing when there are no Functional Reach / balance-hold results", () => {
    assert.equal(render([]), "");
    assert.equal(render([], "ar"), "");
  });

  it("never shows the old empty-state promise", () => {
    assert.doesNotMatch(render([]), /Complete a movement check/);
  });

  it("still shows real results when they exist", () => {
    const html = render([
      { exerciseId: "functional-reach", recordedAt: "2026-10-01T10:00:00.000Z", value: 4 },
      { exerciseId: "functional-reach", recordedAt: "2026-10-05T10:00:00.000Z", value: 6 },
    ]);
    assert.match(html, /Movement check/);
    assert.match(html, /Functional reach/);
    assert.match(html, /6 reaches/);
  });
});
