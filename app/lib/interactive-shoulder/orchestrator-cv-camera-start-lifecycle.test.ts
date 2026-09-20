/**
 * Run: npx tsx --test app/lib/interactive-shoulder/orchestrator-cv-camera-start-lifecycle.test.ts
 *
 * Regression coverage for #273 — the Interactive Shoulder tab crashed immediately
 * after camera consent on Staging.
 *
 * Root cause: `resolveOrchestratorTherapeuticSide()` returns a fresh object on every
 * render. During C3 integration that unstable object was placed directly into the
 * dependency arrays of the detector mount/dispose layout effect and the camera-start
 * effect. React compares dependencies with `Object.is`, so both effects re-ran on
 * every render: the pose detector was torn down and reconstructed and `startSession()`
 * was re-invoked. Both paths synchronously emit a fresh snapshot object into state, so
 * the update never bails out, which renders again, which produces another new side
 * object. The loop sustains itself and never settles.
 *
 * The repository has no DOM or React renderer available, so these tests drive a
 * deterministic harness that models React's documented hook semantics — `Object.is`
 * dependency comparison, cleanup-before-re-run, commit ordering (layout effects before
 * passive effects), and StrictMode double invocation. The harness is exercised against
 * the REAL `resolveOrchestratorTherapeuticSide`, `mountOrchestratorCvDetector`,
 * `disposeOrchestratorCvDetector` and `shouldStartOrchestratorCvCamera` used by
 * `OrchestratorCvSessionCore`, and the final test in this file asserts that the shipped
 * component actually applies the memoisation the harness models.
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

/**
 * Referentially stable across the whole file, mirroring the real call sites:
 * `InteractiveShoulderSession` passes a module constant and `CatalogSessionPlayer`
 * passes a `useMemo` result, so `sessionDefinition.blocks` never changes identity
 * render-to-render.
 */
const STABLE_BLOCKS: readonly Pick<MovementBlock, "side">[] = toSessionDefinition(
  STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1,
).blocks;

/* -------------------------------------------------------------------------- */
/* Minimal React hook semantics harness                                       */
/* -------------------------------------------------------------------------- */

type Deps = readonly unknown[] | undefined;

function depsChanged(previous: Deps, next: Deps): boolean {
  if (previous === undefined || next === undefined) return true;
  if (previous.length !== next.length) return true;
  return previous.some((value, index) => !Object.is(value, next[index]));
}

type MemoSlot = { deps: Deps; value: unknown };
type EffectSlot = { deps: Deps; cleanup: (() => void) | void; mounted: boolean };

type PendingEffect = { slot: EffectSlot; create: () => (() => void) | void; deps: Deps };

/** Hard stop so a non-settling render loop fails the test instead of hanging it. */
const RENDER_BUDGET = 50;

interface HookHost {
  useMemo<T>(factory: () => T, deps: Deps): T;
  useLayoutEffect(create: () => (() => void) | void, deps: Deps): void;
  useEffect(create: () => (() => void) | void, deps: Deps): void;
  /** Models a state update that always writes a fresh value (never bails out). */
  scheduleRerender(): void;
}

interface MountedComponent {
  /** Re-renders with new props and flushes to a quiescent state. */
  update(props: Record<string, unknown>): void;
  unmount(): void;
  renderCount: number;
  settled: boolean;
}

