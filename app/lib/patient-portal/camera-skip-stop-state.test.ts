/**
 * Run: npx tsx --test app/lib/patient-portal/camera-skip-stop-state.test.ts
 *
 * Real-UI QA regression: "Skip camera is visible on the consent screen, the button does
 * not respond to click."
 *
 * Interactive Shoulder is camera-dependent — there is no non-camera fallback — so
 * declining camera must land on an honest "Camera access is required" STOP state with a
 * "Try again" that returns to the session start. It must never continue the exercise
 * without a camera.
 *
 * THE BUG THIS PROTECTS AGAINST
 * A patient session reaches the Interactive Shoulder consent screen through one of TWO
 * routes, chosen by whether the plan API attached catalog provenance:
 *
 *   catalog  → CatalogPatientSessionPlayback → CatalogSessionPlayer  → core
 *   legacy   → patient session route → PatientExerciseSessionCard → ExerciseMediaArea → core
 *
 * The consent screen's Skip button is `onClick={onSkipped}` in the shared core, so each
 * route supplies its own handler. The catalog route was wired to a real stop state; the
 * legacy route was wired to `markSkipped`, which only sets the capture hook's `cvStatus`
 * — a value that route never reads, and does not even destructure. The click therefore
 * changed nothing on screen and the button read as completely dead.
 *
 * That is the invariant these tests enforce: on BOTH routes the skip handler must set
 * state the SAME file actually renders. A handler that is merely "defined" is not
 * enough — that was already true of the broken route.
 *
 * HARNESS LIMITATION, STATED PLAINLY: this repository has no DOM, React renderer, or
 * E2E tooling, so the acceptance flow below is exercised as a deterministic model of
 * each route's real transitions, and every transition in that model is bound to the
 * shipped source by an assertion so the model cannot drift away from the code. This is
 * NOT a real-browser click test.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { guidedSessionUi } from "@/app/lib/patient-portal-ui";

const read = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

const CORE = "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx";
const LEGACY_ROUTE = "app/patient/[token]/session/[sessionId]/page.tsx";
const CATALOG_ROUTE = "app/components/patient/session/CatalogPatientSessionPlayback.tsx";
const MEDIA_AREA = "app/components/patient/ExerciseMediaArea.tsx";

/* ── 1. The control itself must be clickable before consent ────────────────── */

describe("camera skip — the control is clickable without accepting consent", () => {
  const core = read(CORE);

  it("renders the Skip button inside the pre-consent branch", () => {
    const preConsent = core.slice(core.indexOf("{!consentAccepted ? ("));
    const consentBranch = preConsent.slice(0, preConsent.indexOf(") : ("));
    assert.ok(
      consentBranch.includes("{ui.skipCamera}"),
      "Skip camera must be offered on the consent screen itself, before consent is given",
    );
  });

  it("gives the Skip button a real click handler and never disables it", () => {
    const button = core.slice(
      core.lastIndexOf("<button", core.indexOf("{ui.skipCamera}")),
      core.indexOf("{ui.skipCamera}"),
    );
    assert.match(button, /onClick=\{onSkipped\}/, "the Skip button must have a click handler");
    assert.ok(
      !button.includes("disabled"),
      "Skip must never be gated on the consent checkbox — declining is the whole point",
    );
    assert.match(button, /type="button"/, "must not submit an enclosing form");
  });

  it("keeps the accept-consent path independent of Skip", () => {
    // Guards against a fix that makes Skip work by breaking the normal path.
    assert.match(core, /onClick=\{acceptConsent\}/);
    assert.match(core, /disabled=\{!consentChecked\}/);
  });
});

/* ── 2. Both routes must supply a handler that changes what is rendered ────── */

/**
 * The core assertion. Extracts the state setter a route's skip handler calls, then
 * proves the SAME file reads that state in a render branch. `markSkipped` alone passed
 * a "handler is defined" check and still did nothing visible.
 */
