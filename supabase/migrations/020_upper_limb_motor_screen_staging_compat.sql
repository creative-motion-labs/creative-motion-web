-- ============================================================
-- Migration 020 — Staging compatibility upgrade for
--                  upper_limb_motor_screen_assignments,
--                  upper_limb_motor_screen_session_results
--
-- Converges a hand-built legacy Staging schema (never produced by this
-- repo's migration history — see 019's header) to the exact end-state
-- 019 defines. ALTER-only, no DROP TABLE: preserves the 2 existing
-- assignment rows and every already-stored legacy value. Every guard
-- is idempotent and table-scoped so this file can be safely re-run
-- against Staging if a partial apply needs to be retried.
--
-- 019 remains the canonical clean-install schema and is unchanged by
-- this migration.
--
-- Manual apply: wrapped in an explicit transaction so any failure
-- rolls back the whole compatibility upgrade, not a partial one.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Phase A — upper_limb_motor_screen_assignments (2 rows, preserve)
-- ------------------------------------------------------------

-- Identity: id must never be DB-generated (019 rule) — existing row
-- values are untouched, this only affects future inserts.
alter table public.upper_limb_motor_screen_assignments
  alter column id drop default;

-- Legacy-only columns become nullable so canonical 019-shaped inserts
-- (which never populate these) are not blocked. No defaults
-- fabricated, no existing values changed. Guarded per-column: on a
-- clean 019 install none of these columns exist at all, so 020 must
-- skip them rather than fail the migration chain.
do $$
declare
  legacy_col text;
begin
  foreach legacy_col in array array[
    'screen_definition_id',
    'assigned_at',
    'affected_side',
    'delivery_mode',
    'token_hash',
    'token_expires_at'
  ]
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'upper_limb_motor_screen_assignments'
        and column_name = legacy_col
    ) then
      execute format(
        'alter table public.upper_limb_motor_screen_assignments alter column %I drop not null',
        legacy_col
      );
    end if;
  end loop;
end $$;

-- Canonical timestamp defaults for future inserts; existing values untouched.
alter table public.upper_limb_motor_screen_assignments
  alter column created_at set default now(),
  alter column updated_at set default now();

-- schema_version: add nullable, backfill the 2 existing rows only
-- (via IS NULL), then enforce NOT NULL.
alter table public.upper_limb_motor_screen_assignments
  add column if not exists schema_version text;

update public.upper_limb_motor_screen_assignments
  set schema_version = 'legacy-pre-019-backfill'
  where schema_version is null;

alter table public.upper_limb_motor_screen_assignments
  alter column schema_version set not null;

-- status CHECK: replace the legacy-named constraint with 019's
-- canonical name/body so only one status constraint is authoritative.
alter table public.upper_limb_motor_screen_assignments
  drop constraint if exists ulms_assignments_status_chk;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ulmsa_status_chk'
      and conrelid = 'public.upper_limb_motor_screen_assignments'::regclass
  ) then
    alter table public.upper_limb_motor_screen_assignments
      add constraint ulmsa_status_chk
      check (status in ('assigned', 'started', 'completed', 'cancelled'));
  end if;
end $$;

-- ulms_assignments_affected_side_chk / ulms_assignments_delivery_mode_chk
-- intentionally NOT touched: standard Postgres CHECK semantics make a
-- bare `col IN (...)` NULL-permissive once the column-level NOT NULL
-- (dropped above) is gone — matches 019's own idiom of enforcing
-- nullability separately from the CHECK body.

-- Payload/typed-projection consistency checks (net-new).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ulmsa_payload_id_chk'
      and conrelid = 'public.upper_limb_motor_screen_assignments'::regclass
  ) then
    alter table public.upper_limb_motor_screen_assignments
      add constraint ulmsa_payload_id_chk
      check ((assignment_payload->>'id') is not distinct from id::text);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ulmsa_payload_status_chk'
      and conrelid = 'public.upper_limb_motor_screen_assignments'::regclass
  ) then
    alter table public.upper_limb_motor_screen_assignments
      add constraint ulmsa_payload_status_chk
      check ((assignment_payload->>'status') is not distinct from status);
  end if;
end $$;

-- Composite unique key backing session_results' ownership FK.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ulmsa_id_provider_patient_key'
      and conrelid = 'public.upper_limb_motor_screen_assignments'::regclass
  ) then
    alter table public.upper_limb_motor_screen_assignments
      add constraint ulmsa_id_provider_patient_key
      unique (id, provider_id, patient_id);
  end if;