function mountComponent(
  render: (host: HookHost, props: Record<string, unknown>) => void,
  initialProps: Record<string, unknown>,
  options: { strictMode?: boolean } = {},
): MountedComponent {
  const strictMode = options.strictMode ?? false;
  const memoSlots: MemoSlot[] = [];
  const layoutSlots: EffectSlot[] = [];
  const passiveSlots: EffectSlot[] = [];

  let memoCursor = 0;
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
      if (unmounted) {
        throw new Error("state update after unmount");
      }
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
    layoutCursor = 0;
    passiveCursor = 0;
    pendingLayout = [];
    pendingPassive = [];
    renderCount += 1;
    render(host, props);
    // StrictMode double-invokes the render function; hook state persists across
    // both passes, so a correct `useMemo` returns the identical value twice.
    if (strictMode) {
      memoCursor = 0;
      layoutCursor = 0;
      passiveCursor = 0;
      pendingLayout = [];
      pendingPassive = [];
      renderCount += 1;
      render(host, props);
    }
  };

  const commit = (isMount: boolean) => {
    const layoutQueue = pendingLayout;
    const passiveQueue = pendingPassive;
    runPending(layoutQueue);
    runPending(passiveQueue);
    // StrictMode runs mount effects, tears them down, then runs them again.
    if (strictMode && isMount) {
      for (const { slot } of [...layoutQueue, ...passiveQueue]) {
        if (typeof slot.cleanup === "function") slot.cleanup();
        slot.mounted = false;
      }
      runPending(layoutQueue);
      runPending(passiveQueue);
    }
  };

  const flush = (props: Record<string, unknown>, isMount: boolean) => {
    rerenderScheduled = false;
    renderPass(props);
    commit(isMount);
    let guard = 0;
    while (rerenderScheduled) {
      if (++guard > RENDER_BUDGET) {
        settled = false;
        return;
      }
      rerenderScheduled = false;
      renderPass(props);
      commit(false);
    }
  };

  flush(initialProps, true);

  return {
    update(props) {
      flush(props, false);
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

/* -------------------------------------------------------------------------- */
/* Model of the OrchestratorCvSessionCore camera-start boundary               */
/* -------------------------------------------------------------------------- */

type SessionProps = {
  prescribedSide: string | null;
  clinicalPrescribedSideRequired: boolean;
  consentAccepted: boolean;
  profileAvailable: boolean;
};

type LifecycleLog = {
  detectorConstructions: ShoulderAbductionReachSide[];
  detectorDisposals: number;
  cameraStarts: number;
  events: string[];
};

/**
 * Mirrors the hook order and dependency arrays of `OrchestratorCvSessionCore` around
 * the camera-start boundary. `memoiseSide: false` reproduces the pre-fix code shape.
 */
function createSessionModel(options: { memoiseSide: boolean }) {
  const log: LifecycleLog = {
    detectorConstructions: [],
    detectorDisposals: 0,
    cameraStarts: 0,
    events: [],
  };
  let detectorRef: OrchestratorCvActiveDetectorHandle | null = null;

  const render = (host: HookHost, rawProps: Record<string, unknown>) => {
    const props = rawProps as SessionProps;
    const { prescribedSide, clinicalPrescribedSideRequired, consentAccepted, profileAvailable } =
      props;

    const resolveSide = () =>
      resolveOrchestratorTherapeuticSide({
        prescribedSide,
        clinicalPrescribedSideRequired,
        blocks: STABLE_BLOCKS,
      });

    const resolvedTherapeuticSide = options.memoiseSide
      ? host.useMemo(resolveSide, [
          prescribedSide,
          clinicalPrescribedSideRequired,
          STABLE_BLOCKS,
        ])
      : resolveSide();

    const therapeuticSideKey = resolvedTherapeuticSide?.side ?? null;

    host.useLayoutEffect(() => {
      if (!profileAvailable) return;
      const detector = mountOrchestratorCvDetector<
        OrchestratorCvActiveDetectorHandle,
        unknown,
        unknown
      >(
        resolvedTherapeuticSide,
        (_callbacks, side) => {
          log.detectorConstructions.push(side);
          log.events.push(`construct:${side}`);
          return {
            stop() {
              // Mirrors the real detector: stopping emits a fresh snapshot object.
              host.scheduleRerender();
            },
            async start() {
              host.scheduleRerender();
            },
          };
        },
        { onSnapshot: () => {}, onMeasuredEvent: () => {} },
      );
      detectorRef = detector;
      return () => {
        if (detector) {
          log.detectorDisposals += 1;
          log.events.push("dispose");
        }
        disposeOrchestratorCvDetector(detector);
        detectorRef = null;
      };
    }, [profileAvailable, resolvedTherapeuticSide, therapeuticSideKey]);

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
      log.cameraStarts += 1;
      log.events.push("camera-start");
      // `startSession()` writes a fresh snapshot object into state on every call.
      host.scheduleRerender();
    }, [consentAccepted, profileAvailable, resolvedTherapeuticSide]);
  };

  return { render, log, getDetector: () => detectorRef };
}

const PRE_CONSENT: SessionProps = {
  prescribedSide: "left",
  clinicalPrescribedSideRequired: true,
  consentAccepted: false,
  profileAvailable: true,
};
const POST_CONSENT: SessionProps = { ...PRE_CONSENT, consentAccepted: true };

/* -------------------------------------------------------------------------- */

