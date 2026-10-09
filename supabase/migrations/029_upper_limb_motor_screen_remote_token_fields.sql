-- ============================================================
-- Migration 029 — canonical remote token fields on clean 019 ULMS
--
-- Staging gained delivery_mode / token_hash / token_expires_at from a
-- pre-019 legacy table; migration 020 only relaxes NOT NULL on columns
-- that already exist. Clean 019 installs (including production) need
-- these columns added explicitly so POST
-- /api/upper-limb-motor-screen/remote-links and
-- fetchRemoteUlmsAssignmentByToken() can persist and resolve links.
--
-- Additive only: no drops, no row updates, no RLS/trigger changes.
-- Compatible with 019, 024 idempotency RPC, and existing assignment rows.
-- ============================================================

alter table public.upper_limb_motor_screen_assignments
  add column if not exists delivery_mode text,
  add column if not exists token_hash text,
  add column if not exists token_expires_at timestamptz;

comment on column public.upper_limb_motor_screen_assignments.delivery_mode is
  'Optional delivery channel for the assignment (e.g. remote_supervised). NULL for in-clinic-only rows.';

comment on column public.upper_limb_motor_screen_assignments.token_hash is
  'Hashed remote assessment token for patient link lookup. NULL until a remote link is issued.';

comment on column public.upper_limb_motor_screen_assignments.token_expires_at is
  'Expiry for token_hash-based remote links. NULL when no active remote token.';

-- One active remote token hash per row; multiple NULLs allowed.
create unique index if not exists upper_limb_motor_screen_assignments_token_hash_key
  on public.upper_limb_motor_screen_assignments (token_hash)
  where token_hash is not null;

-- Supports fetchRemoteUlmsAssignmentByToken: eq(token_hash) + gt(token_expires_at).
create index if not exists upper_limb_motor_screen_assignments_token_hash_expires_idx
  on public.upper_limb_motor_screen_assignments (token_hash, token_expires_at)
  where token_hash is not null;
