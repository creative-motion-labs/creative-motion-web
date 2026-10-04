/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/movement-focus-anatomy-workspace.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  MOVEMENT_FOCUS_ANATOMY_SRC,
  MOVEMENT_FOCUS_WORKSPACE_ILLUSTRATION_MIN_CLASS,
} from "@/app/components/patient/remote-upper-limb-battery/MovementFocusAnatomyCard";

const CARD = join(
  process.cwd(),
  "app/components/patient/remote-upper-limb-battery/MovementFocusAnatomyCard.tsx",
);

describe("movement focus anatomy workspace layout", () => {
  it("uses the committed PNG path and a non-zero workspace illustration container", () => {
    const source = readFileSync(CARD, "utf8");
    assert.equal(MOVEMENT_FOCUS_ANATOMY_SRC, "/images/rasq/upper-limb-muscle-focus.png");
    assert.match(source, new RegExp(`src=\\{MOVEMENT_FOCUS_ANATOMY_SRC\\}`));

    const workspaceBlockStart = source.indexOf("if (workspaceAligned && !compact)");
    assert.ok(workspaceBlockStart >= 0, "expected workspaceAligned illustration branch");
    const workspaceBlock = source.slice(workspaceBlockStart, workspaceBlockStart + 900);

    assert.match(workspaceBlock, /data-testid="movement-focus-workspace-illustration"/);
    assert.match(workspaceBlock, /relative w-full flex-1/);
    assert.match(workspaceBlock, /\$\{MOVEMENT_FOCUS_WORKSPACE_ILLUSTRATION_MIN_CLASS\}/);
    assert.match(MOVEMENT_FOCUS_WORKSPACE_ILLUSTRATION_MIN_CLASS, /min-h-\[200px\]/);
    assert.match(MOVEMENT_FOCUS_WORKSPACE_ILLUSTRATION_MIN_CLASS, /sm:min-h-\[240px\]/);
    assert.match(workspaceBlock, /absolute inset-0 h-full w-full object-contain/);
    assert.match(workspaceBlock, /scaleX\(-1\)/);
    assert.equal(
      workspaceBlock.includes("flex min-h-0 w-full flex-1 items-center justify-center"),
      false,
      "removed collapsed flex-only workspace wrapper",
    );
  });

  it("stacks illustration slot as a column when workspaceAligned", () => {
    const source = readFileSync(CARD, "utf8");
    assert.match(source, /workspaceAligned\s*\?\s*"mt-2 flex min-h-0 flex-1 flex-col overflow-hidden"/);
  });
});
