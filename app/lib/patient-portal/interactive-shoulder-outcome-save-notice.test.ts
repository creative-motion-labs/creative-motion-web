/**
 * Run: npx tsx --test app/lib/patient-portal/interactive-shoulder-outcome-save-notice.test.ts
 *
 * A completed session whose movement outcome did not save must never look like one that
 * did. These tests cover the decision (which state shows a notice), the bilingual copy, the
 * real server-rendered markup, and that the playback screen wires the notice into BOTH
 * the wrap-up and the completion screens and keeps the real snapshot only until it saves.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InteractiveShoulderOutcomeSaveNotice } from "@/app/components/patient/session/InteractiveShoulderOutcomeSaveNotice";
import type { InteractiveShoulderOutcomeSaveState } from "./interactive-shoulder-outcome-submission";
import { resolveOutcomeSaveNotice } from "./interactive-shoulder-outcome-save-notice";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

function render(state: InteractiveShoulderOutcomeSaveState, lang: "en" | "ar") {
  return renderToStaticMarkup(
    createElement(InteractiveShoulderOutcomeSaveNotice, {
      state,
      lang,
      textDir: lang === "ar" ? "rtl" : "ltr",
      arClass: lang === "ar" ? "font-ar" : "",
      onRetry: () => {},
    }),
  );
}

describe("resolveOutcomeSaveNotice", () => {
  it("shows nothing unless the save failed or is being retried by hand", () => {
    for (const state of ["idle", "saving", "saved"] as const) {
      assert.equal(resolveOutcomeSaveNotice(state, "en"), null, state);
      assert.equal(resolveOutcomeSaveNotice(state, "ar"), null, state);
    }
  });

  it("a failed save offers a retry; a save already in flight does not", () => {
    assert.equal(resolveOutcomeSaveNotice("failed", "en")?.canRetry, true);
    assert.equal(resolveOutcomeSaveNotice("retrying", "en")?.canRetry, false);
  });

  it("has distinct English and Arabic text for every shown state", () => {
    for (const state of ["failed", "retrying"] as const) {
      const en = resolveOutcomeSaveNotice(state, "en");
      const ar = resolveOutcomeSaveNotice(state, "ar");
      assert.ok(en && ar);
      assert.notEqual(en.message, ar.message);
      assert.ok(/[؀-ۿ]/.test(ar.message), "Arabic message contains Arabic script");
      assert.ok(/[؀-ۿ]/.test(ar.retryLabel), "Arabic retry label contains Arabic script");
    }
  });

  it("states plainly that the movement details were NOT saved, and claims nothing clinical", () => {
    const failed = resolveOutcomeSaveNotice("failed", "en");
    assert.ok(failed);
    assert.match(failed.message, /couldn't save your movement details/i);
    assert.doesNotMatch(
      failed.message,
      /\b(recover|improv|good|great|normal|score|progress|diagnos)/i,
      "status text only: no reassurance, score or clinical claim",
    );
  });
});

describe("InteractiveShoulderOutcomeSaveNotice (server-rendered markup)", () => {
  it("renders nothing when there is nothing to tell the patient", () => {
    for (const state of ["idle", "saving", "saved"] as const) {
      assert.equal(render(state, "en"), "", state);
    }
  });

  it("a failed save renders the message and an enabled retry button", () => {
    const html = render("failed", "en");
    assert.match(html, /data-testid="outcome-save-notice"/);
    assert.match(html, /data-state="failed"/);
    assert.match(html, /couldn&#x27;t save your movement details|couldn't save your movement details/i);
    assert.match(html, /<button[^>]*>Try saving again<\/button>/);
  });

  it("a hand retry in flight shows progress and no button", () => {
    const html = render("retrying", "en");
    assert.match(html, /data-state="retrying"/);
    assert.match(html, /Saving your movement details/);
    assert.doesNotMatch(html, /<button/);
  });

  it("renders right-to-left Arabic", () => {
    const html = render("failed", "ar");
    assert.match(html, /dir="rtl"/);
    assert.match(html, /تعذّر حفظ تفاصيل حركتك/);
    assert.match(html, /حاول الحفظ مرة أخرى/);
  });

  it("uses a polite live region so assistive technology announces the status", () => {
    const html = render("failed", "en");
    assert.match(html, /role="status"/);
    assert.match(html, /aria-live="polite"/);
  });
});

describe("CatalogPatientSessionPlayback wiring", () => {
  const source = read("app/components/patient/session/CatalogPatientSessionPlayback.tsx");

  it("submits through the bounded-retry helper, not a single fire-and-forget call", () => {
    assert.match(source, /submitInteractiveShoulderOutcomeWithRetry\(/);
    assert.doesNotMatch(source, /\bsubmitInteractiveShoulderOutcome\(\{/);
  });

  it("shows the notice on both the wrap-up and the completion screens", () => {
    const occurrences = source.match(/<InteractiveShoulderOutcomeSaveNotice/g) ?? [];
    assert.equal(occurrences.length, 2);
  });

  it("keeps the real snapshot for a manual retry only until it is saved", () => {
    assert.match(source, /pendingOutcomeSnapshotRef\.current = snapshot/);
    assert.match(source, /if \(result\.ok\) pendingOutcomeSnapshotRef\.current = null/);
  });

  it("marks the save 'submitted' only on a genuine success", () => {
    assert.match(source, /movementOutcomeSubmissionRef\.current = result\.ok \? "submitted" : "idle"/);
    assert.match(source, /setOutcomeSaveState\(result\.ok \? "saved" : "failed"\)/);
  });

  it("clears the pending snapshot and invalidates in-flight work when the session changes", () => {
    assert.match(source, /pendingOutcomeSnapshotRef\.current = null;\s*\r?\n\s*outcomeSubmissionGenerationRef\.current \+= 1;/);
  });
});
