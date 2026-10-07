/**
 * Run: npx tsx --test app/lib/interactive-shoulder/orchestrator-cv-locale-session-lifecycle.test.ts
 *
 * Regression coverage for #286 — locale switching must not restart the Interactive
 * Shoulder session or clear therapeutic targets.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { MovementBlock } from "@/app/lib/session-orchestrator/types";
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import { toSessionDefinition } from "@/app/lib/rehab-programs/rehab-program-runtime-adapter";
import { STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1 } from "@/app/lib/rehab-programs/stroke-upper-limb-recovery-foundation";
import {
  disposeOrchestratorCvDetector,
  mountOrchestratorCvDetector,
  shouldStartOrchestratorCvCamera,
  type OrchestratorCvActiveDetectorHandle,
} from "./orchestrator-cv-detector-lifecycle";
import { resolveOrchestratorTherapeuticSide } from "./resolve-interactive-shoulder-side";
import {
  createInitialTargetLifecycle,
  type TargetLifecycleState,
} from "./target-lifecycle";
import type { TherapeuticTarget } from "./types";
import {
  interactiveShoulderUi,
  resolveInteractiveShoulderStartError,
} from "./interactive-shoulder-ui";

const STABLE_BLOCKS: readonly Pick<MovementBlock, "side">[] = toSessionDefinition(
  STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1,
).blocks;

type Deps = readonly unknown[] | undefined;

function depsChanged(previous: Deps, next: Deps): boolean {
  if (previous === undefined || next === undefined) return true;
  if (previous.length !== next.length) return true;
  return previous.some((value, index) => !Object.is(value, next[index]));
}

type MemoSlot = { deps: Deps; value: unknown };
type EffectSlot = { deps: Deps; cleanup: (() => void) | void; mounted: boolean };
type PendingEffect = { slot: EffectSlot; create: () => (() => void) | void; deps: Deps };

const RENDER_BUDGET = 50;

interface HookHost {
  useMemo<T>(factory: () => T, deps: Deps): T;
  useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: Deps): T;
  useRef<T>(initial: T): { current: T };
  useLayoutEffect(create: () => (() => void) | void, deps: Deps): void;
  useEffect(create: () => (() => void) | void, deps: Deps): void;
  scheduleRerender(): void;
}

interface MountedComponent {
  update(props: Record<string, unknown>): void;
  unmount(): void;
  renderCount: number;
  settled: boolean;
}

function mountComponent(
  render: (host: HookHost, props: Record<string, unknown>) => void,
  initialProps: Record<string, unknown>,
): MountedComponent {
  const memoSlots: MemoSlot[] = [];
  const callbackSlots: MemoSlot[] = [];
  const refSlots: { current: unknown }[] = [];
  const layoutSlots: EffectSlot[] = [];
  const passiveSlots: EffectSlot[] = [];

  let memoCursor = 0;
  let callbackCursor = 0;
  let refCursor = 0;
  let layoutCursor = 0;
  let passiveCursor = 0;
  let pendingLayout: PendingEffect[] = [];
  let pendingPassive: PendingEffect[] = [];
  let rerenderScheduled = false;
  let unmounted = false;
  let renderCount = 0;
  let settled = true;

  const host: HookHost = {
    useMemo<T>(factory: () => T, deps: Deps): T {
      const index = memoCursor++;
      const slot = memoSlots[index];
      if (slot && !depsChanged(slot.deps, deps)) {
        return slot.value as T;
      }
      const value = factory();
      memoSlots[index] = { deps, value };
      return value;
    },
    useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: Deps): T {
      const index = callbackCursor++;
      const slot = callbackSlots[index];
      if (slot && !depsChanged(slot.deps, deps)) {
        return slot.value as T;
      }
      callbackSlots[index] = { deps, value: fn };
      return fn;
    },
    useRef<T>(initial: T): { current: T } {
      const index = refCursor++;
      if (!refSlots[index]) {
        refSlots[index] = { current: initial };
      }
      return refSlots[index] as { current: T };
    },
    useLayoutEffect(create, deps) {
      const index = layoutCursor++;
      let slot = layoutSlots[index];
      if (!slot) {
        slot = { deps: undefined, cleanup: undefined, mounted: false };
        layoutSlots[index] = slot;
      }
      if (!slot.mounted || depsChanged(slot.deps, deps)) {
        pendingLayout.push({ slot, create, deps });
      }
    },
    useEffect(create, deps) {
      const index = passiveCursor++;
      let slot = passiveSlots[index];
      if (!slot) {
        slot = { deps: undefined, cleanup: undefined, mounted: false };
        passiveSlots[index] = slot;
      }
      if (!slot.mounted || depsChanged(slot.deps, deps)) {
        pendingPassive.push({ slot, create, deps });
      }
    },
    scheduleRerender() {
      if (unmounted) throw new Error("state update after unmount");
      rerenderScheduled = true;
    },
  };

  const runPending = (queue: PendingEffect[]) => {
    for (const { slot, create, deps } of queue) {
      if (slot.mounted && typeof slot.cleanup === "function") {
        slot.cleanup();
      }
      slot.cleanup = create();
      slot.deps = deps;
      slot.mounted = true;
    }
  };

  const renderPass = (props: Record<string, unknown>) => {
    memoCursor = 0;
    callbackCursor = 0;
    refCursor = 0;
    layoutCursor = 0;
    passiveCursor = 0;
    pendingLayout = [];
    pendingPassive = [];
    renderCount += 1;
    render(host, props);
  };

  const commit = () => {
    const layoutQueue = pendingLayout;
    const passiveQueue = pendingPassive;
    runPending(layoutQueue);
    runPending(passiveQueue);
  };

  const flush = (props: Record<string, unknown>) => {
    rerenderScheduled = false;
    renderPass(props);
    commit();
    let guard = 0;
    while (rerenderScheduled) {
      if (++guard > RENDER_BUDGET) {
        settled = false;
        return;
      }
      rerenderScheduled = false;
      renderPass(props);
      commit();
    }
  };

  flush(initialProps);

  return {
    update(props) {
      flush(props);
    },
    unmount() {
      for (const slot of [...passiveSlots, ...layoutSlots]) {
        if (slot.mounted && typeof slot.cleanup === "function") slot.cleanup();
        slot.mounted = false;
      }
      unmounted = true;
    },
    get renderCount() {
      return renderCount;
    },
    get settled() {
      return settled;
    },
  };
}

type PatientLanguage = "en" | "ar";

type LocaleSessionProps = {
  prescribedSide: string | null;
  clinicalPrescribedSideRequired: boolean;
  consentAccepted: boolean;
  profileAvailable: boolean;
  language: PatientLanguage;
};

type LocaleLifecycleLog = {
  detectorStartCalls: number;
  startSessionCalls: number;
  targetResets: number;
  orchestratorPauses: number;
  events: string[];
};

const SAMPLE_TARGET: TherapeuticTarget = {
  id: "target-ar-en-1",
  x: 0.42,
  y: 0.58,
  spawnedAtMs: 12_000,
  levelDegrees: 90,
};

function createActiveTargetLifecycle(): TargetLifecycleState {
  return {
    ...createInitialTargetLifecycle(),
    currentTarget: { ...SAMPLE_TARGET },
    sequence: 3,
    interaction: {
      ...createInitialTargetLifecycle().interaction,
      targetsReached: 2,
      targetsShown: 3,
    },
  };
}

/**
 * Models the fixed `OrchestratorCvSessionCore` camera/session boundary including
 * locale-safe `startSession`, `languageRef`, and target lifecycle preservation.
 */