describe("#273 — camera start no longer loops (regression)", () => {
  it("reproduces the pre-fix runaway loop when the resolved side is not memoised", () => {
    const model = createSessionModel({ memoiseSide: false });
    const component = mountComponent(model.render, { ...PRE_CONSENT });

    // Before consent the boundary is quiet — matching the reported behaviour that the
    // page renders fine until the consent Continue click.
    assert.equal(model.log.cameraStarts, 0);

    component.update({ ...POST_CONSENT });

    assert.equal(
      component.settled,
      false,
      "expected the unmemoised dependency to reproduce a non-settling render loop",
    );
    assert.ok(
      model.log.cameraStarts > 1,
      `expected repeated camera starts, saw ${model.log.cameraStarts}`,
    );
    assert.ok(
      model.log.detectorConstructions.length > 1,
      `expected repeated detector construction, saw ${model.log.detectorConstructions.length}`,
    );
  });

  it("settles after camera consent with exactly one detector and one camera start", () => {
    const model = createSessionModel({ memoiseSide: true });
    const component = mountComponent(model.render, { ...PRE_CONSENT });

    assert.equal(model.log.cameraStarts, 0);
    assert.deepEqual(model.log.detectorConstructions, ["left"]);

    component.update({ ...POST_CONSENT });

    assert.equal(component.settled, true, "camera start must reach a quiescent state");
    assert.equal(model.log.cameraStarts, 1);
    assert.deepEqual(model.log.detectorConstructions, ["left"]);
    assert.equal(model.log.detectorDisposals, 0);
  });

  it("stays settled across further unrelated re-renders after camera start", () => {
    const model = createSessionModel({ memoiseSide: true });
    const component = mountComponent(model.render, { ...PRE_CONSENT });
    component.update({ ...POST_CONSENT });

    for (let i = 0; i < 5; i += 1) {
      component.update({ ...POST_CONSENT });
    }

    assert.equal(component.settled, true);
    assert.equal(model.log.cameraStarts, 1);
    assert.deepEqual(model.log.detectorConstructions, ["left"]);
    assert.equal(model.log.detectorDisposals, 0);
  });
});

describe("#273 — camera/CV initialization order", () => {
  it("constructs the detector before the camera is started", () => {
    const model = createSessionModel({ memoiseSide: true });
    const component = mountComponent(model.render, { ...PRE_CONSENT });
    component.update({ ...POST_CONSENT });

    assert.deepEqual(model.log.events, ["construct:left", "camera-start"]);
  });

  it("resolves RIGHT exactly and starts once", () => {
    const model = createSessionModel({ memoiseSide: true });
    const component = mountComponent(model.render, {
      ...PRE_CONSENT,
      prescribedSide: "right",
    });
    component.update({ ...POST_CONSENT, prescribedSide: "right" });

    assert.equal(component.settled, true);
    assert.deepEqual(model.log.detectorConstructions, ["right"]);
    assert.equal(model.log.cameraStarts, 1);
  });
});

describe("#273 — initialization waits for its dependencies", () => {
  it("does not start the camera before consent is accepted", () => {
    const model = createSessionModel({ memoiseSide: true });
    mountComponent(model.render, { ...PRE_CONSENT });

    assert.equal(model.log.cameraStarts, 0);
  });

  it("does not construct a detector or start the camera before the profile is available", () => {
    const model = createSessionModel({ memoiseSide: true });
    const component = mountComponent(model.render, {
      ...POST_CONSENT,
      profileAvailable: false,
    });

    assert.deepEqual(model.log.detectorConstructions, []);
    assert.equal(model.log.cameraStarts, 0);

    component.update({ ...POST_CONSENT, profileAvailable: true });

    assert.equal(component.settled, true);
    assert.deepEqual(model.log.detectorConstructions, ["left"]);
    assert.equal(model.log.cameraStarts, 1);
  });

  it("never constructs a detector or starts the camera when the clinical side is blocked", () => {
    const model = createSessionModel({ memoiseSide: true });
    const component = mountComponent(model.render, {
      ...POST_CONSENT,
      prescribedSide: null,
    });

    assert.equal(component.settled, true, "blocked side must not loop either");
    assert.deepEqual(model.log.detectorConstructions, []);
    assert.equal(model.log.cameraStarts, 0);
    assert.equal(model.log.detectorDisposals, 0);
  });

  it("keeps the blocked side quiet across repeated renders", () => {
    const model = createSessionModel({ memoiseSide: true });
    const component = mountComponent(model.render, {
      ...POST_CONSENT,
      prescribedSide: "bilateral",
    });
    for (let i = 0; i < 5; i += 1) {
      component.update({ ...POST_CONSENT, prescribedSide: "bilateral" });
    }

    assert.equal(component.settled, true);
    assert.deepEqual(model.log.detectorConstructions, []);
    assert.equal(model.log.cameraStarts, 0);
  });
});

