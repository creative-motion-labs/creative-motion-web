-- Public /signup provider access interest — no Supabase Auth user required.
-- Writes via POST /api/public/provider-access-interest (service_role only).

create table if not exists public.provider_access_interest (
  id          uuid        primary key default gen_random_uuid(),
  email       text        not null,
  full_name   text        null,
  clinic_name text        null,
  created_at  timestamptz not null default now(),

  constraint provider_access_interest_email_lowercase_chk
    check (email = lower(trim(email)))
);

create unique index if not exists provider_access_interest_email_uidx
  on public.provider_access_interest (email);

create index if not exists provider_access_interest_created_at_idx
  on public.provider_access_interest (created_at desc);

alter table public.provider_access_interest enable row level security;
revoke all on public.provider_access_interest from anon, authenticated;
