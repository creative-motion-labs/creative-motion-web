/**
 * Run: npx tsx --test app/lib/interactive-shoulder/interactive-shoulder-sounds.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInteractiveShoulderSoundPlayer } from "./interactive-shoulder-sounds";

describe("createInteractiveShoulderSoundPlayer", () => {
  it("tracks mute state and toggles without throwing", () => {
    const player = createInteractiveShoulderSoundPlayer(true);
    assert.equal(player.isMuted(), false);
    assert.equal(player.toggleMuted(), true);
    assert.equal(player.isMuted(), true);
    player.setMuted(false);
    assert.equal(player.isMuted(), false);
    player.play("countdown");
    player.play("sessionComplete");
  });

  it("does not throw when reduced motion is enabled", () => {
    const player = createInteractiveShoulderSoundPlayer(true);
    player.play("targetHit");
    player.play("blockComplete");
  });
});
