-- RASQ public /demo optional leads — separate from clinical tables.
-- Writes via POST /api/public/rasq-demo/leads (service_role only).

create table if not exists public.rasq_demo_leads (
  id                      uuid        primary key default gen_random_uuid(),
  demo_session_id         text        not null,
  name                    text        null,
  email                   text        null,
  phone                   text        null,
  main_goal               text        null,
  consent_rasq_updates    boolean     not null default false,
  consent_pilot_study     boolean     not null default false,
  movement_summary        jsonb       null,
  confirmation_email_sent_at timestamptz null,
  confirmation_email_last_error text null,
  created_at              timestamptz not null default now(),

  constraint rasq_demo_leads_main_goal_chk
    check (main_goal is null or main_goal in ('sports', 'mobility', 'rehabilitation'))
);

create unique index if not exists rasq_demo_leads_demo_session_id_uidx
  on public.rasq_demo_leads (demo_session_id);

create index if not exists rasq_demo_leads_created_at_idx
  on public.rasq_demo_leads (created_at desc);

alter table public.rasq_demo_leads enable row level security;
revoke all on public.rasq_demo_leads from anon, authenticated;
