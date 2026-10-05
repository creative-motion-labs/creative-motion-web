-- RASQ public /demo anonymous analytics — separate from rasq_demo_leads and clinical tables.
-- Writes via POST /api/public/rasq-demo/analytics (service_role only). No PII.

create table if not exists public.rasq_demo_analytics_events (
  id                  uuid        primary key default gen_random_uuid(),
  visitor_session_id  text        not null,
  attempt_id          text        not null,
  event_type          text        not null,
  camera_path         text        null,
  idempotency_key     text        not null,
  is_internal_test    boolean     not null default false,
  created_at          timestamptz not null default now(),

  constraint rasq_demo_analytics_event_type_chk
    check (event_type in (
      'demo_visit',
      'demo_started',
      'demo_completed',
      'follow_up_interested',
      'follow_up_not_interested',
      'follow_up_skipped'
    )),

  constraint rasq_demo_analytics_camera_path_chk
    check (camera_path is null or camera_path in ('camera', 'no_camera'))
);

create unique index if not exists rasq_demo_analytics_idempotency_key_uidx
  on public.rasq_demo_analytics_events (idempotency_key);

create index if not exists rasq_demo_analytics_created_at_idx
  on public.rasq_demo_analytics_events (created_at desc);

create index if not exists rasq_demo_analytics_attempt_id_idx
  on public.rasq_demo_analytics_events (attempt_id);

create index if not exists rasq_demo_analytics_event_type_idx
  on public.rasq_demo_analytics_events (event_type);

alter table public.rasq_demo_analytics_events enable row level security;
revoke all on public.rasq_demo_analytics_events from anon, authenticated;

-- Read-only funnel metrics for operators (service_role / SQL editor). Excludes internal test sessions.
create or replace view public.rasq_demo_analytics_funnel_report as
with events as (
  select *
  from public.rasq_demo_analytics_events
  where not is_internal_test
    and visitor_session_id not like 'rasq-demo-internal-test-%'
    and attempt_id not like 'rasq-demo-internal-test-%'
),
counts as (
  select
    count(*) filter (where event_type = 'demo_visit')::bigint as demo_visits,
    count(*) filter (where event_type = 'demo_started')::bigint as demo_starts,
    count(*) filter (where event_type = 'demo_completed')::bigint as demo_completions,
    count(*) filter (where event_type = 'follow_up_interested')::bigint as follow_up_interested,
    count(*) filter (where event_type = 'follow_up_not_interested')::bigint as follow_up_not_interested,
    count(*) filter (where event_type = 'follow_up_skipped')::bigint as follow_up_skipped
  from events
),
leads as (
  select count(*)::bigint as submitted_leads
  from public.rasq_demo_leads l
  where l.demo_session_id not like 'rasq-demo-internal-test-%'
)
select
  c.demo_visits,
  c.demo_starts,
  c.demo_completions,
  c.follow_up_interested,
  c.follow_up_not_interested,
  c.follow_up_skipped,
  l.submitted_leads,
  case
    when c.demo_starts > 0
    then round(c.demo_completions::numeric / c.demo_starts::numeric, 4)
    else null
  end as completion_rate,
  case
    when c.demo_completions > 0
    then round(c.follow_up_interested::numeric / c.demo_completions::numeric, 4)
    else null
  end as interest_rate
from counts c
cross join leads l;

comment on view public.rasq_demo_analytics_funnel_report is
  'Aggregate /demo funnel counts (visits and demo attempts, not verified unique people). Excludes rasq-demo-internal-test-* sessions.';

revoke all on public.rasq_demo_analytics_funnel_report from anon, authenticated;
