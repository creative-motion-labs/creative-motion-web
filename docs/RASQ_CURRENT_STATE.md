# RASQ Current State

**Last updated:** 2026-07-31
**Baseline:** Development baseline: `dev_branch` at `c7c950a`. It includes the `main` baseline through PR114, subsequent development work through PR181–PR190, and the Upper-Limb Motor Screen work merged through PR191–PR194. These development-branch features must not be interpreted as fully deployed production functionality.

This document is the single source of truth for RASQ platform state during controlled clinic pilots. It is **not** a clinical or legal document. All movement observations require **therapist review**. RASQ does **not** diagnose, score clinically, or make automatic treatment decisions.

---

## Production snapshot

| Area | Status |
|------|--------|
| Core workflow (assessment → plan → patient portal → clinician review) | Live |
| Clinician-only AI draft summary v0 | Live — review only, not persisted to patient |
| Assessment Center | Live — `/clinician/assessments` |
| Sit-to-Stand assessment review | Live — `/clinician/assessments/sit-to-stand` |
| Gait Assessment v1 | Shell live — `/clinician/assessments/gait` (PR110 review wiring; capture later) |
| Patient CV (optional camera assist) | Live — multi-exercise allowlist; **STS most mature** |
| STS capture quality & reliability | Live — PR100 |
| STS adaptive framing readiness | Live — PR101 |
| Patient camera consent gate | Live — PR103 |
| STS pilot QA validation (docs) | **PR104** — code-path + unit tests; manual smoke required |
| PDPL readiness foundation (docs) | **PR105** — data inventory, flow map, pilot privacy checklist |
| Controlled STS pilot plan (docs) | **PR106** — first clinic pilot protocol (3–5 patients) |
| CV allowlist expansion plan (docs) | **PR107** — post-STS exercise sequencing; heel-raise first |
| Heel Raise CV hardening plan (docs) | **PR108** — gap analysis; readiness 68/100; PR109 implementation slices |
| Gait Assessment v1 capture audit (docs) | **PR109** — bounded walking observation path; after STS testing |
| Gait Assessment review wiring | **PR110** — STS-style metrics fetch + empty state; no capture |
| Progress & Outcomes Hub audit (docs) | **PR111** — fragmented data inventory; PR112 hub plan |
| Progress & Outcomes Hub v1 | **PR112** — read-only clinician hub at `/clinician/patients/[id]/outcomes` |
| Progress & Outcomes Hub polish (docs + UI) | **PR113** — section badges, empty states, nav links, QA checklist |
| Real data flow validation (docs + plan fix) | **PR114** — outcomes API plan resolution aligned with profile; journey QA doc |
| Upper-Limb Motor Screen — Phase 1 foundation | **PR191** on `dev_branch` — types, assignment validation, clinical stop, protective pause |
| Upper-Limb Motor Screen — Forward Reach engine | **PR192** on `dev_branch` — library only; no UI/API wiring |
| Upper-Limb Motor Screen — Lateral Reach engine | **PR193** on `dev_branch` — library only; horizontal target-facing onset |
| Upper-Limb Motor Screen — Elbow Extension engine | **PR194** on `dev_branch` — library only; 2D target-facing onset + optional `peakElbowExtensionDeg` |
| Upper-Limb Motor Screen — clinician UI / live capture | **Not wired** — engines and synthetic tests only |
| Balance / Functional Movement / PR forms (Assessment Center) | Coming next |

**Production URL:** https://creative-motion-web.vercel.app

---

## Architecture (high level)

```
Clinician portal                         Patient portal
────────────────                         ──────────────
Assessment Center                        Active exercise session
  ├─ STS motion evidence review            └─ PatientCvCapture (on-device)
  └─ Gait shell (planned metrics)              ├─ MediaPipe pose
Results queue / CV Lab                         ├─ Exercise detectors
Patient profile + AI draft (clinician)         ├─ Setup readiness + framing
                                               └─ Derived metrics POST
         │                                           │
         └──────────── Supabase / API ────────────────┘
                              │
                    Motion analysis report
                    Capture quality + reliability flags
                    STS motion pilot record (when present)
```

