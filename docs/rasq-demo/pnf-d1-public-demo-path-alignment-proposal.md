# PNF D1 public demo — illustration vs live path alignment

**Status:** Implemented on PR #310; camera-path fix on `fix/demo-pnf-camera-path-alignment`.  
**Scope:** `/demo` public session PNF block path + mobile/welcome guide imagery.  
**Out of scope:** Shared `d1-inspired-diagonal-reach` pattern used by patient/rehab sessions, CV measurement pipeline, approved WebP artwork, camera mirroring, wrist transforms.

## Approved illustration (anatomical)

The seated PNF D1 guide (`public/images/rasq-demo/pnf-diagonal-1-demonstration-guide.webp`) depicts:

- **Start:** right hand **low on the anatomical right side** (near the hip/thigh on the patient’s right).
- **End:** hand moving **across the body** toward the **left shoulder** (contralateral, elevated).

Alt text in `app/lib/rasq-demo/demo-exercise-illustrations.ts` is aligned to this story.

## Where the guide appears

| Surface | Component | When |
|---------|-----------|------|
| Welcome grid | `RasqDemoPnfD1GuideVisual` in `RasqDemoExperience.tsx` | Before **Start demo** |
| Active session (mobile) | Same component in `RasqDemoOrchestratorSession.tsx` (`lg:hidden`) | During PNF block (`isPnfBlock`) |

The PNF image is **not** welcome-only; participants see it beside the live camera during the mobile PNF block.

## Live demo geometry trace

### Session wiring

- Block: `rasq-demo-pnf-d1-repetitions` in `demo-session-definition.ts`
- `side: "right"`, `blockType: "movement-pattern"`
- `feedbackProfile: rasq-demo-d1-diagonal-reach` → demo-only pattern (`app/lib/rasq-demo/rasq-demo-d1-diagonal-reach-pattern.ts`)

### Authored waypoints (mirrored-preview space)

From `d1-inspired-diagonal-reach-pattern.ts`, for `side === "right"` waypoints are **not** x-flipped (`mirrorX` is identity for right):

| Label | Normalized (x, y) |
|-------|-------------------|
| start | (0.34, 0.66) |
| end | (0.66, 0.22) |

Convention (documented in `presentation-mirror.ts`): therapeutic geometry is authored in **mirrored preview space** — **screen right = patient’s anatomical right** (high **x**), **screen left = patient’s anatomical left** (low **x**). **y** increases downward.

**Anatomical reading of the live path (right-side block):**

- **Start:** low **x**, lower **y** → **patient’s left**, low in frame (contralateral low).
- **End:** high **x**, higher **y** (smaller y value) → **patient’s right**, raised (ipsilateral high).

### Wrist and overlay (not “alignment by mirror”)

- Raw MediaPipe wrist is in **camera** space (anatomical right at low **x**).
- `OrchestratorCvSessionCore` applies `toMirroredPreviewPoint` (`x → 1 - x`) so the hand marker and path hit-testing share the same space as the SVG path.
- Video + overlay canvas use `MIRRORED_PREVIEW_TRANSFORM` (`scaleX(-1)`) so presentation matches that space.

Mirroring fixes **measurement vs path coordinate agreement** (#277). It does **not** change which anatomical corners the **authored** waypoints connect. Comparing illustration to demo requires mapping both into anatomical left/right, not assuming “screen direction” alone.

### Path rendering

- `TherapeuticPathLayer` draws `pattern.sampledPath` in normalized 0–1 coordinates (same mirrored-preview space as waypoints).

## Historical mismatch (pre–PR #310 path fix)

Before `rasq-demo-d1-diagonal-reach`, the public demo reused `d1-inspired-diagonal-reach`, whose right-side path ran contralateral low → ipsilateral high — the inverse of the approved illustration.

## Implementation (public demo only)

1. **`RASQ_DEMO_D1_DIAGONAL_REACH_PATTERN`** — x-reflected waypoints from clinical D1 (start ≈ (0.66, 0.66) → end ≈ (0.34, 0.22) in mirrored-preview space for `side: right`).
2. **Registry** — additive entry in `motion-pattern-registry.ts`.
3. **`RASQ_TWO_MINUTE_DEMO_SESSION`** — PNF block `feedbackProfile: rasq-demo-d1-diagonal-reach` only.
4. **Tests** — `rasq-demo-d1-diagonal-reach-pattern.test.ts`, updated `demo-session-definition.test.ts`, registry test.

Clinical `D1_INSPIRED_DIAGONAL_REACH_PATTERN`, stroke foundation catalog, and camera/wrist mirroring are unchanged.

**Reach to Right** and seated-vs-standing presentation are unchanged.

## Validation checklist

- [x] Demo session + orchestrator: five `patternCompleted` events for `rasq-demo-d1-diagonal-reach`.
- [x] Path direction regression tests (start/end normalized anchors).
- [x] Patient stroke foundation / clinical D1 blocks still use `d1-inspired-diagonal-reach`.
- [x] `npm test`, `npm run build`.
- [x] Fixture pipeline: raw MediaPipe → detector → `toMirroredPreviewPoint` → demo path (see `demo-pnf-camera-path-pipeline.test.ts`).
- [ ] Manual: camera-enabled `/demo` PNF — confirm marker, path, and repetition completion on device.

## PR #311 — runtime trace and fix scope (revised)

### Confirmed on `/demo` (fixture trace, not live camera)

| Step | Production caller | Result for public demo |
|------|-------------------|-------------------------|
| Therapeutic side | `resolveOrchestratorTherapeuticSide` in `OrchestratorCvSessionCore` | **`right`**, source **`block`** — both demo blocks declare `side: "right"`; no `prescribedSide` |
| Block transition | `resetRunnerStatesForBlockTransition({ side: activeTherapeuticSide, … })` | Pattern resolved with **`right`** unless public-demo presentation override applies |
| Per-frame wrist | `toMirroredPreviewPoint(poseSnap?.primaryWristNormalized)` in RAF loop | Same conversion as clinical (#277); no demo-only helper |
| Detector | `mountOrchestratorCvDetector` with resolved therapeutic side | Tracks **right** primary wrist for demo |

**Unconfirmed:** The earlier claim that `/demo` resolved **`side: "left"`** at runtime was **not reproduced** in this trace. Both blocks are `right`; non-clinical orchestrator resolution does not yield left.

### Reproduced reversal mechanisms (controlled / fixture)

1. **Hypothesis — demo profile resolved with `left`:** Start pose projects near path **end** (reversed progression). Not observed on `/demo` side resolution above; guarded by **`motionPatternPresentationSide: "right"`** when `publicDemoConsent` is set (demo-only seam in `public-demo-pnf-path-resolution.ts`).
2. **Misconfiguration — clinical `d1-inspired-diagonal-reach` on demo illustration pose:** Start pose sits far along the path vs demo profile (historical pre–#310 behavior).

### Fix scope

- **Do not** override `currentBlock.side` over `activeTherapeuticSide` in `OrchestratorCvSessionCore` (preserves clinical **`prescribedSide`** priority).
- **Do not** force demo path side globally in `motion-pattern-registry.ts`.
- **Do** pin public-demo PNF path geometry via optional `motionPatternPresentationSide` on block transition only.

Tests: `demo-pnf-runtime-trace.test.ts`, `demo-pnf-camera-path-pipeline.test.ts`, clinical regression in `resolve-interactive-shoulder-side.test.ts` and `orchestrator-cv-block-dispatch.test.ts`.
