/**
 * Run: npx tsx --test app/lib/clinical/clinical-prescribed-side-migration.contract.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";

const MIGRATION = readFileSync(
  path.resolve(import.meta.dirname, "../../../supabase/migrations/023_plan_sessions_prescribed_side.sql"),
  "utf8",
);

describe("migration 023 prescribed-side contract", () => {
  it("13. drops the legacy six-argument RPC before creating the seven-argument function", () => {
    const dropIndex = MIGRATION.indexOf(
      "drop function if exists public.create_plan_from_catalog_program(uuid, uuid, uuid, uuid, uuid, text);",
    );
    const createIndex = MIGRATION.indexOf(
      "create or replace function public.create_plan_from_catalog_program(",
    );
    assert.ok(dropIndex >= 0);
    assert.ok(createIndex > dropIndex);
  });

  it("13. keeps the seventh RPC argument default null for legacy callers", () => {
    assert.match(MIGRATION, /p_session_prescribed_sides\s+jsonb default null/);
  });

  it("13. keeps nullable prescribed_side with no default and a deterministic check constraint", () => {
    assert.match(MIGRATION, /add column if not exists prescribed_side text;/);
    assert.doesNotMatch(
      MIGRATION,
      /add column if not exists prescribed_side text[^;]*default/i,
    );
    assert.match(MIGRATION, /plan_sessions_prescribed_side_chk/);
    assert.match(MIGRATION, /check \(prescribed_side is null or prescribed_side in \('left', 'right'\)\)/);
  });

  it("13. keeps SECURITY INVOKER, pinned search_path, and service_role-only EXECUTE", () => {
    assert.match(MIGRATION, /security invoker[\s\S]*set search_path = pg_catalog, public/);
    assert.match(
      MIGRATION,
      /revoke all on function public\.apply_plan_session_prescribed_sides\(uuid, jsonb\) from public;/,
    );
    assert.match(
      MIGRATION,
      /revoke all on function public\.apply_plan_session_prescribed_sides\(uuid, jsonb\) from authenticated;/,
    );
    assert.match(
      MIGRATION,
      /grant execute on function public\.apply_plan_session_prescribed_sides\(uuid, jsonb\) to service_role;/,
    );
    assert.match(
      MIGRATION,
      /grant execute on function public\.create_plan_from_catalog_program\(uuid, uuid, uuid, uuid, uuid, text, jsonb\) to service_role;/,
    );
  });

  it("documents migration-first rollout with legacy no-side compatibility", () => {
    assert.match(MIGRATION, /Preferred order: apply this migration before enabling side-aware UI/i);
    assert.match(MIGRATION, /fail closed \(HTTP 503\)/i);
  });
});
