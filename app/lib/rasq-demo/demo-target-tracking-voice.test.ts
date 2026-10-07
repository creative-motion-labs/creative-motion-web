/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-target-tracking-voice.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEMO_TARGET_TRACKING_EPISODE_COOLDOWN_MS,
  createDemoTargetTrackingVoiceState,
  resolveDemoTargetTrackingVoiceCue,
} from "./demo-target-tracking-voice";

describe("demo target tracking voice", () => {
  it("plays lost then recovered once per episode", () => {
    let state = createDemoTargetTrackingVoiceState();
    const base = {
      activeTargetBlock: true,
      sessionActive: true,
      trackingStatus: "tracking" as const,
      hasWrist: true,
    };

    let step = resolveDemoTargetTrackingVoiceCue(state, { ...base, nowMs: 1000, trackingStatus: "lost", hasWrist: false });
    state = step.nextState;
    assert.equal(step.decision.play, "target-not-found");

    step = resolveDemoTargetTrackingVoiceCue(state, { ...base, nowMs: 1500, trackingStatus: "lost", hasWrist: false });
    state = step.nextState;
    assert.equal(step.decision.play, null);

    step = resolveDemoTargetTrackingVoiceCue(state, { ...base, nowMs: 2000, trackingStatus: "tracking", hasWrist: true });
    state = step.nextState;
    assert.equal(step.decision.play, "target-recovered");
  });

  it("respects cooldown before a new lost episode", () => {
    let state = createDemoTargetTrackingVoiceState();
    const lostInput = {
      nowMs: 1000,
      activeTargetBlock: true,
      sessionActive: true,
      trackingStatus: "lost" as const,
      hasWrist: false,
    };
    state = resolveDemoTargetTrackingVoiceCue(state, lostInput).nextState;
    state = resolveDemoTargetTrackingVoiceCue(state, {
      ...lostInput,
      nowMs: 2000,
      trackingStatus: "tracking",
      hasWrist: true,
    }).nextState;

    const recovered = resolveDemoTargetTrackingVoiceCue(state, {
      ...lostInput,
      nowMs: 2000,
      trackingStatus: "tracking",
      hasWrist: true,
    }).nextState;

    const withinCooldown = resolveDemoTargetTrackingVoiceCue(recovered, {
      ...lostInput,
      nowMs: 2000 + DEMO_TARGET_TRACKING_EPISODE_COOLDOWN_MS - 100,
    });
    assert.equal(withinCooldown.decision.play, null);

    const afterCooldown = resolveDemoTargetTrackingVoiceCue(recovered, {
      ...lostInput,
      nowMs: 2000 + DEMO_TARGET_TRACKING_EPISODE_COOLDOWN_MS + 100,
    });
    assert.equal(afterCooldown.decision.play, "target-not-found");
  });
});
