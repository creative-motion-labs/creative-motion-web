-- ============================================================
-- Migration 023 — plan_sessions.prescribed_side (Clinical Slice C1)
--
-- Therapist-authored unilateral treatment side for a clinical plan
-- session. Nullable for legacy/non-unilateral sessions. No default.
--
-- Rolling deployment (application + migration):
--   - Preferred order: apply this migration before enabling side-aware UI.
--   - If application code arrives first, legacy plan creation without
--     prescribedSide continues to work (no column/RPC seventh arg used).
--   - Side-aware writes fail closed (HTTP 503) until this migration is
--     available; coordinate deploy before clinician side-selection UI.
--
-- Scope:
--   - Adds plan_sessions.prescribed_side with a check constraint
--   - Extends create_plan_from_catalog_program() with an optional
--     p_session_prescribed_sides jsonb argument applied atomically
--     on fresh catalog assignments only
--   - No RLS changes. No volunteer/research table changes.
-- ============================================================

alter table public.plan_sessions
  add column if not exists prescribed_side text;

comment on column public.plan_sessions.prescribed_side is
  'Therapist-authored unilateral treatment side (left/right) for this plan session. NULL means not yet explicitly prescribed — never a silent default to right.';

alter table public.plan_sessions
  drop constraint if exists plan_sessions_prescribed_side_chk;

alter table public.plan_sessions
  add constraint plan_sessions_prescribed_side_chk
  check (prescribed_side is null or prescribed_side in ('left', 'right'));

