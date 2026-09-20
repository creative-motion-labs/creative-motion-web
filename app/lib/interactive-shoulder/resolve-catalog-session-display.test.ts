/**
 * Run: npx tsx --test app/lib/interactive-shoulder/resolve-catalog-session-display.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCatalogSessionDisplay } from "./resolve-catalog-session-display";

const SESSION_ID = "stroke-upper-limb-recovery-foundation-v1-session-1";
const ENGLISH_TITLE = "Session 1 — Activation and Functional Reaching";
const ENGLISH_GOAL = "Activation and Functional Reaching";

describe("resolveCatalogSessionDisplay", () => {
  it("returns Arabic session title and goal for Stroke ULRF session 1", () => {
    const display = resolveCatalogSessionDisplay("ar", SESSION_ID, ENGLISH_TITLE, ENGLISH_GOAL);
    assert.equal(display.title, "الجلسة 1 — التنشيط والوصول الوظيفي");
    assert.equal(display.goal, "التنشيط والوصول الوظيفي");
    assert.ok(!display.title.includes("Session 1"));
    assert.ok(!display.title.includes("Activation"));
    assert.ok(!display.goal?.includes("Activation"));
  });

  it("keeps English session title and goal unchanged", () => {
    const display = resolveCatalogSessionDisplay("en", SESSION_ID, ENGLISH_TITLE, ENGLISH_GOAL);
    assert.equal(display.title, ENGLISH_TITLE);
    assert.equal(display.goal, ENGLISH_GOAL);
  });

  it("resolves Arabic title when catalogSession.id is a database UUID", () => {
    const display = resolveCatalogSessionDisplay(
      "ar",
      "8f3c2a10-4b5d-4e6f-9a0b-1c2d3e4f5a6b",
      ENGLISH_TITLE,
      ENGLISH_GOAL,
    );
    assert.equal(display.title, "الجلسة 1 — التنشيط والوصول الوظيفي");
    assert.ok(!display.title.includes("Session 1"));
    assert.ok(!display.title.includes("Activation"));
  });

  it("falls back to provided title and goal for unknown catalog sessions", () => {
    const display = resolveCatalogSessionDisplay("ar", "unknown-session", "Custom title", "Custom goal");
    assert.equal(display.title, "Custom title");
    assert.equal(display.goal, "Custom goal");
  });
});
