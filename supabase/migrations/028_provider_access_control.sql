-- ============================================================
-- Migration 028 — Provider access control (pilot approval)
-- Purpose: separate Supabase authentication from clinician authorization.
-- Rollout: apply in Supabase BEFORE deploying app code that enforces approval.
-- Rollback: drop new objects/columns only after reverting app; existing rows
--           retain clinical data; re-adding column without backfill would default
--           new inserts to pending.
-- ============================================================

-- ── Access requests (public registration intent) ─────────────────────────────

create table if not exists public.provider_access_requests (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null references auth.users (id) on delete cascade,
  email         text not null,
  full_name     text not null,
  clinic_name   text,
  status        text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'revoked')),
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewed_by   uuid references auth.users (id) on delete set null,
  constraint provider_access_requests_auth_user_id_key unique (auth_user_id)
);

create index if not exists provider_access_requests_status_created_idx
  on public.provider_access_requests (status, created_at desc);

alter table public.provider_access_requests enable row level security;

-- Authenticated users may read their own request row only (status visibility).
drop policy if exists "provider_access_requests: select own" on public.provider_access_requests;
create policy "provider_access_requests: select own"
  on public.provider_access_requests
  for select
  using (auth_user_id = auth.uid());

-- No insert/update/delete for authenticated clients — service role / admin API only.

revoke all on public.provider_access_requests from anon;
grant select on public.provider_access_requests to authenticated;

-- ── Provider approval columns ────────────────────────────────────────────────

alter table public.providers
  add column if not exists approval_status text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users (id) on delete set null;

-- Legacy rows are NOT auto-approved: public signup previously created provider rows
-- without founder review. Default unset rows to pending for manual founder approval.
update public.providers
set approval_status = coalesce(approval_status, 'pending')
where approval_status is null;

alter table public.providers
  alter column approval_status set default 'pending',
  alter column approval_status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'providers_approval_status_check'
  ) then
    alter table public.providers
      add constraint providers_approval_status_check
      check (approval_status in ('pending', 'approved', 'rejected', 'revoked'));
  end if;
end $$;

-- Prevent self-service privilege changes (service role / triggers bypass via auth.uid() null).
create or replace function public.providers_block_self_privilege_escalation()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and auth.uid() = old.id then
    if new.approval_status is distinct from old.approval_status
       or new.approved_at is distinct from old.approved_at
       or new.approved_by is distinct from old.approved_by
       or new.role is distinct from old.role then
      raise exception 'provider_privilege_change_forbidden' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists providers_block_self_privilege_escalation on public.providers;
create trigger providers_block_self_privilege_escalation
  before update on public.providers
  for each row execute function public.providers_block_self_privilege_escalation();
