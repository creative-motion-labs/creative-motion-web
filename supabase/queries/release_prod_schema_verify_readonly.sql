-- READ-ONLY production schema verification for test → main release.
-- Run in Supabase SQL Editor on the **production** project bound to creative-motion-web.
-- Do not INSERT/UPDATE/DELETE. Review results only.

-- 1) Demo (minimum for /demo leads + analytics at 9711cc2)
select 'rasq_demo_leads' as object,
       to_regclass('public.rasq_demo_leads') is not null as present;

select 'rasq_demo_analytics_events' as object,
       to_regclass('public.rasq_demo_analytics_events') is not null as present;

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'rasq_demo_leads'
  and column_name in (
    'confirmation_email_sent_at',
    'confirmation_email_last_error'
  )
order by column_name;

-- 2) Clinician / ULMS (019, 020, 024)
select 'upper_limb_motor_screen_assignments' as object,
       to_regclass('public.upper_limb_motor_screen_assignments') is not null as present;

select 'upper_limb_motor_screen_session_results' as object,
       to_regclass('public.upper_limb_motor_screen_session_results') is not null as present;

-- 3) Plan prescribed side (023)
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'plan_sessions'
  and column_name = 'prescribed_side';

select proname
from pg_proc
join pg_namespace n on n.oid = pg_proc.pronamespace
where n.nspname = 'public'
  and proname in (
    'apply_plan_session_prescribed_sides',
    'create_plan_from_catalog_program'
  )
order by proname;

-- 4) Interactive shoulder outcomes (025)
select 'interactive_shoulder_movement_outcomes' as object,
       to_regclass('public.interactive_shoulder_movement_outcomes') is not null as present;

-- 5) ML volunteer research (021, 022) — only if those routes are in scope
select 'ml_research_volunteer_sessions' as object,
       to_regclass('public.ml_research_volunteer_sessions') is not null as present;

select 'ml_research_volunteer_repetitions' as object,
       to_regclass('public.ml_research_volunteer_repetitions') is not null as present;

-- 6) RLS enabled (expect true; app uses service_role for demo writes)
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'rasq_demo_leads',
    'rasq_demo_analytics_events',
    'upper_limb_motor_screen_assignments',
    'upper_limb_motor_screen_session_results',
    'interactive_shoulder_movement_outcomes'
  )
order by c.relname;