end $$;

-- patient_id FK: reconcile in place to ON DELETE RESTRICT. Discovered
-- by LOCAL COLUMN + target table (not target table alone, and not a
-- guessed constraint name), so a same-named but unrelated future FK
-- to patients is never touched, and an already-correct FK under any
-- name is left alone.
do $$
declare
  local_col          smallint;
  existing_fk_name   text;
  existing_fk_action char;
begin
  select attnum into local_col
  from pg_attribute
  where attrelid = 'public.upper_limb_motor_screen_assignments'::regclass
    and attname = 'patient_id'
    and not attisdropped;

  select con.conname, con.confdeltype
    into existing_fk_name, existing_fk_action
  from pg_constraint con
  where con.conrelid = 'public.upper_limb_motor_screen_assignments'::regclass
    and con.contype = 'f'
    and con.confrelid = 'public.patients'::regclass
    and con.conkey = array[local_col];

  if existing_fk_name is not null and existing_fk_action <> 'r' then
    execute format(
      'alter table public.upper_limb_motor_screen_assignments drop constraint %I',
      existing_fk_name
    );
    existing_fk_name := null;
  end if;

  if existing_fk_name is null then
    alter table public.upper_limb_motor_screen_assignments
      add constraint upper_limb_motor_screen_assignments_patient_id_fkey
      foreign key (patient_id) references public.patients(id) on delete restrict;
  end if;
end $$;

-- provider_id FK: same reconciliation, matched by LOCAL COLUMN too —
-- avoids blindly adding a second FK if one already exists correctly.
do $$
declare
  local_col          smallint;
  existing_fk_name   text;
  existing_fk_action char;
begin
  select attnum into local_col
  from pg_attribute
  where attrelid = 'public.upper_limb_motor_screen_assignments'::regclass
    and attname = 'provider_id'
    and not attisdropped;

  select con.conname, con.confdeltype
    into existing_fk_name, existing_fk_action
  from pg_constraint con
  where con.conrelid = 'public.upper_limb_motor_screen_assignments'::regclass
    and con.contype = 'f'
    and con.confrelid = 'public.providers'::regclass
    and con.conkey = array[local_col];

  if existing_fk_name is not null and existing_fk_action <> 'r' then
    execute format(
      'alter table public.upper_limb_motor_screen_assignments drop constraint %I',
      existing_fk_name
    );
    existing_fk_name := null;
  end if;

  if existing_fk_name is null then
    alter table public.upper_limb_motor_screen_assignments
      add constraint upper_limb_motor_screen_assignments_provider_id_fkey
      foreign key (provider_id) references public.providers(id) on delete restrict;
  end if;
end $$;

-- token_hash UNIQUE: intentionally untouched — Postgres treats
-- multiple NULLs as non-conflicting, and 019 never populates this
-- column, so no future collision is possible.

-- Indexes (019 parity).
create index if not exists upper_limb_motor_screen_assignments_provider_id_idx
  on public.upper_limb_motor_screen_assignments (provider_id);

create index if not exists upper_limb_motor_screen_assignments_patient_id_idx
  on public.upper_limb_motor_screen_assignments (patient_id);

create index if not exists upper_limb_motor_screen_assignments_status_idx
  on public.upper_limb_motor_screen_assignments (status);

-- RLS: enabled explicitly, never inferred from policy presence alone.
alter table public.upper_limb_motor_screen_assignments enable row level security;

-- Policies: replace legacy with 019's approved set.
drop policy if exists "ulms_assignments: provider inserts own" on public.upper_limb_motor_screen_assignments;
drop policy if exists "ulms_assignments: provider selects own" on public.upper_limb_motor_screen_assignments;
drop policy if exists "ulms_assignments: provider updates own" on public.upper_limb_motor_screen_assignments;

drop policy if exists "upper_limb_motor_screen_assignments: provider selects own" on public.upper_limb_motor_screen_assignments;
create policy "upper_limb_motor_screen_assignments: provider selects own"
  on public.upper_limb_motor_screen_assignments for select
  using (provider_id = auth.uid());

drop policy if exists "upper_limb_motor_screen_assignments: provider inserts own" on public.upper_limb_motor_screen_assignments;
create policy "upper_limb_motor_screen_assignments: provider inserts own"
  on public.upper_limb_motor_screen_assignments for insert
  with check (provider_id = auth.uid());