-- Applies validated session-level prescriptions inside the same
-- transaction as catalog plan creation. No-op on null/empty input.
create or replace function public.apply_plan_session_prescribed_sides(
  p_plan_id uuid,
  p_session_prescribed_sides jsonb
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_row record;
begin
  if p_plan_id is null then
    raise exception 'apply_plan_session_prescribed_sides: plan_id is required';
  end if;

  if p_session_prescribed_sides is null or jsonb_typeof(p_session_prescribed_sides) <> 'array' then
    return;
  end if;

  if jsonb_array_length(p_session_prescribed_sides) < 1 then
    return;
  end if;

  for v_row in
    select *
    from jsonb_to_recordset(p_session_prescribed_sides) as rx(
      "sessionNumber" integer,
      "prescribedSide" text
    )
  loop
    if v_row."sessionNumber" is null or v_row."sessionNumber" < 1 then
      raise exception
        'create_plan_from_catalog_program: session prescription sessionNumber must be a positive integer';
    end if;

    if v_row."prescribedSide" is null then
      continue;
    end if;

    if v_row."prescribedSide" not in ('left', 'right') then
      raise exception
        'create_plan_from_catalog_program: session prescription prescribedSide must be left or right';
    end if;

    update public.plan_sessions
      set prescribed_side = v_row."prescribedSide"
      where plan_id = p_plan_id
        and session_number = v_row."sessionNumber";

    if not found then
      raise exception
        'create_plan_from_catalog_program: session prescription references unknown session_number %',
        v_row."sessionNumber";
    end if;
  end loop;
end;
$$;

revoke all on function public.apply_plan_session_prescribed_sides(uuid, jsonb) from public;
revoke all on function public.apply_plan_session_prescribed_sides(uuid, jsonb) from anon;
revoke all on function public.apply_plan_session_prescribed_sides(uuid, jsonb) from authenticated;
grant execute on function public.apply_plan_session_prescribed_sides(uuid, jsonb) to service_role;

drop function if exists public.create_plan_from_catalog_program(uuid, uuid, uuid, uuid, uuid, text);

create or replace function public.create_plan_from_catalog_program(
  p_provider_id                   uuid,
  p_patient_id                    uuid,
  p_program_id                    uuid,
  p_assessment_id                 uuid,
  p_catalog_assignment_request_id uuid,
  p_patient_token                 text,
  p_session_prescribed_sides      jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_patient_provider_id uuid;
  v_patient_name        text;
  v_program_status      text;
  v_program_name        text;
  v_plan_id             uuid;
  v_created             boolean;
  v_existing            record;
  v_session_ids         uuid[];
  v_token               text;
  v_session_count       integer;
begin
  if p_provider_id is null or p_patient_id is null or p_program_id is null then
    raise exception
      'create_plan_from_catalog_program: provider, patient, and program identifiers are required';
  end if;

  if p_catalog_assignment_request_id is null then
    raise exception
      'create_plan_from_catalog_program: catalog_assignment_request_id is required';
  end if;

  if p_patient_token is null or btrim(p_patient_token) = '' then
    raise exception
      'create_plan_from_catalog_program: patient_token is required';
  end if;

  select id, provider_id, patient_id, source_treatment_program_id, assessment_id
    into v_existing
    from public.treatment_plans
    where catalog_assignment_request_id = p_catalog_assignment_request_id;

  if found then
    if v_existing.provider_id is distinct from p_provider_id
       or v_existing.patient_id is distinct from p_patient_id
       or v_existing.source_treatment_program_id is distinct from p_program_id
       or v_existing.assessment_id is distinct from p_assessment_id then
      raise exception
        'create_plan_from_catalog_program: catalog_assignment_request_id was already used for a different assignment';
    end if;

    v_plan_id := v_existing.id;
    v_created := false;
  else
    select provider_id, full_name into v_patient_provider_id, v_patient_name
      from public.patients
      where id = p_patient_id;

    if not found then
      raise exception
        'create_plan_from_catalog_program: patient/provider verification failed';
    end if;

    if v_patient_provider_id is null or v_patient_provider_id <> p_provider_id then
      raise exception
        'create_plan_from_catalog_program: patient/provider verification failed';
    end if;

    if p_assessment_id is not null then
      if not exists (
        select 1 from public.assessments
        where id = p_assessment_id and patient_id = p_patient_id
      ) then
        raise exception
          'create_plan_from_catalog_program: assessment verification failed';
      end if;
    end if;

    select status, name into v_program_status, v_program_name
      from public.treatment_programs
      where id = p_program_id;

    if v_program_status is null or v_program_status <> 'published' then
      raise exception
        'create_plan_from_catalog_program: source treatment program is not eligible for assignment';
    end if;

    insert into public.treatment_plans (
      provider_id, patient_id, assessment_id, title, status,
      total_weeks, current_week, structured_data,
      source_treatment_program_id, catalog_assignment_request_id
    )
    values (
      p_provider_id, p_patient_id, p_assessment_id, v_program_name, 'active',
      1, 1, null,
      p_program_id, p_catalog_assignment_request_id
    )
    on conflict (catalog_assignment_request_id) do nothing
    returning id into v_plan_id;

    if v_plan_id is null then
      select id, provider_id, patient_id, source_treatment_program_id, assessment_id
        into v_existing
        from public.treatment_plans
        where catalog_assignment_request_id = p_catalog_assignment_request_id;

      if not found then
        raise exception
          'create_plan_from_catalog_program: catalog assignment integrity error -- conflict without a resolvable row';
      end if;

      if v_existing.provider_id is distinct from p_provider_id
         or v_existing.patient_id is distinct from p_patient_id
         or v_existing.source_treatment_program_id is distinct from p_program_id
         or v_existing.assessment_id is distinct from p_assessment_id then
        raise exception
          'create_plan_from_catalog_program: catalog_assignment_request_id was already used for a different assignment';
      end if;

      v_plan_id := v_existing.id;
      v_created := false;
    else
      v_created := true;

      insert into public.plan_sessions (
        plan_id, provider_id, patient_id, session_number, title,
        exercises, status, source_program_session_id
      )
      select
        v_plan_id, p_provider_id, p_patient_id, ps.session_number, ps.title,
        '[]'::jsonb, 'upcoming', ps.id
      from public.program_sessions ps
      where ps.treatment_program_id = p_program_id
      order by ps.session_number;

      get diagnostics v_session_count = row_count;
      if v_session_count < 1 then
        raise exception
          'create_plan_from_catalog_program: catalog assignment integrity error -- source program has no sessions';
      end if;

      perform public.apply_plan_session_prescribed_sides(v_plan_id, p_session_prescribed_sides);

      insert into public.patient_access_tokens (
        provider_id, patient_id, patient_name, plan_id, token, expires_at
      )
      values (
        p_provider_id, p_patient_id, v_patient_name, v_plan_id,
        p_patient_token, now() + interval '365 days'
      );
    end if;
  end if;

  select array_agg(id order by session_number) into v_session_ids
    from public.plan_sessions
    where plan_id = v_plan_id
      and source_program_session_id is not null;

  if v_session_ids is null or array_length(v_session_ids, 1) is null then
    raise exception
      'create_plan_from_catalog_program: catalog assignment integrity error -- no sourced sessions found';
  end if;

  select token into strict v_token
    from public.patient_access_tokens
    where plan_id = v_plan_id;

  return jsonb_build_object(
    'planId', v_plan_id,
    'sessionIds', to_jsonb(v_session_ids),
    'patientToken', v_token,
    'created', v_created
  );
end;
$$;

revoke all on function public.create_plan_from_catalog_program(uuid, uuid, uuid, uuid, uuid, text, jsonb) from public;
revoke all on function public.create_plan_from_catalog_program(uuid, uuid, uuid, uuid, uuid, text, jsonb) from anon;
revoke all on function public.create_plan_from_catalog_program(uuid, uuid, uuid, uuid, uuid, text, jsonb) from authenticated;
grant execute on function public.create_plan_from_catalog_program(uuid, uuid, uuid, uuid, uuid, text, jsonb) to service_role;
