-- READ-ONLY rollback identification aid. This file intentionally performs no deletes.
-- A patient label/file number or manually pasted UUID is NOT transfer ownership.
-- Use the staging-guarded CLI with the original version 2 manifest:
--   node scripts/ops/judge-demo-patient-transfer.mjs --rollback --run-id UUID
-- It checks durable write intents, exact planned payloads, unrelated dependents,
-- every delete response, and final row absence before reporting success.
-- Production/unknown project refs are blocked in the CLI, without an override.
-- Keep the original manifest and export even when cleanup fails.
-- psql: \set dest_patient_id 'UUID-from-original-manifest'

select id, full_name, file_number, provider_id, created_at, updated_at
from public.patients
where id = :'dest_patient_id'::uuid;