**Safety framing (all surfaces):** Camera-assisted observations and derived metrics support **therapist review only**. They are **not clinically validated** as standalone assessments, do **not** diagnose, and do **not** replace licensed clinical judgment.

---

## Completed PRs (recent — PR99–PR114, PR191–PR194 on dev_branch)

### PR194 — Elbow Extension engine (dev_branch)
- `app/lib/upper-limb-motor-screen/elbow-extension-engine.ts` — third Motor Screen task reducer
- Target-facing onset via 2D dot product toward configured target; wrong-direction exit re-arms readiness
- Optional factual `peakElbowExtensionDeg` (shoulder→elbow→wrist 2D angle during outbound/dwelling); never gates completion
- 101 synthetic tests; combined reach-engine suite 366/366 pass
- **No** UI, API persistence, or live-camera wiring
- See `docs/upper-limb-motor-screen.md`

### PR193 — Lateral Reach engine (dev_branch)
- `app/lib/upper-limb-motor-screen/lateral-reach-engine.ts` — horizontal target-facing onset, wrong-direction re-arming
- 146 synthetic tests
- **No** UI or live capture wiring

### PR192 — Forward Reach engine (dev_branch)
- `app/lib/upper-limb-motor-screen/forward-reach-engine.ts` — any-direction zone-exit onset
- 119 synthetic tests
- **Not** the patient CV `functional-reach` exercise — separate assessment task (`taskId: forwardReach`)

### PR191 — Upper-Limb Motor Screen foundation (dev_branch)
- `types.ts`, `assignment-validation.ts`, `clinical-stop-evaluator.ts`, `protective-pause-evaluator.ts`
- Phase 1 contracts: `testedSide` vs `affectedSide`, six terminal outcomes, safety-vocabulary guard
- 155 foundation tests
- Assessment domain separate from Interactive Upper-Limb Rehabilitation

### PR114 — Real data flow validation
- `GET /api/clinician/progress-outcomes` — current plan resolution matches patient profile (active plan first, else newest)
- `docs/pilot/real-data-flow-validation.md` — one-patient journey checklist; empty hub expectations
- Cross-link from `docs/pilot/progress-outcomes-hub-qa.md`
- No patient portal, CV, DB, or AI changes

### PR113 — Progress & Outcomes Hub polish & validation
- UI polish on `/clinician/patients/[id]/outcomes` — header nav, section chips/badges, tightened safe wording, improved empty states, footer links
- Hub-specific CV footer without prohibited wording
- `docs/pilot/progress-outcomes-hub-qa.md` — manual QA checklist for demo/pilot review
- No API, database, AI, or patient-facing changes

### PR112 — Progress & Outcomes Hub v1
- `/clinician/patients/[id]/outcomes` — read-only clinician aggregation (session activity, patient-reported pain table, assessments, camera-assisted timeline, capture reliability)
- `GET /api/clinician/progress-outcomes` — composes existing data only
- Navigation from patient profile, results queue; legacy progress redirect

### PR111 — Progress & Outcomes Hub audit (docs only)
- `docs/progress/PROGRESS_OUTCOMES_HUB_AUDIT.md` — data inventory, care pathway joins, safe outcome views, PR112 plan
- Verdict: progress data exists but fragmented; unified hub can aggregate existing APIs without migration

### PR110 — Gait Assessment review surface wiring
- `/clinician/assessments/gait` — fetches CV session metrics (STS pattern), filters gait exercise IDs, empty state, `CvReviewSummary` when data exists
- `app/lib/cv/gait-assessment-exercise-ids.ts` — reserved IDs for future capture
- No gait capture, detector, or legacy gait AI

### PR109 — Gait Assessment v1 capture audit (docs only)
- `docs/assessments/GAIT_ASSESSMENT_V1_CAPTURE_AUDIT.md` — code inventory, minimal v1 scope, phases, STS sequencing gate
- Verdict: bounded walking observation feasible via existing MediaPipe stack; do not integrate legacy gait AI
- Recommended: Phase 0 review wiring (PR110), capture after STS internal testing