function assertSkipStateIsRendered(options: {
  source: string;
  routeName: string;
  setterCall: string;
  renderGuard: RegExp;
}) {
  assert.ok(
    options.source.includes(options.setterCall),
    `${options.routeName}: the skip handler must set state (${options.setterCall})`,
  );
  assert.match(
    options.source,
    options.renderGuard,
    `${options.routeName}: the state the skip handler sets must be READ by a render ` +
      `branch in this same file — a handler whose state nothing renders is a dead button`,
  );
}

describe("camera skip — both patient routes reach the stop state", () => {
  const legacy = read(LEGACY_ROUTE);
  const catalog = read(CATALOG_ROUTE);

  it("legacy patient session route wires Skip to a rendered stop state", () => {
    assert.match(
      legacy,
      /onCvSkipped=\{handleCvSkipped\}/,
      "must not pass markSkipped directly — that was the dead-button bug",
    );
    assert.match(
      legacy,
      /function handleCvSkipped\(\)\s*\{[\s\S]*?markSkipped\(\);[\s\S]*?setCameraDeclined\(true\);[\s\S]*?\}/,
      "skip must still record the capture status AND raise the visible stop state",
    );
    assertSkipStateIsRendered({
      source: legacy,
      routeName: "legacy route",
      setterCall: "setCameraDeclined(true)",
      renderGuard: /if \(cameraDeclined\) \{/,
    });
  });

  it("catalog playback route wires Skip to a rendered stop state", () => {
    assert.match(catalog, /onSkipped=\{handleCameraSkipped\}/);
    assertSkipStateIsRendered({
      source: catalog,
      routeName: "catalog route",
      setterCall: 'setPhase("cameraDeclined")',
      renderGuard: /if \(phase === "cameraDeclined"\) \{/,
    });
  });

  it("both routes render the same camera-required stop copy", () => {
    for (const [name, source] of [["legacy", legacy], ["catalog", catalog]] as const) {
      assert.ok(
        source.includes("guidedUi.cameraRequiredTitle") &&
          source.includes("guidedUi.cameraRequiredBody") &&
          source.includes("guidedUi.cameraRequiredRetry"),
        `${name} route must show the shared camera-required stop state`,
      );
    }
  });

  it("supplies that copy in both languages", () => {
    for (const lang of ["en", "ar"] as const) {
      const ui = guidedSessionUi(lang);
      for (const key of ["cameraRequiredTitle", "cameraRequiredBody", "cameraRequiredRetry"] as const) {
        assert.ok(
          typeof ui[key] === "string" && ui[key].trim().length > 0,
          `${lang}.${key} must be a non-empty string`,
        );
      }
    }
  });
});

/* ── 3. Try again returns to the session start ─────────────────────────────── */

describe("camera skip — Try again returns to the session start", () => {
  it("legacy route clears the stop state and returns to the exercise start step", () => {
    const legacy = read(LEGACY_ROUTE);
    const stopBranch = legacy.slice(legacy.indexOf("if (cameraDeclined) {"));
    const retry = stopBranch.slice(0, stopBranch.indexOf("cameraRequiredRetry"));
    assert.match(retry, /setCameraDeclined\(false\)/, "Try again must clear the stop state");
    assert.match(
      retry,
      /setPhase\("start"\)/,
      "Try again must return to the session start, matching the catalog route's retry",
    );
    assert.match(
      retry,
      /setExerciseStep\("preview"\)/,
      "the step must leave \"active\" so the Interactive Shoulder session unmounts and " +
        "no camera is left initialising behind the stop screen",
    );
  });

  it("catalog route returns to the start phase", () => {
    const catalog = read(CATALOG_ROUTE);
    const stopBranch = catalog.slice(catalog.indexOf('if (phase === "cameraDeclined") {'));
    const retry = stopBranch.slice(0, stopBranch.indexOf("cameraRequiredRetry"));
    assert.match(retry, /setPhase\("start"\)/);
  });
});

/* ── 4. The stop state must not leave a camera running behind it ───────────── */

describe("camera skip — declining does not start or keep a camera", () => {
  it("the legacy route only mounts Interactive Shoulder at the active step", () => {
    // "Try again" sets the step back to "preview", so the session unmounts and no
    // detector survives behind the stop screen.
    assert.match(
      read(MEDIA_AREA),
      /const showInteractiveShoulder =\s*exerciseStep === "active" && isInteractiveShoulderSessionWired\(exerciseId\)/,
    );
  });

  it("the stop state replaces the session rather than rendering alongside it", () => {
    const legacy = read(LEGACY_ROUTE);
    assert.ok(
      legacy.indexOf("if (cameraDeclined) {") <
        legacy.indexOf("<PatientExerciseSessionCard"),
      "the stop state must return before the exercise card, so the camera UI is gone",
    );
    const catalog = read(CATALOG_ROUTE);
    assert.ok(
      catalog.indexOf('if (phase === "cameraDeclined") {') <
        catalog.indexOf("<CatalogSessionPlayer"),
      "the stop state must return before the player, so the camera UI is gone",
    );
  });

  it("skipping never starts capture — camera start still requires accepted consent", () => {
    // The shared guard both routes rely on. Skip cannot reach it because it never
    // accepts consent, and this asserts the guard is still consent-gated.
    assert.match(
      read("app/lib/interactive-shoulder/orchestrator-cv-detector-lifecycle.ts"),
      /consentAccepted/,
      "camera start must remain gated on accepted consent",
    );
  });
});

/* ── 5. The full acceptance flow, A → G ────────────────────────────────────── */

/**
 * Deterministic model of each route's real transitions. Every transition here is the
 * one asserted against the shipped source above, so this exercises the accepted flow
 * end to end without a DOM.
 */
type Screen = "sessionStart" | "consent" | "cameraRequired";

function createRouteModel(route: "legacy" | "catalog") {
  let screen: Screen = "sessionStart";
  let cameraStarted = false;
  return {
    get screen() {
      return screen;
    },
    get cameraStarted() {
      return cameraStarted;
    },
    begin() {
      screen = "consent";
    },
    /** The consent screen offers Skip regardless of the checkbox — never disabled. */
    canClickSkip() {
      return screen === "consent";
    },
    clickSkip() {
      assert.ok(this.canClickSkip(), `${route}: Skip must be clickable on the consent screen`);
      screen = "cameraRequired";
    },
    clickTryAgain() {
      assert.equal(screen, "cameraRequired");
      screen = "sessionStart";
    },
    acceptConsent() {
      assert.equal(screen, "consent");
      cameraStarted = true;
    },
  };
}

describe("camera skip — acceptance flow", () => {
  for (const route of ["legacy", "catalog"] as const) {
    it(`${route} route: consent → Skip → Camera access is required → Try again → session start`, () => {
      const ui = createRouteModel(route);

      // A/B/C — reach consent without accepting it, Skip is offered
      ui.begin();
      assert.equal(ui.screen, "consent");
      assert.equal(ui.canClickSkip(), true, "Skip must be clickable without accepting consent");

      // D/E — clicking Skip opens the stop state
      ui.clickSkip();
      assert.equal(ui.screen, "cameraRequired");
      assert.equal(ui.cameraStarted, false, "declining must never start the camera");

      // F/G — Try again returns to the session start
      ui.clickTryAgain();
      assert.equal(ui.screen, "sessionStart");
      assert.equal(ui.cameraStarted, false);
    });

    it(`${route} route: accepting consent still follows the normal path`, () => {
      const ui = createRouteModel(route);
      ui.begin();
      ui.acceptConsent();
      assert.equal(ui.cameraStarted, true, "the normal camera path must be unaffected");
      assert.notEqual(ui.screen, "cameraRequired", "accepting must not show the stop state");
    });
  }
});
