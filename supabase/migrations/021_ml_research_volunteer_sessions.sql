-- ============================================================
-- Migration 021 — ml_research_volunteer_collection_sessions,
--                  ml_research_volunteer_movement_sessions
--
-- Anonymous volunteer motion-data collection (Slice 8B.1).
-- Research-only tables — NO FK to patients, assessments, cv_session_metrics,
-- treatment plans, or any clinical workflow table.
--
-- Browser clients never receive direct table access:
--   - RLS enabled with no permissive anon/authenticated policies
--   - anon/authenticated privileges revoked
--   - writes occur only through Next.js API routes using service_role
--
-- Repetition payload persistence is intentionally deferred to Slice 8B.2.
--
-- Apply on Staging first; do not apply to Production until explicitly
-- approved. Author in Git only during implementation — remote apply is a
-- separate post-review step.
--
-- Prerequisites:
--   - 013_service_role_table_grants.sql (service_role default privileges)
-- ============================================================

-- ------------------------------------------------------------
-- 1. ml_research_volunteer_collection_sessions
-- ------------------------------------------------------------

create table if not exists public.ml_research_volunteer_collection_sessions (
  id                      uuid        primary key default gen_random_uuid(),
  participant_id          uuid        not null,
  session_token_hash      text        not null unique,
  token_expires_at        timestamptz not null,
  status                  text        not null,
  age_confirmed_18_plus   boolean     not null,
  consent_version         text        not null,
  consent_accepted_at_ms  bigint      not null,
  protocol_version        text        not null,
  deletion_code_hash      text        null,
  created_at              timestamptz not null default now(),
  completed_at            timestamptz null,

  constraint mlrvcs_status_chk
    check (status in ('active', 'completed', 'expired')),

  constraint mlrvcs_age_confirmed_chk
    check (age_confirmed_18_plus = true),

  constraint mlrvcs_consent_accepted_ms_chk
    check (consent_accepted_at_ms >= 0)
);

create index if not exists ml_research_volunteer_collection_sessions_participant_id_idx
  on public.ml_research_volunteer_collection_sessions (participant_id);

create index if not exists ml_research_volunteer_collection_sessions_status_idx
  on public.ml_research_volunteer_collection_sessions (status);

create index if not exists ml_research_volunteer_collection_sessions_token_expires_at_idx
  on public.ml_research_volunteer_collection_sessions (token_expires_at);

alter table public.ml_research_volunteer_collection_sessions enable row level security;

-- ------------------------------------------------------------
-- 2. ml_research_volunteer_movement_sessions
-- ------------------------------------------------------------

create table if not exists public.ml_research_volunteer_movement_sessions (
  id                      uuid        primary key default gen_random_uuid(),
  collection_session_id   uuid        not null
    references public.ml_research_volunteer_collection_sessions (id)
    on delete restrict,
  block_index             smallint    not null,
  movement_type           text        not null,
  side                    text        not null,
  protocol_condition      text        not null,
  created_at              timestamptz not null default now(),

  constraint mlrvms_block_index_chk
    check (block_index >= 1),

  constraint mlrvms_movement_type_chk
    check (movement_type in ('shoulder_abduction_reach')),

  constraint mlrvms_side_chk
    check (side in ('left', 'right')),

  constraint mlrvms_protocol_condition_chk
    check (
      protocol_condition in (
        'NORMAL',
        'SIMULATED_MILD_COMPENSATION',
        'SIMULATED_CLEAR_COMPENSATION'
      )
    ),

  constraint mlrvms_collection_block_unique
    unique (collection_session_id, block_index)
);

create index if not exists ml_research_volunteer_movement_sessions_collection_session_id_idx
  on public.ml_research_volunteer_movement_sessions (collection_session_id);

alter table public.ml_research_volunteer_movement_sessions enable row level security;

-- ------------------------------------------------------------
-- 3. Privileges — server-only writes via service_role
-- ------------------------------------------------------------

revoke all on
  public.ml_research_volunteer_collection_sessions,
  public.ml_research_volunteer_movement_sessions
from anon;

revoke all on
  public.ml_research_volunteer_collection_sessions,
  public.ml_research_volunteer_movement_sessions
from authenticated;

grant select, insert, update, delete on
  public.ml_research_volunteer_collection_sessions,
  public.ml_research_volunteer_movement_sessions
to service_role;