### PR108 — Heel Raise CV hardening plan (docs only)
- `docs/cv/HEEL_RAISE_CV_HARDENING_PLAN.md` — gap analysis, readiness score (68/100), PR109 implementation slices
- Verdict: can reach STS parity via existing architecture; blockers are capture quality, ankle coverage, manual smoke
- No code changes

### PR107 — CV exercise allowlist expansion plan (docs only)
- `docs/cv/CV_EXERCISE_ALLOWLIST_PLAN.md` — selection criteria, phased allowlist, defer list, implementation phases
- Recommended pilot expansion: STS (P0) → heel-raise (P1) → mini-squat → step-up → functional-reach
- No code or allowlist changes

### PR106 — Controlled STS pilot plan (docs only)
- `docs/pilot/CONTROLLED_STS_PILOT_PLAN.md` — first supervised clinic pilot using optional STS camera (3–5 patients)
- Success/failure criteria, STS testing steps, therapist/patient feedback, go/no-go decision matrix
- References PR104 manual smoke and PR105 privacy checklist

### PR105 — PDPL readiness foundation (docs only)
- `docs/compliance/PDPL_FOUNDATION.md` — data inventory, classification, minimization, consent, access control
- `docs/compliance/DATA_FLOW_MAP.md` — patient → camera → CV → metrics → Supabase → clinician review
- `docs/compliance/PILOT_PRIVACY_CHECKLIST.md` — pre-pilot privacy verification
- Technical and operational readiness — **not** legal compliance certification

### PR103 — Patient camera consent foundation
- Checkbox-required consent gate before camera access in `PatientCvCapture`
- Privacy and Terms links; unified EN/AR consent copy
- `captureConsent` persisted in existing `motion_quality` JSONB (`cv-camera-1.0`, timestamp)
- No database migration; no AI

### PR104 — STS pilot QA validation (docs only)
- `docs/pilot/sts-pilot-qa-validation.md` — checklist, pass/fail table, manual smoke steps
- Validates STS workflow after PR100–PR103; **bugs found: none**
- **STS ready for controlled clinic pilot** with required manual device smoke per clinic

### PR99 — Gait Assessment v1 shell
- Assessment Center hub links for **Gait** and **Sit-to-Stand**
- `/clinician/assessments/gait` — clinician review shell, planned walking metrics, therapist-review disclaimer
- **No** live gait capture, detector, or persistence

### PR100 — STS capture reliability & quality review
- Capture quality scoring aligned with `capture_setup_limited` and interruption flags
- Clinician capture limitations summary (visibility %, rep clarity, flags) for medium/low sessions
- Patient limited-quality messaging and retest guidance
- Compatible with older records; no database changes

### PR101 — STS adaptive framing readiness
- `sts-landmark-coverage` module — shoulders, hips, knees core; ankles bonus only
- STS readiness can pass under advisory `move_back` when coverage + tracking are good
- Hip/knee safety gates unchanged; non-STS framing unchanged
- STS setup copy updated for tall users and small rooms

### PR98 — Superseded (open PR #97)
- **STS assessment card + review route** landed on `main` via **PR99**
- Open PR #97 can be **closed without merge** — see [Open PR cleanup](#open-pr-cleanup)

---

## Patient computer vision (current)

### Allowlist (`PatientCvCapture`)

Optional camera assist may appear during active portal sessions for:

| Exercise | Maturity | Notes |
|----------|----------|-------|
| **sit-to-stand** | **Primary / most mature** | Biomech capture v2, motion timeline, capture quality, PR101 coverage readiness |
| mini-squat | Wired | Baseline rep counting |
| single-leg-stance | Wired | Hold detection shell |
| heel-raise | Motion pilot | Wired — **PR108** hardening plan; promote after STS go + PR109 |
| step-up | Motion pilot | Feature-flagged copy path |
| lateral-step | Motion pilot | Feature-flagged copy path |
| functional-reach | Motion pilot | Feature-flagged copy path |