function createLocaleSessionModel() {
  const log: LocaleLifecycleLog = {
    detectorStartCalls: 0,
    startSessionCalls: 0,
    targetResets: 0,
    orchestratorPauses: 0,
    events: [],
  };

  let targetState = createActiveTargetLifecycle();
  let blockIndex = 1;
  let sessionPaused = false;
  let detectorRef: OrchestratorCvActiveDetectorHandle | null = null;
  let startSessionIdentity: (() => void) | null = null;

  const render = (host: HookHost, rawProps: Record<string, unknown>) => {
    const props = rawProps as LocaleSessionProps;
    const {
      prescribedSide,
      clinicalPrescribedSideRequired,
      consentAccepted,
      profileAvailable,
      language,
    } = props;

    const resolvedTherapeuticSide = host.useMemo(
      () =>
        resolveOrchestratorTherapeuticSide({
          prescribedSide,
          clinicalPrescribedSideRequired,
          blocks: STABLE_BLOCKS,
        }),
      [prescribedSide, clinicalPrescribedSideRequired, STABLE_BLOCKS],
    );
    const therapeuticSideKey = resolvedTherapeuticSide?.side ?? null;

    const sessionStartedRef = host.useRef(false);
    const languageRef = host.useRef<PatientLanguage>(language);
    languageRef.current = language;

    host.useLayoutEffect(() => {
      if (!profileAvailable) return;
      const detector = mountOrchestratorCvDetector<
        OrchestratorCvActiveDetectorHandle,
        unknown,
        unknown
      >(
        resolvedTherapeuticSide,
        (_callbacks, side) => {
          log.events.push(`construct:${side}`);
          return {
            stop() {
              host.scheduleRerender();
            },
            start() {
              log.detectorStartCalls += 1;
              log.events.push("detector.start");
              host.scheduleRerender();
              return Promise.resolve();
            },
          };
        },
        { onSnapshot: () => {}, onMeasuredEvent: () => {} },
      );
      detectorRef = detector;
      return () => {
        sessionStartedRef.current = false;
        if (detector) log.events.push("dispose");
        disposeOrchestratorCvDetector(detector);
        detectorRef = null;
      };
    }, [profileAvailable, resolvedTherapeuticSide, therapeuticSideKey]);

    const startSession = host.useCallback(() => {
      log.startSessionCalls += 1;
      log.events.push("startSession");
      if (sessionStartedRef.current) {
        log.events.push("startSession:skipped-already-started");
        return;
      }
      if (!profileAvailable || !detectorRef) return;
      log.detectorStartCalls += 1;
      log.events.push("detector.start");
      sessionStartedRef.current = true;
      sessionPaused = true;
      log.orchestratorPauses += 1;
      log.events.push("orchestrator.pause");
      log.targetResets += 1;
      targetState = createInitialTargetLifecycle();
      log.events.push("target.reset");
    }, [profileAvailable]);

    if (startSessionIdentity === null) {
      startSessionIdentity = startSession;
    }

    host.useEffect(() => {
      if (
        !shouldStartOrchestratorCvCamera({
          consentAccepted,
          profileAvailable,
          resolvedTherapeuticSide,
        })
      ) {
        return;
      }
      void startSession();
    }, [consentAccepted, profileAvailable, resolvedTherapeuticSide, startSession]);
  };

  return {
    render,
    log,
    getTargetState: () => targetState,
    setTargetState: (next: TargetLifecycleState) => {
      targetState = next;
    },
    getBlockIndex: () => blockIndex,
    setBlockIndex: (next: number) => {
      blockIndex = next;
    },
    isSessionPaused: () => sessionPaused,
    getStartSessionIdentity: () => startSessionIdentity,
    getDetector: () => detectorRef,
  };
}