drop policy if exists "upper_limb_motor_screen_assignments: provider updates own" on public.upper_limb_motor_screen_assignments;
create policy "upper_limb_motor_screen_assignments: provider updates own"
  on public.upper_limb_motor_screen_assignments for update
  using (provider_id = auth.uid())
  with check (provider_id = auth.uid());

drop policy if exists "upper_limb_motor_screen_assignments: provider deletes own" on public.upper_limb_motor_screen_assignments;
create policy "upper_limb_motor_screen_assignments: provider deletes own"
  on public.upper_limb_motor_screen_assignments for delete
  using (provider_id = auth.uid());

-- Triggers: replace legacy updated_at trigger, add identity-immutability
-- trigger (net-new — no legacy equivalent existed).
drop trigger if exists upper_limb_motor_screen_assignments_updated_at
  on public.upper_limb_motor_screen_assignments;
drop trigger if exists upper_limb_motor_screen_assignments_set_updated_at
  on public.upper_limb_motor_screen_assignments;
create trigger upper_limb_motor_screen_assignments_set_updated_at
  before update on public.upper_limb_motor_screen_assignments
  for each row execute function public.set_updated_at();

create or replace function public.enforce_ul_assignment_identity_immutability()
returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.provider_id is distinct from old.provider_id
     or new.patient_id is distinct from old.patient_id
     or new.created_at is distinct from old.created_at
  then
    raise exception
      'upper_limb_motor_screen_assignments: identity/ownership fields are immutable for row %', old.id;
  end if;

  return new;
end;
$$;

drop trigger if exists upper_limb_motor_screen_assignments_identity_immutability
  on public.upper_limb_motor_screen_assignments;
create trigger upper_limb_motor_screen_assignments_identity_immutability
  before update on public.upper_limb_motor_screen_assignments
  for each row execute function public.enforce_ul_assignment_identity_immutability();

grant select, insert, update, delete
  on public.upper_limb_motor_screen_assignments to service_role;

-- ------------------------------------------------------------
-- Phase B — upper_limb_motor_screen_session_results (0 rows)
-- ------------------------------------------------------------

-- Rename legacy columns to 019's names (guarded so a retry after a
-- partial apply does not re-attempt an already-completed rename).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'upper_limb_motor_screen_session_results'
      and column_name = 'result_status'
  ) then
    alter table public.upper_limb_motor_screen_session_results
      rename column result_status to status;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'upper_limb_motor_screen_session_results'
      and column_name = 'session_result'
  ) then
    alter table public.upper_limb_motor_screen_session_results
      rename column session_result to result_payload;
  end if;
end $$;

alter table public.upper_limb_motor_screen_session_results
  add column if not exists provider_id uuid,
  add column if not exists patient_id uuid,
  add column if not exists overall_quality text,
  add column if not exists protective_pause_count integer,
  add column if not exists protective_pause_duration_ms_total integer,
  add column if not exists schema_version text;

-- Full identity/required-column convergence to 019. Table has 0 rows,
-- so every SET NOT NULL below is unconditionally safe.
alter table public.upper_limb_motor_screen_session_results
  alter column id drop default,
  alter column assignment_id set not null,
  alter column status set not null,
  alter column result_payload set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null,
  alter column provider_id set not null,
  alter column patient_id set not null,
  alter column overall_quality set not null,
  alter column protective_pause_count set not null,
  alter column protective_pause_duration_ms_total set not null,
  alter column schema_version set not null;

alter table public.upper_limb_motor_screen_session_results
  alter column status set default 'computed';

