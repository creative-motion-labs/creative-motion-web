/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-leads-migration-version.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");

describe("rasq demo leads migration version", () => {
  it("uses 026_rasq_demo_leads.sql and no duplicate 024 demo migration", () => {
    assert.ok(existsSync(join(MIGRATIONS, "026_rasq_demo_leads.sql")));
    assert.equal(existsSync(join(MIGRATIONS, "024_rasq_demo_leads.sql")), false);
    assert.ok(existsSync(join(MIGRATIONS, "024_upper_limb_motor_screen_assignment_idempotency.sql")));

    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
    const versionCounts = new Map<string, number>();
    for (const file of files) {
      const version = file.slice(0, 3);
      versionCounts.set(version, (versionCounts.get(version) ?? 0) + 1);
    }
    for (const [version, count] of versionCounts) {
      assert.equal(count, 1, `duplicate migration version ${version}`);
    }
  });
});