const POST_CONSENT_AR: LocaleSessionProps = {
  prescribedSide: "left",
  clinicalPrescribedSideRequired: true,
  consentAccepted: true,
  profileAvailable: true,
  language: "ar",
};

describe("#286 — locale switch does not restart session or clear targets", () => {
  it("starts once in Arabic with an active target, then preserves it when switching to English", () => {
    const model = createLocaleSessionModel();
    model.setBlockIndex(1);

    const component = mountComponent(model.render, POST_CONSENT_AR);

    assert.equal(component.settled, true);
    assert.equal(model.log.detectorStartCalls, 1);
    assert.equal(model.log.startSessionCalls, 1);
    assert.equal(model.log.targetResets, 1, "only the initial session start may reset targets");

    // Mid-session: Reach the Light has spawned an active therapeutic target.
    model.setTargetState(createActiveTargetLifecycle());

    const identityBefore = model.getStartSessionIdentity();

    component.update({ ...POST_CONSENT_AR, language: "en" });

    assert.equal(component.settled, true);
    assert.equal(model.log.detectorStartCalls, 1, "detector.start must not run again");
    assert.equal(model.log.startSessionCalls, 1, "startSession must not run again");
    assert.equal(model.log.orchestratorPauses, 1, "locale switch must not pause the orchestrator again");
    assert.equal(model.getStartSessionIdentity(), identityBefore, "startSession identity must be stable");

    const target = model.getTargetState().currentTarget;
    assert.ok(target, "target must remain present after English switch");
    assert.equal(target?.id, SAMPLE_TARGET.id);
    assert.equal(target?.x, SAMPLE_TARGET.x);
    assert.equal(target?.y, SAMPLE_TARGET.y);
    assert.equal(model.getBlockIndex(), 1);
  });

  it("switching English → Arabic also preserves runtime state", () => {
    const model = createLocaleSessionModel();

    const component = mountComponent(model.render, { ...POST_CONSENT_AR, language: "en" });
    model.setTargetState(createActiveTargetLifecycle());
    component.update({ ...POST_CONSENT_AR, language: "ar" });

    assert.equal(model.log.detectorStartCalls, 1);
    assert.equal(model.log.startSessionCalls, 1);
    const target = model.getTargetState().currentTarget;
    assert.equal(target?.id, SAMPLE_TARGET.id);
    assert.equal(target?.x, SAMPLE_TARGET.x);
    assert.equal(target?.y, SAMPLE_TARGET.y);
  });

  it("multiple locale toggles stay settled with a single camera start", () => {
    const model = createLocaleSessionModel();
    const component = mountComponent(model.render, POST_CONSENT_AR);
    model.setTargetState(createActiveTargetLifecycle());

    for (const language of ["en", "ar", "en", "ar"] as const) {
      component.update({ ...POST_CONSENT_AR, language });
    }

    assert.equal(component.settled, true);
    assert.equal(model.log.detectorStartCalls, 1);
    assert.equal(model.log.startSessionCalls, 1);
    assert.ok(model.getTargetState().currentTarget);
  });
});

