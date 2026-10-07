-- ============================================================
-- Migration 024 — Upper-Limb Motor Screen assignment idempotency
--
-- Adds client-supplied idempotency keys to
-- upper_limb_motor_screen_assignments so network retries and
-- concurrent duplicate submissions replay the original row instead
-- of creating a second assignment.
--
-- Rollout: apply this migration before deploying API/UI code that
-- sends assignment_request_id. Legacy callers that omit the key
-- continue to use the direct-insert path inside the RPC (NULL key).
-- Do not apply to Staging/Production until the deployment window
-- is coordinated — this file is schema-only.
--
-- Pattern mirrors 018_create_plan_from_catalog_program.sql:
--   - scoped UNIQUE constraint + INSERT-only immutability trigger
--   - fast-path SELECT replay
--   - race-safe INSERT ... ON CONFLICT DO NOTHING RETURNING id
--   - payload hash comparison rejects key reuse with different body
--
-- Prerequisites:
--   - 019_upper_limb_motor_screen_persistence.sql
--   - 020_upper_limb_motor_screen_staging_compat.sql (if applied)
-- ============================================================

alter table public.upper_limb_motor_screen_assignments
  add column if not exists assignment_request_id uuid;

alter table public.upper_limb_motor_screen_assignments
  add column if not exists assignment_request_payload_hash text;

comment on column public.upper_limb_motor_screen_assignments.assignment_request_id is
  'Client-supplied idempotency key for one assignment POST. NULL for legacy rows '
  'and for callers that omit the key. INSERT-only — enforced by trigger below.';

comment on column public.upper_limb_motor_screen_assignments.assignment_request_payload_hash is
  'SHA-256 hex digest of the canonical allowlisted request snapshot at creation time. '
  'NULL when assignment_request_id is NULL. INSERT-only — enforced by trigger below.';

alter table public.upper_limb_motor_screen_assignments
  drop constraint if exists ulmsa_provider_assignment_request_id_key;

alter table public.upper_limb_motor_screen_assignments
  add constraint ulmsa_provider_assignment_request_id_key
    unique (provider_id, assignment_request_id);

create or replace function public.enforce_ulmsa_assignment_request_immutability()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.assignment_request_id is distinct from old.assignment_request_id
     or new.assignment_request_payload_hash is distinct from old.assignment_request_payload_hash then
    raise exception
      'upper_limb_motor_screen_assignments: assignment request idempotency fields are immutable for row %',
      old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists upper_limb_motor_screen_assignments_request_immutability
  on public.upper_limb_motor_screen_assignments;

create trigger upper_limb_motor_screen_assignments_request_immutability
  before update on public.upper_limb_motor_screen_assignments
  for each row execute function public.enforce_ulmsa_assignment_request_immutability();

-- ============================================================
-- RPC: create_upper_limb_motor_screen_assignment
--
-- Idempotency / concurrency design (same contract as migration 018):
--   1. When p_assignment_request_id IS NULL, performs a plain insert
--      (legacy compatibility — no idempotency guarantees).
--   2. Otherwise, fast-path SELECT by (provider_id, request_id).
--   3. Replay requires matching patient_id and payload hash.
--   4. Fresh path validates patient ownership, then INSERT with
--      ON CONFLICT (provider_id, assignment_request_id) DO NOTHING.
--   5. Race loser re-selects and verifies before returning replay.
--   6. Key reuse with different patient or payload raises one generic
--      conflict error — no disclosure of other rows.
-- ============================================================

