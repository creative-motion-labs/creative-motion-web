# RASQ Upper-Limb Motor Screen

**Status:** Phase 1 library complete on `dev_branch` (PRs #191–#194). **No clinician UI, API persistence, or live-camera wiring yet.**

This document describes the **Upper-Limb Motor Screen** — a clinician-assigned, CV-supported, **clinician-reviewed assessment** domain. It is **not** Interactive Upper-Limb Rehabilitation, **not** the patient-portal CV exercise `functional-reach`, and **not** a clinical scoring or diagnosis engine.

All observations produced by these reducers require **therapist review**. RASQ does **not** diagnose, confirm anatomical range of motion, grade strength or spasticity, or make treatment decisions from task metrics alone.

---

## Product boundary

| Domain | Purpose | Current code location |
|--------|---------|------------------------|
| **Upper-Limb Motor Screen** | Structured assessment tasks with factual wrist-path metrics and optional angle observation | `app/lib/upper-limb-motor-screen/` |
| **Interactive Upper-Limb Rehabilitation** | Patient rehabilitation sessions (e.g. Reach the Light, clinical motion pattern engine) | `app/lib/interactive-shoulder/` |
| **Patient CV `functional-reach` exercise** | Optional camera assist during assigned rehab sessions | `app/lib/cv/functional-reach-detector.ts` |

The Motor Screen **Forward Reach** task (`taskId: forwardReach`) is a screen-space target task reducer. It must not be confused with the CV rehab exercise ID `functional-reach` documented in `docs/cv/CV_EXERCISE_ALLOWLIST_PLAN.md`.

---

## Architecture

Three layers are kept separate:

1. **Assignment & session contracts** — `types.ts`, `assignment-validation.ts` (Phase 1 foundation, PR #191)
2. **Cross-cutting evaluators** — `clinical-stop-evaluator.ts`, `protective-pause-evaluator.ts` (PR #191)
3. **Independent task reducers** — one pure command-driven engine per task (PRs #192–#194)

```
Clinician assignment (future UI)
        │
        ▼
UpperLimbMotorScreenAssignment  ──►  validateUpperLimbMotorScreenAssignment
        │
        ▼
Per-task engine (forward / lateral / elbow)
        │
        ├─ Wrist target task (onset, dwell, return, timing, path)
        ├─ Optional factual metrics (e.g. peakElbowExtensionDeg)
        └─ Terminal outcome + factualNotes
        │
        ▼
UpperLimbMovementAttemptResult  ──►  clinician review (future)
```

Engines consume `NormalizedMotionFrame` commands only. They do not depend on UI, Session Orchestrator, or interactive-shoulder state machines. Each reach engine is **independent** — no shared generic reach reducer.

Relationship to the broader delivery spine: see `docs/assessment-delivery-architecture.md`. Motor Screen wiring into clinic/remote capture surfaces is **deferred**.

---

## Phase 1 foundation (PR #191)

| Module | Role |
|--------|------|
| `types.ts` | Closed enums, result contracts, safety-vocabulary validator |
| `assignment-validation.ts` | Validates clinician assignment payloads; no silent defaults |
| `clinical-stop-evaluator.ts` | Human-recorded clinical stop events only |
| `protective-pause-evaluator.ts` | Tracking/environment pauses; explicit human resume |

### `testedSide` vs `affectedSide`

- **`testedSide`** — identifies which arm's landmarks drive **task measurement** (wrist events, optional angle). Required on every task assignment group. **No fallback** if invalid or missing.
- **`affectedSide`** — assignment-level clinical context field. **Separate** from `testedSide` and never used for landmark selection inside the engines.

Bilateral testing is modeled as **two sequential task-assignment groups**, not a `"bilateral"` side value.

### Supported tasks (`taskId`)

| `taskId` | Engine module | Onset rule |
|----------|---------------|------------|
| `forwardReach` | `forward-reach-engine.ts` | Any-direction exit from starting zone |
| `lateralReach` | `lateral-reach-engine.ts` | Screen-space horizontal target-facing boundary |
| `elbowExtension` | `elbow-extension-engine.ts` | Full 2D target-facing projection (dot product toward configured target) |

### Terminal completion states

All three engines support the same six outcomes: `completed`, `incomplete`, `interrupted`, `stopped`, `not_assessable`, `not_started`.

---

## Wrist target task (all three engines)

Shared behavioral model:

- Clinician **readiness confirmation** while wrist is inside the starting zone
- **Movement onset** after configured confirmation duration (back-dated to first qualifying frame)
- **Target dwell** confirmation before `targetReached` / `dwellConfirmed`
- **Return** confirmation inside the starting zone
- **Monotonic engine clock** across command types — earlier command timestamps are rejected
- **Frame timestamp semantics (engine-specific):**
  - **Forward Reach** — non-decreasing command clock; earlier timestamps are rejected; equal timestamps may be accepted according to current Forward Reach command semantics
  - **Lateral Reach** and **Elbow Extension** — frame commands additionally require **strictly increasing** timestamps; duplicate or earlier frame timestamps are rejected without mutating event state or metrics
- **Wrist-only** tracking continuity and protective pauses (`wrist_landmark_lost`)
- Shoulder/elbow loss does **not** open a pause while wrist tracking remains valid
- Explicit **human resume** after a protective pause; no automatic resume
- **Clinical stop** and **runtime interruption** as distinct terminal paths

Timing, visibility, zone geometry, and gap thresholds are **injected via configuration** — not hardcoded clinical thresholds. All numeric config values require recorded-sequence and live-camera validation before pilot use.

### Elbow Extension — target-facing onset (PR #194)

Onset qualifies when the tested-side wrist projection along the configured target direction exceeds the starting-zone radius:

```
dot(wrist − startCenter, normalize(target − startCenter)) > startingZone.radius
```

Wrong-direction exit before valid onset (`dot < −radius`) **re-arms readiness**: the wrist must return inside the starting zone and receive a new human readiness confirmation. Onset is never back-dated from wrong-direction movement.

---

## Optional elbow-angle observation (Elbow Extension only)

`peakElbowExtensionDeg` on `UpperLimbMovementAttemptResult`:

- Maximum observed **2D interior angle** at the tested-side elbow (shoulder→elbow→wrist) during **outbound/dwelling** only
- Populated only when tested-side shoulder, elbow, and wrist are simultaneously valid and above configured visibility thresholds
- **`null`** when required landmarks are not sufficiently tracked
- **Never** gates wrist-task completion, dwell, return, or pause behavior
- **Not** anatomical ROM, confirmation of full extension, strength, spasticity, or impairment

Target-facing wrist movement onset does **not** mean anatomical elbow-extension onset. Target completion does **not** confirm anatomical elbow extension. The patient may reach the target using elbow, shoulder, trunk, scapular, or mixed strategies.

Unsupported result fields remain **`null`**: `peakShoulderAngleDeg`, `trunkDisplacementObserved`, `withinConfiguredLimitThroughout`.

---

## What the engines do not provide

- Anatomical ROM or full-extension confirmation
- FMA-UE or other impairment scores
- Strength or spasticity grading
- Diagnosis, severity classification, or treatment recommendations
- Overall performance scoring or autonomous clinical interpretation

Factual notes (e.g. angle data availability, protective pause count, non-target-facing exit before valid onset) may appear in `factualNotes` for therapist review only.

---

## Validation status (synthetic tests)

| Suite | Count | Command |
|-------|-------|---------|
| Phase 1 foundation | 155 pass | `npx tsx --test app/lib/upper-limb-motor-screen/types.test.ts app/lib/upper-limb-motor-screen/assignment-validation.test.ts app/lib/upper-limb-motor-screen/clinical-stop-evaluator.test.ts app/lib/upper-limb-motor-screen/protective-pause-evaluator.test.ts` |
| Forward Reach engine | 119 pass | `npx tsx --test app/lib/upper-limb-motor-screen/forward-reach-engine.test.ts` |
| Lateral Reach engine | 146 pass | `npx tsx --test app/lib/upper-limb-motor-screen/lateral-reach-engine.test.ts` |
| Elbow Extension engine | 101 pass | `npx tsx --test app/lib/upper-limb-motor-screen/elbow-extension-engine.test.ts` |
| **Combined reach engines** | **366 pass** | All three engine test files together |

Tests use synthetic `NormalizedMotionFrame` fixtures only — no camera, no UI.

---

## Deferred validation and next integration steps

Still requires recorded-sequence and live-camera validation for:

- Timing thresholds (`onsetConfirmationMs`, `dwellDurationMs`, `returnConfirmationMs`)
- Landmark visibility thresholds (wrist, shoulder, elbow)
- Tracking-gap tolerance (`maxAllowedGapMs`)
- Camera placement and coordinate-space behavior
- Elbow-dominant vs shoulder-dominant movement patterns
- Out-of-plane movement effects on 2D angle observation
- Usefulness of `peakElbowExtensionDeg` for therapist review

Not yet implemented on `dev_branch`:

- Clinician assignment UI for Motor Screen tasks
- Live CV frame adapter feeding engine commands
- API persistence of attempt results
- Assessment Center card / review surface
- Session Orchestrator integration

---

## Related documents

- `docs/RASQ_CURRENT_STATE.md` — platform snapshot including PR #191–#194 status
- `docs/project-log.md` — merge history entries
- `docs/assessment-delivery-architecture.md` — clinic/remote delivery spine (Motor Screen not yet wired)
- `docs/shoulder-abduction-reach-detector.md` — Interactive Shoulder **Rehabilitation** CV (separate domain)
- `docs/cv/CV_EXERCISE_ALLOWLIST_PLAN.md` — patient CV **`functional-reach`** exercise (not Motor Screen Forward Reach)
