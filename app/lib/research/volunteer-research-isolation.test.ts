/**
 * Run: npx tsx --test app/lib/research/volunteer-research-isolation.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("volunteer research isolation", () => {
  it("migration 021 creates collection + movement tables only", () => {
    const sql = read("supabase/migrations/021_ml_research_volunteer_sessions.sql");
    assert.match(sql, /ml_research_volunteer_collection_sessions/);
    assert.match(sql, /ml_research_volunteer_movement_sessions/);
    assert.doesNotMatch(sql, /ml_research_volunteer_repetitions/);
    assert.doesNotMatch(sql, /references public\.patients/);
    assert.doesNotMatch(sql, /references public\.cv_session_metrics/);
    assert.doesNotMatch(sql, /references public\.assessments/);
  });

  it("migration 022 creates repetitions table with research-only FK", () => {
    const sql = read("supabase/migrations/022_ml_research_volunteer_repetitions.sql");
    assert.match(sql, /ml_research_volunteer_repetitions/);
    assert.match(sql, /references public\.ml_research_volunteer_movement_sessions/);
    assert.doesNotMatch(sql, /references public\.patients/);
    assert.doesNotMatch(sql, /references public\.cv_session_metrics/);
    assert.doesNotMatch(sql, /references public\.assessments/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /revoke all on public\.ml_research_volunteer_repetitions from anon/);
    assert.match(sql, /grant select, insert, update, delete on public\.ml_research_volunteer_repetitions/);
  });

  it("repetition modules do not reference clinical tables", () => {
    for (const file of [
      "app/lib/research/volunteer-repetition-store.ts",
      "app/lib/research/volunteer-repetition-validation.ts",
    ]) {
      const source = read(file);
      assert.doesNotMatch(source, /patients/);
      assert.doesNotMatch(source, /cv_session_metrics/);
      assert.doesNotMatch(source, /assessments/);
    }
  });

  it("volunteer UI wires to browser persistence client without server-only crypto imports", () => {
    const files = [
      "app/volunteer/shoulder-abduction-reach/page.tsx",
      "app/hooks/useVolunteerCaptureSession.ts",
      "app/hooks/useVolunteerResearchPersistence.ts",
      "app/volunteer/shoulder-abduction-reach/volunteer-browser-persistence-client.ts",
      "app/volunteer/shoulder-abduction-reach/volunteer-research-persistence-controller.ts",
    ];
    for (const file of files) {
      const content = read(file);
      assert.doesNotMatch(content, /from\s+["']node:crypto["']/);
      assert.doesNotMatch(content, /volunteer-session-store/);
      assert.doesNotMatch(content, /volunteer-repetition-store/);
    }
    const page = read("app/volunteer/shoulder-abduction-reach/page.tsx");
    assert.match(page, /useVolunteerResearchPersistence/);
    const client = read(
      "app/volunteer/shoulder-abduction-reach/volunteer-browser-persistence-client.ts",
    );
    assert.match(client, /\/api\/research\/volunteer\//);
  });
});