create or replace function public.create_upper_limb_motor_screen_assignment(
  p_provider_id                     uuid,
  p_patient_id                      uuid,
  p_assignment_request_id           uuid,
  p_assignment_request_payload_hash text,
  p_assignment_id                   uuid,
  p_status                          text,
  p_assignment_payload              jsonb,
  p_schema_version                  text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_patient_provider_id uuid;
  v_existing            record;
  v_row_id              uuid;
  v_created             boolean;
begin
  if p_provider_id is null or p_patient_id is null or p_assignment_id is null then
    raise exception
      'create_upper_limb_motor_screen_assignment: provider, patient, and assignment identifiers are required';
  end if;

  if p_status is null or btrim(p_status) = '' then
    raise exception
      'create_upper_limb_motor_screen_assignment: status is required';
  end if;

  if p_assignment_payload is null or p_schema_version is null or btrim(p_schema_version) = '' then
    raise exception
      'create_upper_limb_motor_screen_assignment: assignment payload and schema version are required';
  end if;

  -- Legacy path: no idempotency key supplied.
  if p_assignment_request_id is null then
    select provider_id into v_patient_provider_id
      from public.patients
      where id = p_patient_id;

    if v_patient_provider_id is null or v_patient_provider_id <> p_provider_id then
      raise exception
        'create_upper_limb_motor_screen_assignment: patient/provider verification failed';
    end if;

    insert into public.upper_limb_motor_screen_assignments (
      id, provider_id, patient_id, status, assignment_payload, schema_version,
      assignment_request_id, assignment_request_payload_hash
    )
    values (
      p_assignment_id, p_provider_id, p_patient_id, p_status, p_assignment_payload, p_schema_version,
      null, null
    );

    return jsonb_build_object(
      'id', p_assignment_id,
      'created', true,
      'provider_id', p_provider_id,
      'patient_id', p_patient_id,
      'status', p_status,
      'assignment_payload', p_assignment_payload,
      'schema_version', p_schema_version,
      'created_at', (select created_at from public.upper_limb_motor_screen_assignments where id = p_assignment_id),
      'updated_at', (select updated_at from public.upper_limb_motor_screen_assignments where id = p_assignment_id)
    );
  end if;

  if p_assignment_request_payload_hash is null or btrim(p_assignment_request_payload_hash) = '' then
    raise exception
      'create_upper_limb_motor_screen_assignment: assignment_request_payload_hash is required when assignment_request_id is supplied';
  end if;

  -- Fast-path replay lookup.
  select id, provider_id, patient_id, status, assignment_payload, schema_version,
         assignment_request_payload_hash, created_at, updated_at
    into v_existing
    from public.upper_limb_motor_screen_assignments
    where provider_id = p_provider_id
      and assignment_request_id = p_assignment_request_id;

  if found then
    if v_existing.patient_id is distinct from p_patient_id
       or v_existing.assignment_request_payload_hash is distinct from p_assignment_request_payload_hash then
      raise exception
        'create_upper_limb_motor_screen_assignment: assignment_request_id was already used for a different assignment';
    end if;

    return jsonb_build_object(
      'id', v_existing.id,
      'created', false,
      'provider_id', v_existing.provider_id,
      'patient_id', v_existing.patient_id,
      'status', v_existing.status,
      'assignment_payload', v_existing.assignment_payload,
      'schema_version', v_existing.schema_version,
      'created_at', v_existing.created_at,
      'updated_at', v_existing.updated_at
    );
  end if;

  -- Fresh path with ownership validation.
  select provider_id into v_patient_provider_id
    from public.patients
    where id = p_patient_id;

  if v_patient_provider_id is null or v_patient_provider_id <> p_provider_id then
    raise exception
      'create_upper_limb_motor_screen_assignment: patient/provider verification failed';
  end if;

  insert into public.upper_limb_motor_screen_assignments (
    id, provider_id, patient_id, status, assignment_payload, schema_version,
    assignment_request_id, assignment_request_payload_hash
  )
  values (
    p_assignment_id, p_provider_id, p_patient_id, p_status, p_assignment_payload, p_schema_version,
    p_assignment_request_id, p_assignment_request_payload_hash
  )
  on conflict (provider_id, assignment_request_id) do nothing
  returning id into v_row_id;

  if v_row_id is not null then
    v_created := true;
  else
    select id, provider_id, patient_id, status, assignment_payload, schema_version,
           assignment_request_payload_hash, created_at, updated_at
      into v_existing
      from public.upper_limb_motor_screen_assignments
      where provider_id = p_provider_id
        and assignment_request_id = p_assignment_request_id;

    if not found then
      raise exception
        'create_upper_limb_motor_screen_assignment: assignment integrity error';
    end if;

    if v_existing.patient_id is distinct from p_patient_id
       or v_existing.assignment_request_payload_hash is distinct from p_assignment_request_payload_hash then
      raise exception
        'create_upper_limb_motor_screen_assignment: assignment_request_id was already used for a different assignment';
    end if;

    v_row_id := v_existing.id;
    v_created := false;
  end if;

  return jsonb_build_object(
    'id', v_row_id,
    'created', v_created,
    'provider_id', p_provider_id,
    'patient_id', p_patient_id,
    'status', p_status,
    'assignment_payload', (select assignment_payload from public.upper_limb_motor_screen_assignments where id = v_row_id),
    'schema_version', p_schema_version,
    'created_at', (select created_at from public.upper_limb_motor_screen_assignments where id = v_row_id),
    'updated_at', (select updated_at from public.upper_limb_motor_screen_assignments where id = v_row_id)
  );
end;
$$;

revoke all on function public.create_upper_limb_motor_screen_assignment(
  uuid, uuid, uuid, text, uuid, text, jsonb, text
) from public;

grant execute on function public.create_upper_limb_motor_screen_assignment(
  uuid, uuid, uuid, text, uuid, text, jsonb, text
) to service_role;
