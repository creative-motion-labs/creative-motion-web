-- ============================================================
-- Migration 022 — ml_research_volunteer_repetitions
--
-- Anonymous volunteer Shoulder Abduction Reach repetition payload
-- persistence (Slice 8B.2). Research-only — NO clinical FKs.
--
-- Apply on Staging after review; do not apply to Production until approved.
-- Prerequisites: 021_ml_research_volunteer_sessions.sql
-- ============================================================

create table if not exists public.ml_research_volunteer_repetitions (
  id                      uuid        primary key default gen_random_uuid(),
  movement_session_id     uuid        not null
    references public.ml_research_volunteer_movement_sessions (id)
    on delete restrict,
  client_submission_id    uuid        not null,
  repetition_index        integer     not null,
  capture_schema_version  text        not null,
  feature_schema_version  text        not null,
  started_at_ms           bigint      not null,
  ended_at_ms             bigint      not null,
  frames                  jsonb       not null,
  derived_features        jsonb       not null,
  payload_hash            text        not null,
  created_at              timestamptz not null default now(),

  constraint mlrvr_repetition_index_chk
    check (repetition_index >= 1),

  constraint mlrvr_started_at_ms_chk
    check (started_at_ms >= 0),

  constraint mlrvr_ended_at_ms_chk
    check (ended_at_ms >= started_at_ms),

  constraint mlrvr_client_submission_unique
    unique (movement_session_id, client_submission_id)
);

create index if not exists ml_research_volunteer_repetitions_movement_session_id_idx
  on public.ml_research_volunteer_repetitions (movement_session_id);

alter table public.ml_research_volunteer_repetitions enable row level security;

revoke all on public.ml_research_volunteer_repetitions from anon;
revoke all on public.ml_research_volunteer_repetitions from authenticated;

grant select, insert, update, delete on public.ml_research_volunteer_repetitions
  to service_role;
