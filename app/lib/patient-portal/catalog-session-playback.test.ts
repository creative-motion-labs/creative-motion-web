/**
 * Run: npx tsx --test app/lib/patient-portal/catalog-session-playback.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { PatientSession } from "@/app/api/patient/plan/route";
import { STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1 } from "@/app/lib/rehab-programs/stroke-upper-limb-recovery-foundation";
import {
  isCatalogPlaybackSession,
  PATIENT_SESSION_COMPLETE_NETWORK_ERROR,
  submitPatientSessionComplete,
} from "./catalog-session-playback";

const LEGACY_SESSION: PatientSession = {
  id: "legacy-session-id",
  sessionNumber: 1,
  title: "Legacy Session",
  exercises: [
    {
      exerciseId: "upper-limb-reaching-seated",
      name: "Reach",
      patientInstructions: "Reach comfortably.",
    },
  ],
  status: "today",
};

const CATALOG_SESSION: PatientSession = {
  id: "catalog-plan-session-id",
  sessionNumber: 1,
  title: "Catalog Session",
  exercises: [],
  status: "today",
  catalogSession: STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1,
};

const FAILED_CATALOG_SESSION: PatientSession = {
  id: "failed-catalog-plan-session-id",
  sessionNumber: 1,
  title: "Failed Catalog Session",
  exercises: [],
  status: "today",
  catalogSession: null,
};

describe("catalog session playback selection", () => {
  it("selects catalog playback when catalogSession key is present with a ProgramSession", () => {
    assert.equal(isCatalogPlaybackSession(CATALOG_SESSION), true);
  });

  it("selects catalog playback when catalogSession key is present but null", () => {
    assert.equal(isCatalogPlaybackSession(FAILED_CATALOG_SESSION), true);
  });

  it("preserves legacy playback when catalogSession key is absent", () => {
    assert.equal(isCatalogPlaybackSession(LEGACY_SESSION), false);
  });

  it("does not infer catalog playback from an empty exercises array alone", () => {
    const emptyLegacy: PatientSession = {
      ...LEGACY_SESSION,
      exercises: [],
    };
    assert.equal(isCatalogPlaybackSession(emptyLegacy), false);
  });
});

describe("patient session route integration contracts", () => {
  it("routes catalog sessions to CatalogPatientSessionPlayback before legacy exercise flow", () => {
    const pagePath = join(
      process.cwd(),
      "app/patient/[token]/session/[sessionId]/page.tsx",
    );
    const source = readFileSync(pagePath, "utf8");
    assert.match(source, /isCatalogPlaybackSession\(session\)/);
    assert.match(source, /<CatalogPatientSessionPlayback/);
    assert.match(source, /onPlanRefresh=\{refreshPlan\}/);
    const catalogBranch = source.slice(
      source.indexOf("isCatalogPlaybackSession(session)"),
      source.indexOf("const exercises = session.exercises"),
    );
    assert.match(catalogBranch, /CatalogPatientSessionPlayback/);
    assert.doesNotMatch(catalogBranch, /PatientExerciseSessionCard/);
  });

  it("does not nest CatalogSessionPlayer inside PatientExerciseSessionCard", () => {
    const playbackPath = join(
      process.cwd(),
      "app/components/patient/session/CatalogPatientSessionPlayback.tsx",
    );
    const cardPath = join(
      process.cwd(),
      "app/components/patient/PatientExerciseSessionCard.tsx",
    );
    const playbackSource = readFileSync(playbackPath, "utf8");
    const cardSource = readFileSync(cardPath, "utf8");
    assert.match(playbackSource, /<CatalogSessionPlayer/);
    assert.doesNotMatch(cardSource, /CatalogSessionPlayer/);
  });

  it("does not route catalog playback based on exercise IDs", () => {
    const pagePath = join(
      process.cwd(),
      "app/patient/[token]/session/[sessionId]/page.tsx",
    );
    const source = readFileSync(pagePath, "utf8");
    const catalogBranch = source.slice(
      source.indexOf("isCatalogPlaybackSession(session)"),
      source.indexOf("const exercises = session.exercises"),
    );
    assert.doesNotMatch(catalogBranch, /exerciseId/);
    assert.doesNotMatch(catalogBranch, /isInteractiveShoulderSessionWired/);
  });

  it("does not fall back to legacy playback when catalogSession is null", () => {
    const playbackPath = join(
      process.cwd(),
      "app/components/patient/session/CatalogPatientSessionPlayback.tsx",
    );
    const source = readFileSync(playbackPath, "utf8");
    assert.match(source, /programSession=\{catalogSession\}/);
    assert.doesNotMatch(source, /PatientExerciseSessionCard/);
    assert.doesNotMatch(source, /\bInteractiveShoulderSession\b/);
  });

  it("preserves InteractiveShoulderSession legacy wiring inside PatientExerciseSessionCard", () => {
    const cardPath = join(
      process.cwd(),
      "app/components/patient/PatientExerciseSessionCard.tsx",
    );
    const source = readFileSync(cardPath, "utf8");
    assert.match(source, /InteractiveShoulderSession/);
    assert.doesNotMatch(source, /CatalogSessionPlayer/);
  });
});

describe("catalog session completion wiring", () => {
  it("wires onSessionComplete to the route-layer completion flow", () => {
    const playbackPath = join(
      process.cwd(),
      "app/components/patient/session/CatalogPatientSessionPlayback.tsx",
    );
    const helperPath = join(
      process.cwd(),
      "app/lib/patient-portal/catalog-session-playback.ts",
    );
    const source = readFileSync(playbackPath, "utf8");
    const helperSource = readFileSync(helperPath, "utf8");
    assert.match(source, /onSessionComplete=\{handleCatalogSessionComplete\}/);
    assert.match(source, /submitPatientSessionComplete/);
    assert.match(helperSource, /\/api\/patient\/session-complete/);
    assert.doesNotMatch(source, /onSessionComplete=\{handleSubmitSession\}/);
  });

  it("guards full-session completion transition and submission to once per session", () => {
    const playbackPath = join(
      process.cwd(),
      "app/components/patient/session/CatalogPatientSessionPlayback.tsx",
    );
    const source = readFileSync(playbackPath, "utf8");
    assert.match(source, /cvSessionCompleteRef/);
    assert.match(source, /submitStartedRef/);
    assert.match(source, /if \(cvSessionCompleteRef\.current\) return;/);
    assert.match(source, /if \(completing \|\| completed \|\| submitStartedRef\.current\) return;/);
  });

  it("does not submit patient session completion from CatalogSessionPlayer or runtime core", () => {
    const playerPath = join(
      process.cwd(),
      "app/components/patient/interactive-shoulder/CatalogSessionPlayer.tsx",
    );
    const corePath = join(
      process.cwd(),
      "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx",
    );
    const playerSource = readFileSync(playerPath, "utf8");
    const coreSource = readFileSync(corePath, "utf8");
    assert.doesNotMatch(playerSource, /session-complete/);
    assert.doesNotMatch(coreSource, /session-complete/);
  });

  it("submitPatientSessionComplete posts the existing session-complete contract once", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      calls.push({
        url: String(input),
        init: init ?? {},
      });
      return new Response(
        JSON.stringify({ id: "log-id", completed_at: "2026-07-26T07:00:00.000Z" }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const result = await submitPatientSessionComplete({
        token: "patient-token",
        sessionId: "plan-session-id",
        effortScore: 4,
        painScore: 2,
        exercisesCompleted: 0,
        notes: null,
      });
      assert.equal(result.ok, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.url, "/api/patient/session-complete");
      const body = JSON.parse(String(calls[0]?.init.body));
      assert.equal(body.token, "patient-token");
      assert.equal(body.sessionId, "plan-session-id");
      assert.equal(body.exercisesCompleted, 0);
      assert.equal(body.effortScore, 4);
      assert.equal(body.painScore, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns an explicit failure when session-complete rejects the request", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Could not record session completion." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    try {
      const result = await submitPatientSessionComplete({
        token: "patient-token",
        sessionId: "plan-session-id",
        effortScore: null,
        painScore: null,
        exercisesCompleted: 0,
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.error, /Could not record session completion/);
      assert.equal(result.status, 500);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns a safe failure when fetch rejects with a network error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;

    try {
      const result = await submitPatientSessionComplete({
        token: "patient-token",
        sessionId: "plan-session-id",
        effortScore: 4,
        painScore: 2,
        exercisesCompleted: 0,
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error, PATIENT_SESSION_COMPLETE_NETWORK_ERROR);
      assert.equal(result.status, 0);
      assert.doesNotMatch(result.error, /patient-token/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("shows localized saveError instead of raw API/helper error text", () => {
    const playbackPath = join(
      process.cwd(),
      "app/components/patient/session/CatalogPatientSessionPlayback.tsx",
    );
    const source = readFileSync(playbackPath, "utf8");
    assert.match(source, /\{shellUi\.saveError\}/);
    assert.doesNotMatch(source, /result\.error/);
    assert.doesNotMatch(source, /setCompleteError\(result\.error\)/);
    assert.match(source, /sessionShellUi\(patientLanguage\)/);
  });

  it("resets completing and submitStartedRef after failed save so the patient can retry", () => {
    const playbackPath = join(
      process.cwd(),
      "app/components/patient/session/CatalogPatientSessionPlayback.tsx",
    );
    const source = readFileSync(playbackPath, "utf8");
    assert.match(source, /setCompleting\(false\)/);
    assert.match(source, /submitStartedRef\.current = false/);
    assert.match(source, /try \{[\s\S]*submitPatientSessionComplete/);
  });

  it("does not expose technical errors in CatalogSessionPlayer patient UI", () => {
    const playerPath = join(
      process.cwd(),
      "app/components/patient/interactive-shoulder/CatalogSessionPlayer.tsx",
    );
    const source = readFileSync(playerPath, "utf8");
    assert.match(source, /catalogSessionConfigErrorTitle/);
    assert.doesNotMatch(source, /error\.message/);
    assert.doesNotMatch(source, /programSession\.id/);
  });
});

describe("catalog session route localization contracts", () => {
  it("passes language, text direction, and Arabic layout class into catalog playback", () => {
    const playbackPath = join(
      process.cwd(),
      "app/components/patient/session/CatalogPatientSessionPlayback.tsx",
    );
    const source = readFileSync(playbackPath, "utf8");
    assert.match(source, /lang=\{patientLanguage\}/);
    assert.match(source, /textDir=\{textDir\}/);
    assert.match(source, /arClass=\{arClass\}/);
    assert.match(source, /language=\{patientLanguage\}/);
  });
});

describe("catalog session completion display contracts", () => {
  it("hides exercise count on catalog completion and already-complete screens", () => {
    const playbackPath = join(
      process.cwd(),
      "app/components/patient/session/CatalogPatientSessionPlayback.tsx",
    );
    const source = readFileSync(playbackPath, "utf8");
    assert.match(source, /<GuidedSessionCompleteScreen[\s\S]*hideExerciseCount/);
    assert.match(source, /<GuidedSessionAlreadyCompleteScreen[\s\S]*hideExerciseCount/);
    assert.match(source, /exercisesCompleted=\{0\}/);
  });

  it("GuidedSessionCompleteScreen hides exercise count only when hideExerciseCount is set", () => {
    const flowPath = join(
      process.cwd(),
      "app/components/patient/session/PatientGuidedSessionFlow.tsx",
    );
    const source = readFileSync(flowPath, "utf8");
    assert.match(source, /hideExerciseCount = false/);
    assert.match(source, /!hideExerciseCount \? \([\s\S]*exercisesCompletedCount\(exercisesCompleted\)/);
  });

  it("GuidedSessionAlreadyCompleteScreen hides exercise count only when hideExerciseCount is set", () => {
    const flowPath = join(
      process.cwd(),
      "app/components/patient/session/PatientGuidedSessionFlow.tsx",
    );
    const source = readFileSync(flowPath, "utf8");
    const alreadyBlock = source.slice(
      source.indexOf("export function GuidedSessionAlreadyCompleteScreen"),
      source.indexOf("export type { ResolvedExerciseView }"),
    );
    assert.match(alreadyBlock, /hideExerciseCount = false/);
    assert.match(alreadyBlock, /!hideExerciseCount \? ui\.exercisesCompletedCount\(totalExercises\)/);
  });

  it("legacy session page still shows exercise count by default", () => {
    const pagePath = join(
      process.cwd(),
      "app/patient/[token]/session/[sessionId]/page.tsx",
    );
    const source = readFileSync(pagePath, "utf8");
    assert.match(source, /exercisesCompleted=\{completionSummary\.exercisesCompleted\}/);
    assert.doesNotMatch(source, /hideExerciseCount/);
  });
});

describe("session start title deduplication", () => {
  it("keeps the session title only in GuidedSessionShell heading", () => {
    const flowPath = join(
      process.cwd(),
      "app/components/patient/session/PatientGuidedSessionFlow.tsx",
    );
    const source = readFileSync(flowPath, "utf8");
    const startBlock = source.slice(
      source.indexOf("export function GuidedSessionStartScreen"),
      source.indexOf("export function GuidedSessionExerciseHero"),
    );

    assert.match(source, /<h1[\s\S]*\{sessionTitle\}/);
    assert.doesNotMatch(startBlock, /startTitle\(/);
    assert.match(startBlock, /startSubtitle/);
  });

  it("shows only session context inside catalog start card", () => {
    const playbackPath = join(
      process.cwd(),
      "app/components/patient/session/CatalogPatientSessionPlayback.tsx",
    );
    const source = readFileSync(playbackPath, "utf8");
    const cardBlock = source.slice(
      source.indexOf("{guidedUi.startEyebrow}"),
      source.indexOf("{guidedUi.safetyReminder}"),
    );

    assert.doesNotMatch(cardBlock, /\{sessionDisplay\.title\}/);
    assert.match(cardBlock, /sessionDisplay\.goal/);
  });
});
