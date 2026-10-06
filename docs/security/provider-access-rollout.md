# Provider access control rollout (migration 028)

## Purpose

Separate **Supabase authentication** from **clinician authorization** during the RASQ pilot. New public registrations create a **pending access request** and do not receive clinician workspace access until founder/admin approval.

## Production order

1. Apply `supabase/migrations/028_provider_access_control.sql` on staging, verify.
2. Apply the same migration on production Supabase (`vdtjrdnzvhmxporihswv`).
3. Set `RASQ_PLATFORM_ADMIN_USER_IDS` on Vercel (comma-separated Supabase auth user UUIDs for founders).
4. Deploy frontend after migrations complete.

## Existing providers

The migration backfills **existing rows in `public.providers`** to `approval_status = 'approved'` with `approved_at` preserved from `created_at`. This grandfathers current clinical accounts that already have provider rows. It does **not** auto-approve Supabase Auth users without a provider row.

## Founder workflow

1. Sign in with an allowlisted admin UUID or an approved `providers.role = admin` account.
2. Open `/admin/access-requests`.
3. Approve / reject pending requests (self-approval is blocked server-side).

## Rollback

Revert the app deploy first. Dropping migration 028 columns/tables without a coordinated plan can strand pending requests; prefer forward-fix unless the release is fully rolled back before new signups occur.

## RLS notes

- `provider_access_requests`: authenticated users may **select** their own row only; writes are service-role/admin API only.
- `providers`: trigger blocks self-updates to `role`, `approval_status`, `approved_at`, and `approved_by`.
