-- RASQ public /demo funnel (read-only). Counts are visits and demo attempts, not verified unique people.
-- Requires migration 027. Run with service_role or in Supabase SQL editor.

select * from public.rasq_demo_analytics_funnel_report;
