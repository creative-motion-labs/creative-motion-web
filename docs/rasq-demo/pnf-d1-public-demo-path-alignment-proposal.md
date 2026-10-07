# PNF D1 public demo — illustration vs live path

**Status (PR #311 revised):** Public `/demo` PNF **runtime** restored to pre–PR #310 behavior (`d1-inspired-diagonal-reach`). **Approved WebP guides** and responsive display from PR #310 are **retained**.

**Scope:** Documentation and product honesty only — no further path-engineering on this branch.

## What participants see

| Surface | Content | Coordinate / motion model |
|---------|---------|---------------------------|
| Welcome + mobile companion | `RASQ_DEMO_PNF_D1_ILLUSTRATION` (`demo-exercise-illustrations.ts`) | Anatomical story: right hand **low on the right** → **across toward left shoulder** |
| Live camera overlay | Clinical `D1_INSPIRED_DIAGONAL_REACH_PATTERN`, `side: "right"` | Authored in **mirrored preview space** (#277); wrist via `toMirroredPreviewPoint` |

## Live runtime wiring (matches `b4a5a3a`)

- PNF block: `feedbackProfile: d1-inspired-diagonal-reach`
- Therapeutic side: `right` (block + orchestrator resolution)
- No demo-only pattern registry entry; no presentation-side override

Right-side waypoints (mirrored preview, high **x** = patient’s anatomical right):

| Label | (x, y) |
|-------|--------|
| start | (0.34, 0.66) |
| end | (0.66, 0.22) |

Screen reading for `side: "right"`: path runs from **lower-left of the frame** toward **upper-right of the frame** (contralateral low → ipsilateral elevated in preview space).

## Honest remaining difference

The **static illustration** depicts the familiar PNF D1 flexion story (right arm low on the right, finishing toward the **left shoulder**). The **live SVG path** is the shared clinical D1-inspired diagonal used in rehab sessions; it was validated for CV progression, not for pixel alignment with this demo art.

Mirroring (#277) keeps the **wrist marker and path in one coordinate system**; it does **not** rotate the authored diagonal to match the illustration’s contralateral finish. Participants may therefore see a diagonal that **does not trace the same corners** as the guide image, while repetition completion and audio behave as before PR #310.

PR #310’s demo-only x-reflected pattern and PR #311’s presentation-side pin are **removed** after user confirmation that pre–#310 exercise behavior was appropriate.

## Validation

- [x] `demo-session-definition.test.ts` — clinical pattern id + five repetitions
- [x] Clinical prescribed-side regressions unchanged (`resolve-interactive-shoulder-side.test.ts`, `orchestrator-cv-block-dispatch.test.ts`)
- [x] `demo-exercise-illustrations.test.ts` — assets and alt text preserved
- [ ] Manual: `/demo` PNF with camera — confirm restored path feel matches pre–#310 expectation