describe("#286 — localized camera errors still follow active locale", () => {
  it("resolveInteractiveShoulderStartError returns Arabic when language ref is Arabic at error time", () => {
    const languageRef = { current: "ar" as PatientLanguage };
    const error = resolveInteractiveShoulderStartError(
      languageRef.current,
      new DOMException("denied", "NotAllowedError"),
    );
    assert.equal(error, interactiveShoulderUi("ar").cameraAccessDenied);

    languageRef.current = "en";
    const englishError = resolveInteractiveShoulderStartError(
      languageRef.current,
      new DOMException("denied", "NotAllowedError"),
    );
    assert.equal(englishError, interactiveShoulderUi("en").cameraAccessDenied);
  });
});

describe("#286 — shipped component applies locale-safe lifecycle", () => {
  it("startSession does not depend on language and guards already-started sessions", () => {
    const corePath = join(
      process.cwd(),
      "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx",
    );
    const source = readFileSync(corePath, "utf8");
    const startSessionIndex = source.indexOf("const startSession = useCallback");
    assert.ok(startSessionIndex >= 0);
    const startSessionBody = source.slice(startSessionIndex, startSessionIndex + 2600);

    assert.match(startSessionBody, /if \(sessionStartedRef\.current\) return;/);
    assert.match(source, /resolveInteractiveShoulderStartError\(languageRef\.current/);
    assert.doesNotMatch(startSessionBody, /\[profile,\s*language,\s*sessionDefinition\]/);
    assert.match(startSessionBody, /\[profile,\s*sessionDefinition\]/);
  });

  it("detector cleanup clears sessionStarted so genuine side changes can still restart", () => {
    const corePath = join(
      process.cwd(),
      "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx",
    );
    const source = readFileSync(corePath, "utf8");
    assert.match(source, /sessionStartedRef\.current = false;\s*\r?\n\s*disposeOrchestratorCvDetector/);
  });

  it("languageRef is synced on every render without entering startSession dependencies", () => {
    const corePath = join(
      process.cwd(),
      "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx",
    );
    const source = readFileSync(corePath, "utf8");
    assert.match(source, /const languageRef = useRef\(language\);/);
    assert.match(source, /languageRef\.current = language;/);
  });
});

describe("#286 — prescribed-side change still reinitializes after detector disposal", () => {
  it("a genuine side change disposes and starts the camera again", () => {
    const model = createLocaleSessionModel();
    const component = mountComponent(model.render, POST_CONSENT_AR);

    component.update({ ...POST_CONSENT_AR, prescribedSide: "right" });

    assert.equal(component.settled, true);
    assert.equal(model.log.detectorStartCalls, 2);
    assert.equal(model.log.startSessionCalls, 2);
    assert.match(model.log.events.join(","), /dispose/);
  });
});