-- status CHECK: drop the known legacy constraint by its exact name,
-- then add only the approved 019 constraint.
alter table public.upper_limb_motor_screen_session_results
  drop constraint if exists ulms_session_results_status_chk;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ulmssr_status_chk'
      and conrelid = 'public.upper_limb_motor_screen_session_results'::regclass
  ) then
    alter table public.upper_limb_motor_screen_session_results
      add constraint ulmssr_status_chk check (status in ('computed', 'finalized'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ulmssr_overall_quality_chk'
      and conrelid = 'public.upper_limb_motor_screen_session_results'::regclass
  ) then
    alter table public.upper_limb_motor_screen_session_results
      add constraint ulmssr_overall_quality_chk
      check (overall_quality in ('good', 'fair', 'poor', 'unknown'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ulmssr_payload_id_chk'
      and conrelid = 'public.upper_limb_motor_screen_session_results'::regclass
  ) then
    alter table public.upper_limb_motor_screen_session_results
      add constraint ulmssr_payload_id_chk
      check ((result_payload->>'id') is not distinct from id::text);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ulmssr_payload_assignment_id_chk'
      and conrelid = 'public.upper_limb_motor_screen_session_results'::regclass
  ) then
    alter table public.upper_limb_motor_screen_session_results
      add constraint ulmssr_payload_assignment_id_chk
      check ((result_payload->>'assignmentId') is not distinct from assignment_id::text);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ulmssr_payload_status_chk'
      and conrelid = 'public.upper_limb_motor_screen_session_results'::regclass
  ) then
    alter table public.upper_limb_motor_screen_session_results
      add constraint ulmssr_payload_status_chk
      check ((result_payload->>'status') is not distinct from status);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ulmssr_payload_overall_quality_chk'
      and conrelid = 'public.upper_limb_motor_screen_session_results'::regclass
  ) then
    alter table public.upper_limb_motor_screen_session_results
      add constraint ulmssr_payload_overall_quality_chk
      check (
        (result_payload->'technicalTrackingQuality'->>'overallQuality')
        is not distinct from overall_quality
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ulmssr_payload_pause_count_chk'
      and conrelid = 'public.upper_limb_motor_screen_session_results'::regclass
  ) then
    alter table public.upper_limb_motor_screen_session_results
      add constraint ulmssr_payload_pause_count_chk
      check (
        (result_payload->'technicalTrackingQuality'->>'protectivePauseCount')::integer
        is not distinct from protective_pause_count
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ulmssr_payload_pause_duration_chk'
      and conrelid = 'public.upper_limb_motor_screen_session_results'::regclass
  ) then
    alter table public.upper_limb_motor_screen_session_results
      add constraint ulmssr_payload_pause_duration_chk
      check (
        (result_payload->'technicalTrackingQuality'->>'protectivePauseDurationMsTotal')::integer
        is not distinct from protective_pause_duration_ms_total
      );
  end if;
end $$;

-- Drop the legacy single-column assignment_id FK (ON DELETE CASCADE,
-- ON UPDATE NO ACTION), matched by LOCAL COLUMN + target table. It
-- must go, not just be left alongside the new composite FK: its
-- CASCADE would still fire on assignment deletion and silently defeat
-- the RESTRICT semantics of the composite ownership FK below.
do $$
declare
  local_col        smallint;
  legacy_fk_name   text;
begin
  select attnum into local_col
  from pg_attribute
  where attrelid = 'public.upper_limb_motor_screen_session_results'::regclass
    and attname = 'assignment_id'
    and not attisdropped;

  select con.conname into legacy_fk_name
  from pg_constraint con
  where con.conrelid = 'public.upper_limb_motor_screen_session_results'::regclass
    and con.contype = 'f'
    and con.confrelid = 'public.upper_limb_motor_screen_assignments'::regclass
    and con.conkey = array[local_col];

  if legacy_fk_name is not null then
    execute format(
      'alter table public.upper_limb_motor_screen_session_results drop constraint %I',
      legacy_fk_name
    );
  end if;
end $$;

-- Approved composite ownership FK (requires Phase A's unique key).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ulmssr_assignment_ownership_fkey'
      and conrelid = 'public.upper_limb_motor_screen_session_results'::regclass
  ) then
    alter table public.upper_limb_motor_screen_session_results
      add constraint ulmssr_assignment_ownership_fkey
      foreign key (assignment_id, provider_id, patient_id)
      references public.upper_limb_motor_screen_assignments (id, provider_id, patient_id)
      on delete restrict
      on update restrict;
  end if;
end $$;

-- Indexes (019 parity).
create index if not exists upper_limb_motor_screen_session_results_assignment_id_idx
  on public.upper_limb_motor_screen_session_results (assignment_id);

create index if not exists upper_limb_motor_screen_session_results_provider_id_idx
  on public.upper_limb_motor_screen_session_results (provider_id);

create index if not exists upper_limb_motor_screen_session_results_patient_id_idx
  on public.upper_limb_motor_screen_session_results (patient_id);

create index if not exists upper_limb_motor_screen_session_results_status_idx
  on public.upper_limb_motor_screen_session_results (status);

