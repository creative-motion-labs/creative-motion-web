-- Ledger-scoped rollback fallback (prefer: node scripts/ops/judge-demo-patient-transfer.mjs --rollback).
-- Deletes ONLY ids listed in manifest.insertedLedger for one transfer run — not all rows for the patient.
--
-- 1. Paste ids from manifest.insertedLedger into the arrays below (one run only).
-- 2. Confirm no extra rows exist for dest patient (script checks this before delete).
-- 3. Run in a transaction; ROLLBACK first if counts look wrong.
--
-- Example psql session id (dest patient from manifest.destPatientId):
--   \set dest_patient_id '00000000-0000-0000-0000-000000000000'

begin;

-- Replace each empty array with ledger ids for that table (uuid literals as text).
-- Order: children before parents (matches script rollback order).

delete from public.upper_limb_motor_screen_session_results
where id = any (array[]::uuid[]);

delete from public.upper_limb_motor_screen_assignments
where id = any (array[]::uuid[]);

delete from public.interactive_shoulder_movement_outcomes
where id = any (array[]::uuid[]);

delete from public.session_logs
where id = any (array[]::uuid[]);

delete from public.plan_sessions
where id = any (array[]::uuid[]);

delete from public.treatment_plans
where id = any (array[]::uuid[]);

delete from public.assessments
where id = any (array[]::uuid[]);

delete from public.remote_assessment_requests
where id = any (array[]::uuid[]);

delete from public.ai_clinician_summaries
where id = any (array[]::uuid[]);

delete from public.patients
where id = :'dest_patient_id'::uuid;

-- commit;
rollback;
