-- ============================================================
-- Migration 025 — interactive_shoulder_movement_outcomes (O1)
--
-- Clinical persistence boundary for one fully completed Interactive
-- Shoulder session's movement outcome. Schema-only, mirroring the
-- Upper-Limb Motor Screen persistence pattern (019). No API route
-- accompanies this migration — runtime submission (O2) and clinician
-- review/finalize (O3) are deferred to later slices; this table has
-- no status/finalize lifecycle column for that reason.
--
-- MVP scope, approved after review: only a fully completed session
-- (session_state = 'completed') may be persisted through this
-- contract. A cancelled, manually/safety-stopped, errored, or
-- otherwise partial session is never eligible — there is no separate
-- partial-session persistence model. An earlier draft of this
-- migration also allowed 'stopped'; that was rejected in review and
-- removed before this migration was ever applied anywhere.
--
-- Authority: prescribed_side here is a server-resolved copy of
-- plan_sessions.prescribed_side (023) at the moment the outcome was
-- recorded — never a value accepted from the browser. It is nullable
-- for the same reason plan_sessions.prescribed_side is nullable: not
-- every session is unilaterally prescribed.
--
-- One outcome per plan session: plan_session_id is unique. A retry of
-- the same session's submission must be idempotent (return the
-- existing row), not create a second clinical record and not
-- overwrite the first — enforced at the DB layer by the unique
-- constraint; the future persistence-layer caller (O2) is responsible
-- for the insert/catch-conflict/reselect flow this enables.
--
-- Canonical payload: outcome_payload holds the complete assembled
-- InteractiveShoulderMovementOutcomeSnapshot as JSONB. plan_session_id/
-- plan_id/provider_id/patient_id/prescribed_side/session_state are
-- typed, denormalised read-optimization projections of fields already
-- stable and query-relevant — never an independent source of truth;
-- two CHECK constraints below tie the projected prescribed_side/
-- session_state columns back to the payload.
--
-- Isolation: no foreign key to any ml_research_volunteer_* table, and
-- no volunteer/research table references this one. Entirely within
-- the clinical schema (plan_sessions / treatment_plans / patients /
-- providers).
--
-- FK cascade behavior mirrors session_logs (002) exactly: plan_id and
-- patient_id cascade with their parent, provider_id restricts, and
-- plan_session_id sets null on delete (immutable record outlives a
-- later-deleted session row) rather than cascading — a NULL
-- plan_session_id does not violate the unique constraint, since
-- Postgres treats multiple NULLs in a UNIQUE column as non-conflicting.
--
-- No UPDATE/DELETE policy for authenticated users — append-only,
-- immutable, matching session_logs. Writes occur only through a
-- future service-role API route (O2).
--
-- Do NOT apply to Staging or Production until explicitly approved.
-- Author in Git only during this slice — remote apply is a separate,
-- later, explicitly-approved step.
--
-- Prerequisites:
--   - 002_core_tables.sql (treatment_plans, plan_sessions, providers, patients)
--   - 013_service_role_table_grants.sql (service_role default privileges)
--   - 023_plan_sessions_prescribed_side.sql (plan_sessions.prescribed_side)
-- ============================================================

create table if not exists public.interactive_shoulder_movement_outcomes (
  id               uuid        primary key default gen_random_uuid(),

  plan_session_id  uuid                    references public.plan_sessions(id)   on delete set null,
  plan_id          uuid        not null    references public.treatment_plans(id) on delete cascade,
  provider_id      uuid        not null    references public.providers(id)       on delete restrict,
  patient_id       uuid        not null    references public.patients(id)        on delete cascade,

  -- Server-resolved copy of plan_sessions.prescribed_side at record time.
  -- Never a client-supplied value. NULL means the session was not
  -- unilaterally prescribed — never a silent default to a side.
  prescribed_side  text,

  -- Orchestrator session state at the moment this outcome was recorded.
  -- Only 'completed' is legitimate here — cancelled, stopped, errored,
  -- safety-held, or otherwise partial/in-progress sessions must never
  -- produce a row (ishmo_session_state_chk below).
  session_state    text        not null,

  outcome_payload  jsonb       not null,
  schema_version   text        not null,

  created_at       timestamptz not null default now(),

  constraint ishmo_prescribed_side_chk
    check (prescribed_side is null or prescribed_side in ('left', 'right')),

  -- MVP contract: only a fully completed session is eligible. No
  -- cancelled/stopped/errored/safety-held/partial session can satisfy
  -- this check — see the migration header note above.
  constraint ishmo_session_state_chk
    check (session_state = 'completed'),

  -- Payload/column consistency — IS NOT DISTINCT FROM so a missing/null
  -- payload key is a genuine mismatch, not silently satisfied by NULL.
  constraint ishmo_payload_session_state_chk
    check ((outcome_payload ->> 'sessionState') is not distinct from session_state),

  constraint ishmo_payload_prescribed_side_chk
    check ((outcome_payload ->> 'prescribedSide') is not distinct from prescribed_side),

  -- One clinical outcome snapshot per plan session.
  constraint ishmo_plan_session_unique unique (plan_session_id)
);

comment on table public.interactive_shoulder_movement_outcomes is
  'One clinical movement-outcome snapshot per Interactive Shoulder plan session. Immutable, append-only. Written only by a service-role API route (O2, not yet implemented).';

comment on column public.interactive_shoulder_movement_outcomes.prescribed_side is
  'Server-resolved copy of plan_sessions.prescribed_side at record time. Never accepted from the browser. NULL means not unilaterally prescribed.';

comment on column public.interactive_shoulder_movement_outcomes.outcome_payload is
  'Complete InteractiveShoulderMovementOutcomeSnapshot (interaction/measured/interpreted per block, session-level facts). Canonical source of truth; typed columns are read-optimization projections only.';

create index if not exists interactive_shoulder_movement_outcomes_plan_idx
  on public.interactive_shoulder_movement_outcomes (plan_id);

create index if not exists interactive_shoulder_movement_outcomes_patient_idx
  on public.interactive_shoulder_movement_outcomes (patient_id);

create index if not exists interactive_shoulder_movement_outcomes_provider_idx
  on public.interactive_shoulder_movement_outcomes (provider_id);

-- RLS
alter table public.interactive_shoulder_movement_outcomes enable row level security;

create policy "interactive_shoulder_movement_outcomes: provider selects own"
  on public.interactive_shoulder_movement_outcomes for select
  using (provider_id = auth.uid());

-- No INSERT policy for authenticated/anon users — writes go through a
-- future service-role API route only (O2).
-- No UPDATE policy — immutable clinical record, matching session_logs.
-- No DELETE policy — immutable clinical record, matching session_logs.
-- Service role bypasses RLS for the eventual server-side write path.

grant select, insert, update, delete
  on public.interactive_shoulder_movement_outcomes to service_role;
