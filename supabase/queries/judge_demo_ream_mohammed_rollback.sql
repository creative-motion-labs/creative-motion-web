-- Rollback a judge-demo import using manifest patient id (destination UUID).
-- Run only on the environment where import occurred. Child tables before parent.
-- Set :dest_patient_id from manifest. Do not run on Production without explicit approval.

begin;

delete from public.upper_limb_motor_screen_session_results where patient_id = :dest_patient_id;
delete from public.upper_limb_motor_screen_assignments where patient_id = :dest_patient_id;
delete from public.interactive_shoulder_movement_outcomes where patient_id = :dest_patient_id;
delete from public.session_logs where patient_id = :dest_patient_id;
delete from public.plan_sessions where patient_id = :dest_patient_id;
delete from public.treatment_plans where patient_id = :dest_patient_id;
delete from public.assessments where patient_id = :dest_patient_id;
delete from public.remote_assessment_requests where patient_id = :dest_patient_id;
delete from public.ai_clinician_summaries where patient_id = :dest_patient_id;
delete from public.cv_session_metrics where patient_id = :dest_patient_id;
delete from public.speech_transcription_sessions where patient_id = :dest_patient_id;
delete from public.clinical_review_acknowledgments where patient_id = :dest_patient_id;
delete from public.patient_access_tokens where patient_id = :dest_patient_id;
delete from public.patients where id = :dest_patient_id;

-- commit; -- uncomment after manual review
