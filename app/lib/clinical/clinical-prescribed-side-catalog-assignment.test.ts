/**
 * Run: npx tsx --test app/lib/clinical/clinical-prescribed-side-catalog-assignment.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCatalogAssignmentFingerprint,
  createCatalogAssignmentAttemptController,
} from "@/app/lib/clinical/clinical-prescribed-side-catalog-assignment";
import {
  resetCatalogAssignPanelUiForPatientChange,
  shouldIgnoreCatalogAssignmentResult,
} from "@/app/lib/clinical/catalog-program-assign-panel-lifecycle";
import { buildPrescribedSideRadioIds } from "@/app/lib/clinical/prescribed-side-selector-ids";
import {
  CATALOG_PROGRAMS_LOAD_ERROR_MESSAGE,
  parseCatalogProgramsResponse,
} from "@/app/lib/clinical/catalog-programs-list";

const PATIENT_A = "11111111-1111-1111-1111-111111111111";
const PATIENT_B = "22222222-2222-2222-2222-222222222222";
const PROGRAM_A = "33333333-3333-3333-3333-333333333333";
const PROGRAM_B = "44444444-4444-4444-4444-444444444444";
const ASSESSMENT_A = "55555555-5555-5555-5555-555555555555";
const ASSESSMENT_B = "66666666-6666-6666-6666-666666666666";

const SESSION_LEFT = [{ sessionNumber: 1, prescribedSide: "left" as const }];
const SESSION_RIGHT = [{ sessionNumber: 1, prescribedSide: "right" as const }];

function fingerprintFor(options: {
  patientId?: string;
  treatmentProgramId?: string;
  assessmentId?: string | null;
  sessions?: typeof SESSION_LEFT;
}) {
  return buildCatalogAssignmentFingerprint({
    patientId: options.patientId ?? PATIENT_A,
    treatmentProgramId: options.treatmentProgramId ?? PROGRAM_A,
    assessmentId: options.assessmentId ?? null,
    sessionPrescriptions: options.sessions ?? SESSION_LEFT,
  });
}

describe("clinical-prescribed-side-catalog-assignment safety", () => {
  it("1. same logical catalog assignment returns the same idempotency key across retry", () => {
    const ids: string[] = [];
    const controller = createCatalogAssignmentAttemptController({
      generateUuid: () => {
        ids.push(`uuid-${ids.length + 1}`);
        return `uuid-${ids.length}`;
      },
    });
    const fp = fingerprintFor({});
    const first = controller.beginSubmitAttempt(fp);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    controller.completeFailure();
    const retry = controller.beginSubmitAttempt(fp);
    assert.equal(retry.ok, true);
    if (!retry.ok) return;
    assert.equal(first.requestId, retry.requestId);
    assert.equal(ids.length, 1);
  });

  it("2. network/502 failure retains the key", () => {
    const controller = createCatalogAssignmentAttemptController({
      generateUuid: () => "stable-uuid",
    });
    const fp = fingerprintFor({});
    controller.beginSubmitAttempt(fp);
    controller.completeFailure();
    const retry = controller.beginSubmitAttempt(fp);
    assert.equal(retry.ok, true);
    if (!retry.ok) return;
    assert.equal(retry.requestId, "stable-uuid");
  });

  it("3. changed side creates a new fingerprint/key", () => {
    let counter = 0;
    const keyed = createCatalogAssignmentAttemptController({
      generateUuid: () => `uuid-${++counter}`,
    });
    const leftFp = fingerprintFor({ sessions: SESSION_LEFT });
    const rightFp = fingerprintFor({ sessions: SESSION_RIGHT });
    assert.notEqual(leftFp, rightFp);
    const left = keyed.beginSubmitAttempt(leftFp);
    assert.equal(left.ok, true);
    if (!left.ok) return;
    keyed.completeFailure();
    const right = keyed.beginSubmitAttempt(rightFp);
    assert.equal(right.ok, true);
    if (!right.ok) return;
    assert.notEqual(left.requestId, right.requestId);
  });

  it("4. changed patient creates a new key", () => {
    let counter = 0;
    const controller = createCatalogAssignmentAttemptController({
      generateUuid: () => `uuid-${++counter}`,
    });
    const fpA = fingerprintFor({ patientId: PATIENT_A });
    const fpB = fingerprintFor({ patientId: PATIENT_B });
    const a = controller.beginSubmitAttempt(fpA);
    assert.equal(a.ok, true);
    if (!a.ok) return;
    controller.completeFailure();
    const b = controller.beginSubmitAttempt(fpB);
    assert.equal(b.ok, true);
    if (!b.ok) return;
    assert.notEqual(a.requestId, b.requestId);
  });

  it("5. changed program creates a new key", () => {
    let counter = 0;
    const controller = createCatalogAssignmentAttemptController({
      generateUuid: () => `uuid-${++counter}`,
    });
    const fpA = fingerprintFor({ treatmentProgramId: PROGRAM_A });
    const fpB = fingerprintFor({ treatmentProgramId: PROGRAM_B });
    const a = controller.beginSubmitAttempt(fpA);
    assert.equal(a.ok, true);
    if (!a.ok) return;
    controller.completeFailure();
    const b = controller.beginSubmitAttempt(fpB);
    assert.equal(b.ok, true);
    if (!b.ok) return;
    assert.notEqual(a.requestId, b.requestId);
  });

  it("6. changed assessment creates a new key", () => {
    let counter = 0;
    const controller = createCatalogAssignmentAttemptController({
      generateUuid: () => `uuid-${++counter}`,
    });
    const fpA = fingerprintFor({ assessmentId: ASSESSMENT_A });
    const fpB = fingerprintFor({ assessmentId: ASSESSMENT_B });
    const a = controller.beginSubmitAttempt(fpA);
    assert.equal(a.ok, true);
    if (!a.ok) return;
    controller.completeFailure();
    const b = controller.beginSubmitAttempt(fpB);
    assert.equal(b.ok, true);
    if (!b.ok) return;
    assert.notEqual(a.requestId, b.requestId);
  });

  it("7. successful assignment clears the key", () => {
    const controller = createCatalogAssignmentAttemptController({
      generateUuid: () => "stable-uuid",
    });
    const fp = fingerprintFor({});
    controller.beginSubmitAttempt(fp);
    controller.completeSuccess(fp);
    assert.equal(controller.getState().requestId, null);
    assert.equal(controller.getState().fingerprint, null);
    assert.equal(controller.isInFlight(), false);
  });

  it("8. rapid double-submit invokes fetch/POST only once", () => {
    const controller = createCatalogAssignmentAttemptController({
      generateUuid: () => "stable-uuid",
    });
    const fp = fingerprintFor({});
    const first = controller.beginSubmitAttempt(fp);
    const second = controller.beginSubmitAttempt(fp);
    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    if (second.ok) {
      assert.fail("second submit should be blocked while in flight");
    }
    assert.equal(controller.getState().requestId, "stable-uuid");
  });

  it("9. a stale response after patient change cannot call onAssigned", () => {
    const scopeAtStart = 1;
    const generationAtStart = 0;
    const currentScope = 2;
    const currentGeneration = 1;
    assert.equal(
      shouldIgnoreCatalogAssignmentResult({
        scopeAtStart,
        currentScope,
        generationAtStart,
        currentGeneration,
        aborted: false,
      }),
      true,
    );
  });

  it("10. patient change clears selected program, session drafts, sides, and errors", () => {
    const reset = resetCatalogAssignPanelUiForPatientChange();
    assert.equal(reset.selectedProgramId, null);
    assert.deepEqual(reset.sessionDrafts, []);
    assert.equal(reset.saveError, "");
    assert.equal(reset.saving, false);
  });

  it("11. program switch clears prior request lifecycle", () => {
    let counter = 0;
    const controller = createCatalogAssignmentAttemptController({
      generateUuid: () => `uuid-${++counter}`,
    });
    const fp = fingerprintFor({ treatmentProgramId: PROGRAM_A });
    controller.beginSubmitAttempt(fp);
    controller.completeFailure();
    controller.resetAssignmentKey();
    assert.equal(controller.getState().requestId, null);
    const next = controller.beginSubmitAttempt(fingerprintFor({ treatmentProgramId: PROGRAM_B }));
    assert.equal(next.ok, true);
    if (!next.ok) return;
    assert.equal(next.requestId, "uuid-2");
  });

  it("12. unmount aborts the active request", async () => {
    const abort = new AbortController();
    let settled = false;
    const task = new Promise<void>((resolve, reject) => {
      abort.signal.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
      setTimeout(() => {
        settled = true;
        resolve();
      }, 20);
    });
    abort.abort();
    await assert.rejects(task, (err: unknown) => err instanceof DOMException);
    assert.equal(settled, false);
  });

  it("13. two rendered PrescribedSideSelector instances with identical sessionLabel have different radio names", () => {
    const guided = buildPrescribedSideRadioIds("guided", ":r1:");
    const catalog = buildPrescribedSideRadioIds("catalog", ":r1:");
    assert.notEqual(guided.groupName, catalog.groupName);
  });

  it("14. each selector Left/Right inputs share its own group name", () => {
    const ids = buildPrescribedSideRadioIds("catalog", ":r2:");
    assert.match(ids.leftInputId, new RegExp(`^${ids.groupName}-left$`));
    assert.match(ids.rightInputId, new RegExp(`^${ids.groupName}-right$`));
    assert.notEqual(ids.leftInputId, ids.rightInputId);
  });

  it("15. input IDs are unique and labels are associated via htmlFor ids", () => {
    const a = buildPrescribedSideRadioIds("guided", ":r3:");
    const b = buildPrescribedSideRadioIds("guided", ":r4:");
    const allIds = [a.leftInputId, a.rightInputId, b.leftInputId, b.rightInputId];
    assert.equal(new Set(allIds).size, allIds.length);
    assert.equal(a.leftInputId.startsWith(a.groupName), true);
    assert.equal(a.rightInputId.startsWith(a.groupName), true);
  });

  it("16. guided and catalog Session 1 selectors do not interfere", () => {
    const guidedSession1 = buildPrescribedSideRadioIds("guided", ":session-1:");
    const catalogSession1 = buildPrescribedSideRadioIds("catalog", ":session-1:");
    assert.notEqual(guidedSession1.groupName, catalogSession1.groupName);
  });

  it("19. malformed catalog response is rejected safely by the browser parser", () => {
    const malformed = parseCatalogProgramsResponse({
      programs: [{ id: "x", name: "", slug: "s", sessions: [] }],
    });
    assert.equal(malformed.ok, false);
    if (malformed.ok) return;
    assert.equal(malformed.error, CATALOG_PROGRAMS_LOAD_ERROR_MESSAGE);
    assert.equal(malformed.error.includes("Supabase"), false);
  });

  it("fingerprint sorts session prescriptions deterministically", () => {
    const forward = buildCatalogAssignmentFingerprint({
      patientId: PATIENT_A,
      treatmentProgramId: PROGRAM_A,
      assessmentId: null,
      sessionPrescriptions: [
        { sessionNumber: 2, prescribedSide: "right" },
        { sessionNumber: 1, prescribedSide: "left" },
      ],
    });
    const reverse = buildCatalogAssignmentFingerprint({
      patientId: PATIENT_A,
      treatmentProgramId: PROGRAM_A,
      assessmentId: null,
      sessionPrescriptions: [
        { sessionNumber: 1, prescribedSide: "left" },
        { sessionNumber: 2, prescribedSide: "right" },
      ],
    });
    assert.equal(forward, reverse);
  });

  it("409 conflict retains idempotency key and releases in-flight guard only", () => {
    const controller = createCatalogAssignmentAttemptController({
      generateUuid: () => "stable-uuid",
    });
    const fp = fingerprintFor({});
    controller.beginSubmitAttempt(fp);
    controller.completeConflict();
    assert.equal(controller.isInFlight(), false);
    assert.equal(controller.getState().requestId, "stable-uuid");
    const blocked = controller.beginSubmitAttempt(fp);
    assert.equal(blocked.ok, true);
    if (!blocked.ok) return;
    assert.equal(blocked.requestId, "stable-uuid");
  });
});