describe("#273 — cleanup and unmount safety", () => {
  it("disposes the detector exactly once on unmount", () => {
    const model = createSessionModel({ memoiseSide: true });
    const component = mountComponent(model.render, { ...PRE_CONSENT });
    component.update({ ...POST_CONSENT });

    assert.equal(model.log.detectorDisposals, 0);
    component.unmount();

    assert.equal(model.log.detectorDisposals, 1);
    assert.equal(model.getDetector(), null);
  });

  it("unmount is safe when no detector was ever constructed (blocked side)", () => {
    const model = createSessionModel({ memoiseSide: true });
    const component = mountComponent(model.render, {
      ...POST_CONSENT,
      prescribedSide: null,
    });

    assert.doesNotThrow(() => component.unmount());
    assert.equal(model.log.detectorDisposals, 0);
  });

  it("does not schedule work after unmount", () => {
    const model = createSessionModel({ memoiseSide: true });
    const component = mountComponent(model.render, { ...PRE_CONSENT });
    component.update({ ...POST_CONSENT });

    assert.doesNotThrow(() => component.unmount());
    assert.equal(model.getDetector(), null);
  });
});

describe("#273 — remount and reinitialization", () => {
  it("a fresh mount after unmount initializes exactly once again", () => {
    const first = createSessionModel({ memoiseSide: true });
    const firstComponent = mountComponent(first.render, { ...PRE_CONSENT });
    firstComponent.update({ ...POST_CONSENT });
    firstComponent.unmount();

    const second = createSessionModel({ memoiseSide: true });
    const secondComponent = mountComponent(second.render, { ...PRE_CONSENT });
    secondComponent.update({ ...POST_CONSENT });

    assert.equal(secondComponent.settled, true);
    assert.deepEqual(second.log.detectorConstructions, ["left"]);
    assert.equal(second.log.cameraStarts, 1);
    assert.equal(second.log.detectorDisposals, 0);
  });

  it("a genuine prescribed-side change still tears down and rebuilds exactly once", () => {
    const model = createSessionModel({ memoiseSide: true });
    const component = mountComponent(model.render, { ...PRE_CONSENT });
    component.update({ ...POST_CONSENT });

    component.update({ ...POST_CONSENT, prescribedSide: "right" });

    assert.equal(component.settled, true);
    assert.deepEqual(model.log.detectorConstructions, ["left", "right"]);
    assert.equal(model.log.detectorDisposals, 1);
    assert.equal(model.log.cameraStarts, 2);
  });

  it("a valid side transitioning to blocked disposes and does not rebuild", () => {
    const model = createSessionModel({ memoiseSide: true });
    const component = mountComponent(model.render, { ...PRE_CONSENT });
    component.update({ ...POST_CONSENT });

    component.update({ ...POST_CONSENT, prescribedSide: null });

    assert.equal(component.settled, true);
    assert.deepEqual(model.log.detectorConstructions, ["left"]);
    assert.equal(model.log.detectorDisposals, 1);
    assert.equal(model.log.cameraStarts, 1);
  });
});