-- RLS: enabled explicitly, never inferred from policy presence alone.
alter table public.upper_limb_motor_screen_session_results enable row level security;

-- Policies: replace legacy with 019's approved set.
drop policy if exists "ulms_session_results: provider inserts own" on public.upper_limb_motor_screen_session_results;
drop policy if exists "ulms_session_results: provider selects own" on public.upper_limb_motor_screen_session_results;
drop policy if exists "ulms_session_results: provider updates own" on public.upper_limb_motor_screen_session_results;

drop policy if exists "ulmssr: provider selects own" on public.upper_limb_motor_screen_session_results;
create policy "ulmssr: provider selects own"
  on public.upper_limb_motor_screen_session_results for select
  using (provider_id = auth.uid());

drop policy if exists "ulmssr: provider inserts computed rows" on public.upper_limb_motor_screen_session_results;
create policy "ulmssr: provider inserts computed rows"
  on public.upper_limb_motor_screen_session_results for insert
  with check (provider_id = auth.uid() and status = 'computed');

drop policy if exists "ulmssr: provider updates computed rows" on public.upper_limb_motor_screen_session_results;
create policy "ulmssr: provider updates computed rows"
  on public.upper_limb_motor_screen_session_results for update
  using (provider_id = auth.uid() and status = 'computed')
  with check (provider_id = auth.uid() and status in ('computed', 'finalized'));

drop policy if exists "ulmssr: provider deletes computed rows" on public.upper_limb_motor_screen_session_results;
create policy "ulmssr: provider deletes computed rows"
  on public.upper_limb_motor_screen_session_results for delete
  using (provider_id = auth.uid() and status = 'computed');

-- Triggers: replace legacy updated_at trigger, add computed/finalized
-- immutability trigger (net-new — no legacy equivalent existed).
drop trigger if exists upper_limb_motor_screen_session_results_updated_at
  on public.upper_limb_motor_screen_session_results;
drop trigger if exists upper_limb_motor_screen_session_results_set_updated_at
  on public.upper_limb_motor_screen_session_results;
create trigger upper_limb_motor_screen_session_results_set_updated_at
  before update on public.upper_limb_motor_screen_session_results
  for each row execute function public.set_updated_at();

create or replace function public.enforce_ul_session_result_immutability()
returns trigger language plpgsql as $$
declare
  submitted_payload jsonb;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'computed' then
      raise exception
        'upper_limb_motor_screen_session_results: new rows must begin as computed (got status %)', new.status;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'finalized' then
      raise exception
        'upper_limb_motor_screen_session_results: row % is finalized and cannot be deleted', old.id;
    end if;
    return old;
  end if;

  if old.status = 'finalized' then
    raise exception
      'upper_limb_motor_screen_session_results: row % is finalized and immutable', old.id;
  end if;

  if new.id is distinct from old.id
     or new.assignment_id is distinct from old.assignment_id
     or new.provider_id is distinct from old.provider_id
     or new.patient_id is distinct from old.patient_id
     or new.created_at is distinct from old.created_at
  then
    raise exception
      'upper_limb_motor_screen_session_results: identity/ownership fields are immutable for row %', old.id;
  end if;

  if new.status = 'finalized' then
    submitted_payload := new.result_payload;

    if (submitted_payload - 'status') is distinct from (old.result_payload - 'status') then
      raise exception
        'upper_limb_motor_screen_session_results: cannot change result_payload content other than status while finalizing row %', old.id;
    end if;

    if new.overall_quality is distinct from old.overall_quality
       or new.protective_pause_count is distinct from old.protective_pause_count
       or new.protective_pause_duration_ms_total is distinct from old.protective_pause_duration_ms_total
       or new.schema_version is distinct from old.schema_version
    then
      raise exception
        'upper_limb_motor_screen_session_results: cannot change typed projection fields while finalizing row %', old.id;
    end if;

    new.result_payload := jsonb_set(old.result_payload, '{status}', to_jsonb('finalized'::text), true);
  end if;

  return new;
end;
$$;

drop trigger if exists upper_limb_motor_screen_session_results_immutability
  on public.upper_limb_motor_screen_session_results;
create trigger upper_limb_motor_screen_session_results_immutability
  before insert or update or delete on public.upper_limb_motor_screen_session_results
  for each row execute function public.enforce_ul_session_result_immutability();

grant select, insert, update, delete
  on public.upper_limb_motor_screen_session_results to service_role;

COMMIT;
