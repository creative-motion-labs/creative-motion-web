-- Verify a judge-demo clone patient (after import manifest is available locally).
-- psql: set UUID with quotes, then cast on use (avoids broken bare :variable quoting).
--
--   \set dest_patient_id '00000000-0000-0000-0000-000000000000'
--
-- Patient label
select id, full_name, file_number, provider_id, created_at
from public.patients
where id = :'dest_patient_id'::uuid;

-- Counts only. The CLI additionally verifies measured values/dates and source integrity.
-- Compare to manifest.expectedCounts for that transfer run.
select 'assessments' as tbl, count(*)::bigint as n
from public.assessments where patient_id = :'dest_patient_id'::uuid
union all
select 'treatment_plans', count(*) from public.treatment_plans where patient_id = :'dest_patient_id'::uuid
union all
select 'plan_sessions', count(*) from public.plan_sessions where patient_id = :'dest_patient_id'::uuid
union all
select 'session_logs', count(*) from public.session_logs where patient_id = :'dest_patient_id'::uuid
union all
select 'interactive_shoulder_movement_outcomes', count(*)
from public.interactive_shoulder_movement_outcomes where patient_id = :'dest_patient_id'::uuid
union all
select 'upper_limb_motor_screen_assignments', count(*)
from public.upper_limb_motor_screen_assignments where patient_id = :'dest_patient_id'::uuid
union all
select 'upper_limb_motor_screen_session_results', count(*)
from public.upper_limb_motor_screen_session_results r
join public.upper_limb_motor_screen_assignments a on a.id = r.assignment_id
where a.patient_id = :'dest_patient_id'::uuid
union all
select 'remote_assessment_requests', count(*)
from public.remote_assessment_requests where patient_id = :'dest_patient_id'::uuid
union all
select 'ai_clinician_summaries', count(*)
from public.ai_clinician_summaries where patient_id = :'dest_patient_id'::uuid;