describe("#273 — StrictMode / repeated lifecycle execution", () => {
  it("StrictMode double invocation does not duplicate camera start or detector state", () => {
    const model = createSessionModel({ memoiseSide: true });
    const component = mountComponent(
      model.render,
      { ...PRE_CONSENT },
      { strictMode: true },
    );
    component.update({ ...POST_CONSENT });

    assert.equal(component.settled, true, "StrictMode must not induce a render loop");
    assert.equal(model.log.cameraStarts, 1);
    // The mount-time layout effect runs, is torn down, and runs again — balanced.
    assert.deepEqual(model.log.detectorConstructions, ["left", "left"]);
    assert.equal(model.log.detectorDisposals, 1);
    assert.equal(
      model.log.detectorConstructions.length - model.log.detectorDisposals,
      1,
      "exactly one live detector must remain after StrictMode remount",
    );
  });

  it("StrictMode leaves no stale detector after unmount", () => {
    const model = createSessionModel({ memoiseSide: true });
    const component = mountComponent(
      model.render,
      { ...PRE_CONSENT },
      { strictMode: true },
    );
    component.update({ ...POST_CONSENT });
    component.unmount();

    assert.equal(
      model.log.detectorConstructions.length,
      model.log.detectorDisposals,
      "every constructed detector must be disposed",
    );
    assert.equal(model.getDetector(), null);
  });

  it("StrictMode still reproduces the loop without memoisation", () => {
    const model = createSessionModel({ memoiseSide: false });
    const component = mountComponent(
      model.render,
      { ...PRE_CONSENT },
      { strictMode: true },
    );
    component.update({ ...POST_CONSENT });

    assert.equal(component.settled, false);
  });

  it("the memoised side keeps a stable identity across a StrictMode double render", () => {
    const seen: unknown[] = [];
    const render = (host: HookHost, rawProps: Record<string, unknown>) => {
      const props = rawProps as SessionProps;
      const resolved = host.useMemo(
        () =>
          resolveOrchestratorTherapeuticSide({
            prescribedSide: props.prescribedSide,
            clinicalPrescribedSideRequired: props.clinicalPrescribedSideRequired,
            blocks: STABLE_BLOCKS,
          }),
        [props.prescribedSide, props.clinicalPrescribedSideRequired, STABLE_BLOCKS],
      );
      seen.push(resolved);
    };
    const component = mountComponent(render, { ...PRE_CONSENT }, { strictMode: true });
    component.update({ ...PRE_CONSENT });

    assert.ok(seen.length >= 4);
    for (const value of seen) {
      assert.equal(value, seen[0], "resolved side identity must be stable across renders");
    }
  });
});

describe("#273 — existing Interactive Shoulder behaviour is unchanged", () => {
  it("memoisation does not alter any resolved side value", () => {
    const cases: Array<{ prescribedSide: string | null; clinical: boolean }> = [
      { prescribedSide: "left", clinical: true },
      { prescribedSide: "right", clinical: true },
      { prescribedSide: null, clinical: true },
      { prescribedSide: "bilateral", clinical: true },
      { prescribedSide: "left", clinical: false },
      { prescribedSide: null, clinical: false },
    ];

    for (const { prescribedSide, clinical } of cases) {
      const direct = resolveOrchestratorTherapeuticSide({
        prescribedSide,
        clinicalPrescribedSideRequired: clinical,
        blocks: STABLE_BLOCKS,
      });
      const memoModel = createSessionModel({ memoiseSide: true });
      mountComponent(memoModel.render, {
        prescribedSide,
        clinicalPrescribedSideRequired: clinical,
        consentAccepted: true,
        profileAvailable: true,
      });

      const expected = direct === null ? [] : [direct.side];
      assert.deepEqual(
        memoModel.log.detectorConstructions,
        expected,
        `side resolution changed for ${String(prescribedSide)} / clinical=${clinical}`,
      );
    }
  });

  it("legacy non-clinical mode still starts the camera on the fallback side", () => {
    const model = createSessionModel({ memoiseSide: true });
    const component = mountComponent(model.render, {
      prescribedSide: null,
      clinicalPrescribedSideRequired: false,
      consentAccepted: true,
      profileAvailable: true,
    });

    assert.equal(component.settled, true);
    assert.equal(model.log.detectorConstructions.length, 1);
    assert.equal(model.log.cameraStarts, 1);
  });
});

describe("#273 — shipped component applies the memoisation", () => {
  it("OrchestratorCvSessionCore memoises resolvedTherapeuticSide on its primitive inputs", () => {
    const corePath = join(
      process.cwd(),
      "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx",
    );
    const source = readFileSync(corePath, "utf8");

    const index = source.indexOf("const resolvedTherapeuticSide");
    assert.ok(index >= 0, "resolvedTherapeuticSide must still exist");
    const declaration = source.slice(index, index + 500);

    assert.match(declaration, /useMemo\(/);
    assert.match(declaration, /resolveOrchestratorTherapeuticSide\(/);
    assert.match(
      declaration,
      /\[prescribedSide,\s*clinicalPrescribedSideRequired,\s*sessionDefinition\.blocks\]/,
    );
    assert.match(source, /^\s*useMemo,$/m);
  });

  it("the detector and camera-start effects still depend on the resolved side", () => {
    const corePath = join(
      process.cwd(),
      "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx",
    );
    const source = readFileSync(corePath, "utf8");

    assert.match(source, /resolvedTherapeuticSide,\s*therapeuticSideKey\]/);
    assert.match(source, /\[consentAccepted,\s*profile,\s*resolvedTherapeuticSide,\s*startSession\]/);
  });
});