**Pilot messaging:** Position **sit-to-stand** as the reference CV path for demos. Expansion sequence after STS pilot: **heel-raise → mini-squat → step-up → functional-reach** per `docs/cv/CV_EXERCISE_ALLOWLIST_PLAN.md`. `single-leg-stance` and `lateral-step` remain in codebase but deferred for pilot expansion messaging.

**Patient choice:** Continue without camera always available. Poor tracking or save errors do not block session completion.

**Consent (PR103):** Before camera access, patients must check an explicit consent box (camera-assisted movement observation; therapist review only; not diagnostic). Acceptance is stored as `motion_quality.captureConsent` (`cv-camera-1.0`, timestamp) on saved CV metrics — no separate consent table.

**CV Lab** (`/clinician/cv-lab`): Internal clinician tooling — not required for patient pilot path.

---

## Assessment Center

| Card | Route | State |
|------|-------|-------|
| Gait Assessment | `/clinician/assessments/gait` | Shell v1 — planned metrics only |
| Sit-to-Stand Assessment | `/clinician/assessments/sit-to-stand` | Live — filters STS session metrics via `CvReviewSummary` |
| Balance Assessment | — | Coming next |
| Functional Movement | — | Coming next |
| Patient-Reported Forms | — | Coming next |

---

## Pilot readiness

| Dimension | Assessment |
|-----------|------------|
| Core RASQ workflow | **Ready** for controlled pilots |
| STS optional camera assist | **Ready** — PR100/101/103; PR104 QA pass; **manual device smoke required** |
| Assessment Center | **Partial** — STS review useful; Gait/Balance are shells |
| Upper-Limb Motor Screen (library) | **Engine-complete on dev_branch** — PR191–194; synthetic tests pass; **no live capture or UI** |
| Pilot documentation | **Updated** — PR102–PR109 incl. gait capture audit; Motor Screen doc added 2026-07-31 |
| Privacy & compliance (technical) | **Foundation documented** — PR105; counsel review still required |
| Legal / counsel | Pages pilot-ready; counsel review required before commercial contracts |

**Pre-demo / pre-pilot:** Use `docs/pilot/CONTROLLED_STS_PILOT_PLAN.md` (first STS clinic pilot), `docs/pilot/sts-pilot-qa-validation.md` (manual smoke), `docs/compliance/PILOT_PRIVACY_CHECKLIST.md` (privacy), `docs/pilot/pilot-checklist.md`, and `docs/pilot/clinician-onboarding-guide.md`.

---

## Privacy & compliance

**Status:** PDPL Readiness Foundation (PR105) — privacy-by-design documentation for pilot deployment. **Not** a legal compliance certification.

| Document | Purpose |
|----------|---------|
| `docs/compliance/PDPL_FOUNDATION.md` | Data inventory, classification, purpose limitation, minimization, consent, access control, retention considerations |
| `docs/compliance/DATA_FLOW_MAP.md` | Stored vs not stored across patient CV path |
| `docs/compliance/PILOT_PRIVACY_CHECKLIST.md` | Pre-pilot privacy verification (consent, links, tokens, derived metrics only) |

**Technical principles documented:**

- Therapist-review-only movement observations  
- No platform-generated diagnosis; no autonomous treatment decisions  
- No video storage; no raw landmark storage  
- Consent metadata (`captureConsent`) stored in `motion_quality` when CV metrics save (PR103)  

**Counsel review still required** before paid contracts, regulated scale, or public compliance claims. Trust pages (`/privacy`, `/terms`, `/intended-use`, `/clinical-safety`) are pilot-ready, not counsel-final.

---

## Deferred items

- Gait **live capture** and structured metrics
- Balance Assessment shell (Assessment Center)
- Functional Movement and Patient-Reported Forms modules
- Overlay UX polish when STS coverage-ready but framing advisory is amber
- CV pilot doc alignment for motion-pilot exercises beyond STS → **PR107 plan** (`docs/cv/CV_EXERCISE_ALLOWLIST_PLAN.md`)
- Close superseded PR #97 (PR98)
- Experimental branch PR #1 (`cv-readiness-experimental`) — not pilot scope

