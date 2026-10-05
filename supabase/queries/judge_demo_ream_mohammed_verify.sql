-- Verify judge demo import for patient labeled "Demo — Ream Mohammed"
-- Set dest patient UUID from transfer manifest (do not commit manifest to git).
-- Example: \set dest_patient_id '00000000-0000-0000-0000-000000000000'

-- Patient label
select id, full_name, file_number, provider_id, created_at
from public.patients
where id = :dest_patient_id;

-- Counts (compare to staging inventory in docs/operations/judge-demo-ream-mohammed-transfer.md)
select 'assessments' as tbl, count(*)::bigint as n from public.assessments where patient_id = :dest_patient_id
union all select 'treatment_plans', count(*) from public.treatment_plans where patient_id = :dest_patient_id
union all select 'plan_sessions', count(*) from public.plan_sessions where patient_id = :dest_patient_id
union all select 'session_logs', count(*) from public.session_logs where patient_id = :dest_patient_id
union all select 'interactive_shoulder_movement_outcomes', count(*) from public.interactive_shoulder_movement_outcomes where patient_id = :dest_patient_id
union all select 'upper_limb_motor_screen_assignments', count(*) from public.upper_limb_motor_screen_assignments where patient_id = :dest_patient_id
union all select 'upper_limb_motor_screen_session_results', count(*) from public.upper_limb_motor_screen_session_results where patient_id = :dest_patient_id
union all select 'remote_assessment_requests', count(*) from public.remote_assessment_requests where patient_id = :dest_patient_id;
