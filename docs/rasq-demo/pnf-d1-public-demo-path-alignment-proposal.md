# PNF D1 public demo — illustration vs live path alignment

**Status:** Proposal only (no implementation in this document).  
**Scope:** `/demo` public session and mobile guide imagery.  
**Out of scope:** Shared `d1-inspired-diagonal-reach` pattern used by patient/rehab sessions, CV measurement pipeline, approved WebP artwork.

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
- `feedbackProfile: d1-inspired-diagonal-reach` → shared D1-inspired pattern

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

## Actual mismatch

| | Illustration | Live demo (right block, mirrored-preview anatomy) |
|---|--------------|---------------------------------------------------|
| **Start** | Right side, low | **Left** side, low |
| **End** | Left shoulder (contralateral high) | **Right** side, raised (ipsilateral high) |
| **Diagonal story** | Ipsilateral low → contralateral shoulder | Contralateral low → ipsilateral high |

The paths are **rough mirror images in anatomical start/end**, not the same PNF D1 flexion story as the approved art. Prior PR copy that described a two-pose composite, OpenCV arrow redraw, or “aligned because preview is mirrored” was **incorrect** for the current single-frame asset and for anatomy.

**Reach to Right** block remains a separate check: side-biased reach targets vs seated reach art — not covered in detail here.

**Seated art vs standing camera:** Illustration is seated; demo allows seated/standing. That is a **presentation** mismatch only; the **path** mismatch above is independent of posture.

## Narrow correction proposal (public demo only)

**Goals:** Live SVG path and mobile/welcome guide tell the same anatomical story; **no** edits to `D1_INSPIRED_DIAGONAL_REACH_PATTERN` or rehab catalog wiring.

**Recommended approach (smallest isolated change):**

1. Add a **demo-only** motion pattern (new id + feedback profile key, e.g. `rasq-demo-d1-diagonal-reach`) under `app/lib/rasq-demo/`, with waypoints that in mirrored-preview space run **high x, high y → low x, low y** (right low → left shoulder), e.g. x-reflect the current D1 waypoint set for the right side:
   - start ≈ (0.66, 0.66), end ≈ (0.34, 0.22), with intermediate points reflected accordingly.
2. Register the pattern in `motion-pattern-registry.ts` (additive entry only).
3. Point **only** `RASQ_TWO_MINUTE_DEMO_SESSION` PNF block at the new `feedbackProfile`.
4. Add tests: demo session definition references new profile; resolved right-side path start/end anatomically match documented illustration anchors (normalized tolerance).
5. Re-run QA capture (`scripts/capture-demo-illustrations-qa.mjs`) for mobile **active** PNF frame and spot-check overlay on Dev.

**Alternatives (weaker):**

- **Copy-only:** Short on-screen note during PNF block that the glowing path is a simplified demo line, not the illustrated trajectory — reduces confusion but leaves visual mismatch.
- **Hide mobile guide during active block** — avoids juxtaposition but loses the intended coaching aid.

**Explicit non-options:**

- Changing shared D1 waypoints for all patient/rehab flows to match marketing art without clinical review.
- Re-mirroring or flipping the illustration to match the old path without product approval.

## Validation checklist (when implemented)

- [ ] `/demo` PNF block: wrist can follow path; repetitions still complete.
- [ ] Mobile: guide visible during PNF; path direction matches art at a glance.
- [ ] Patient stroke foundation / clinical D1 blocks still use `d1-inspired-diagonal-reach`.
- [ ] `npm test`, `npm run build`, QA PNGs updated if layout changes.