**Explicitly out of scope:** Database schema changes for CV pilots, patient-facing AI, diagnosis wording, autonomous treatment decisions, clinical scoring engines.

---

## Recommended next PR

**Operational:** Execute controlled STS pilot per `docs/pilot/CONTROLLED_STS_PILOT_PLAN.md` before gait capture or heel-raise promotion.

**Outcomes hub:** Run `docs/pilot/real-data-flow-validation.md` to populate hub with real session data; then `docs/pilot/progress-outcomes-hub-qa.md` for UI/sign-off.

**Product:** Heel raise hardening, gait capture, Assessment Center forms, or Upper-Limb Motor Screen UI/capture wiring per existing plans.

**Upper-Limb Motor Screen (dev_branch):** Live-camera adapter and clinician review surface after recorded-sequence validation of engine thresholds — see `docs/upper-limb-motor-screen.md`.

**CV expansion (after STS go):** Heel Raise hardening per `docs/cv/HEEL_RAISE_CV_HARDENING_PLAN.md`.

**Assessment Center:** Gait capture after STS internal testing per `docs/assessments/GAIT_ASSESSMENT_V1_CAPTURE_AUDIT.md` (review surface in PR110).

**Alternative product:** **Balance Assessment v1 shell** (PR99 pattern).

**Compliance follow-up (optional):** Clinician-visible `captureConsent` read-only field; automated retention policy — only after counsel input.

---

## Open PR cleanup

| PR | Branch | Recommendation |
|----|--------|----------------|
| **#97 (PR98)** | `pr98/make-sts-assessment-card-actionable` | **Close without merge** — superseded by PR99 on `main`. `sit-to-stand/page.tsx` is identical; `page.tsx` on `main` additionally includes Gait Assessment v1 links. |

Suggested close comment:

> Superseded by PR99 (merged to main). STS assessment card, `/clinician/assessments/sit-to-stand`, and `CvReviewSummary` integration are already on main. No unique changes remain.

---

## Related documents

- `docs/upper-limb-motor-screen.md` — Motor Screen architecture, tasks, clinical boundaries, validation status (PR191–194)
- `docs/pilot/real-data-flow-validation.md` — PR114 assessment → plan → session → outcomes journey
- `docs/pilot/progress-outcomes-hub-qa.md` — PR113 outcomes hub manual QA
- `docs/progress/PROGRESS_OUTCOMES_HUB_AUDIT.md` — PR111 progress & outcomes hub audit
- `docs/assessments/GAIT_ASSESSMENT_V1_CAPTURE_AUDIT.md` — PR109 gait v1 capture audit
- `docs/cv/HEEL_RAISE_CV_HARDENING_PLAN.md` — PR108 heel-raise gap analysis and implementation slices
- `docs/cv/CV_EXERCISE_ALLOWLIST_PLAN.md` — PR107 post-STS CV expansion sequence
- `docs/pilot/CONTROLLED_STS_PILOT_PLAN.md` — PR106 first controlled STS clinic pilot
- `docs/compliance/PDPL_FOUNDATION.md` — PR105 PDPL readiness foundation
- `docs/compliance/DATA_FLOW_MAP.md` — CV data flow; stored vs not stored
- `docs/compliance/PILOT_PRIVACY_CHECKLIST.md` — Pre-pilot privacy checks
- `docs/pilot/sts-pilot-qa-validation.md` — PR104 STS QA + manual smoke (before STS camera pilot)
- `docs/pilot/known-limitations.md` — Share with clinicians before pilot
- `docs/pilot/pilot-checklist.md` — Before / during / after demo
- `docs/pilot/clinician-onboarding-guide.md` — First-time clinician steps
- `docs/pilot/pilot-workflow.md` — End-to-end flow
- `docs/project-log.md` — Historical merge log
