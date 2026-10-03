/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-side-view-setup-voice.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resetBoothVoiceAudioPlaybackForTests } from "@/app/lib/booth/booth-voice-audio";
import { resetBoothVoiceGuidance } from "@/app/lib/booth/booth-voice-guidance";
import {
  beginBatteryCountdown,
  buildRepTestResult,
  completeBatteryTest,
  completeSideReposition,
  createBatteryOrchestratorState,
  getActiveBatteryTestId,
  retryCurrentBatteryTest,
  startBatteryAssessment,
} from "./battery-orchestrator";
import {
  resetSideViewSetupCueSpokenForNewTest,
  shouldSpeakSideViewSetupInPositioning,
  sideViewSetupSpeechScope,
} from "./battery-setup-voice-flow";
import { getTestSetupInstruction } from "./battery-patient-copy";
import { getBatterySideViewSetupCopy } from "./battery-voice-copy";
import { resetBatterySpeech, speakBatteryCue, setBatterySpeechLang } from "./battery-speech";

const SESSION = join(process.cwd(), "app/components/patient/RemoteUpperLimbBatterySession.tsx");

function withFakeBoothAudio(run: (playedSrcs: string[]) => void): void {
  const playedSrcs: string[] = [];
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousAudio = (globalThis as { Audio?: unknown }).Audio;

  class FakeAudio {
    src = "";
    preload = "";
    currentTime = 0;
    constructor(src?: string) {
      if (src) this.src = src;
    }
    play() {
      playedSrcs.push(this.src);
      return Promise.resolve();
    }
    pause() {}
  }

  (globalThis as { Audio: unknown }).Audio = FakeAudio;
  (globalThis as { window: unknown }).window = {};

  try {
    run(playedSrcs);
  } finally {
    if (previousAudio === undefined) {
      delete (globalThis as { Audio?: unknown }).Audio;
    } else {
      (globalThis as { Audio: unknown }).Audio = previousAudio;
    }
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: unknown }).window = previousWindow;
    }
    resetBoothVoiceAudioPlaybackForTests();
  }
}

describe("battery side-view setup voice", () => {
  const sideTests = ["shoulderFlexion", "elbowFlexion", "functionalReach"] as const;

  it("plays side-view-setup once per side test during positioning", () => {
    for (const testId of sideTests) {
      let spoken = resetSideViewSetupCueSpokenForNewTest();
      assert.equal(
        shouldSpeakSideViewSetupInPositioning("positioning", testId, spoken),
        true,
      );
      spoken = true;
      assert.equal(
        shouldSpeakSideViewSetupInPositioning("positioning", testId, spoken),
        false,
      );
      assert.equal(shouldSpeakSideViewSetupInPositioning("countdown", testId, false), false);
    }
  });

  it("allows side-view-setup after reposition cues without marking setup spoken", () => {
    let repositionSpoken = false;
    let sideViewSetupSpoken = false;

    if (!repositionSpoken) {
      repositionSpoken = true;
    }

    let state = startBatteryAssessment(createBatteryOrchestratorState());
    state = completeBatteryTest(
      { ...state, phase: "test_completed", repsCompleted: 3 },
      buildRepTestResult({
        testId: "shoulderAbduction",
        repsCompleted: 3,
        repsRequired: 3,
        peakAnglesDeg: [80],
        trackingQuality: "good",
      }),
    );
    assert.equal(state.phase, "reposition_side");
    sideViewSetupSpoken = resetSideViewSetupCueSpokenForNewTest();

    state = completeSideReposition(state);
    assert.equal(state.phase, "positioning");
    assert.equal(getActiveBatteryTestId(state), "shoulderFlexion");

    assert.equal(
      shouldSpeakSideViewSetupInPositioning(
        state.phase,
        getActiveBatteryTestId(state),
        sideViewSetupSpoken,
      ),
      true,
    );
  });

  it("plays side-view-setup before countdown and test_active", () => {
    let state = startBatteryAssessment(createBatteryOrchestratorState());
    state = completeBatteryTest(
      { ...state, phase: "test_completed", repsCompleted: 3 },
      buildRepTestResult({
        testId: "shoulderAbduction",
        repsCompleted: 3,
        repsRequired: 3,
        peakAnglesDeg: [80],
        trackingQuality: "good",
      }),
    );
    state = completeSideReposition(state);
    assert.equal(state.phase, "positioning");
    assert.equal(
      shouldSpeakSideViewSetupInPositioning(
        state.phase,
        getActiveBatteryTestId(state),
        false,
      ),
      true,
    );
    const countdown = beginBatteryCountdown(state, 3);
    assert.equal(countdown.phase, "countdown");
    assert.equal(
      shouldSpeakSideViewSetupInPositioning(
        countdown.phase,
        getActiveBatteryTestId(countdown),
        true,
      ),
      false,
    );
  });

  it("resets side-view-setup on retry so the cue can play again", () => {
    let state = startBatteryAssessment(createBatteryOrchestratorState());
    state = completeSideReposition(
      completeBatteryTest(
        { ...state, phase: "test_completed", repsCompleted: 3 },
        buildRepTestResult({
          testId: "shoulderAbduction",
          repsCompleted: 3,
          repsRequired: 3,
          peakAnglesDeg: [80],
          trackingQuality: "good",
        }),
      ),
    );
    let sideViewSetupSpoken = true;
    state = retryCurrentBatteryTest(state);
    assert.equal(state.phase, "positioning");
    sideViewSetupSpoken = resetSideViewSetupCueSpokenForNewTest();
    assert.equal(
      shouldSpeakSideViewSetupInPositioning(
        state.phase,
        getActiveBatteryTestId(state),
        sideViewSetupSpoken,
      ),
      true,
    );
  });

  it("plays side-view-setup after reposition-side despite booth cooldown", () => {
    setBatterySpeechLang("en");
    withFakeBoothAudio((played) => {
      resetBoothVoiceGuidance();
      resetBatterySpeech();
      speakBatteryCue("reposition-side", "right", "reposition");
      speakBatteryCue("side-view-setup", "right", sideViewSetupSpeechScope("shoulderFlexion"));
      assert.equal(played.length, 2);
      assert.match(played[1] ?? "", /battery-reposition-right-en\.mp3\?v=/);
    });
  });

  it("deduplicates the same side-view-setup scope within one positioning phase", () => {
    setBatterySpeechLang("en");
    withFakeBoothAudio((played) => {
      resetBoothVoiceGuidance();
      resetBatterySpeech();
      const scope = sideViewSetupSpeechScope("elbowFlexion");
      speakBatteryCue("side-view-setup", "right", scope);
      speakBatteryCue("side-view-setup", "right", scope);
      assert.equal(played.length, 1);
    });
  });

  it("keeps movement-start separate from side-view-setup scopes", () => {
    const source = readFileSync(SESSION, "utf8");
    assert.match(source, /resolveBatteryTestStartSpeechCue/);
    assert.match(source, /if \(!testStartCueSpokenRef\.current\)/);
    assert.match(source, /sideViewSetupSpeechScope/);
    assert.match(source, /if \(orchestrator\.phase !== "test_active"\) return;/);
    assert.equal(source.includes("movement-smooth-comfort"), false);
    assert.doesNotMatch(
      source,
      /reposition_side[\s\S]{0,400}sideViewSetupCueSpokenRef\.current = true/,
    );
  });

  it("shows side-view setup copy on screen during positioning for side tests", () => {
    const voice = getBatterySideViewSetupCopy("right", "en");
    assert.match(voice, /Turn sideways/i);
    for (const testId of sideTests) {
      assert.equal(getTestSetupInstruction(testId, "right", "en"), voice);
    }
    const source = readFileSync(SESSION, "utf8");
    const positioningBlock = source.slice(
      source.indexOf('if (orchestrator.phase === "positioning")'),
      source.indexOf('if (orchestrator.phase === "countdown"'),
    );
    assert.match(positioningBlock, /getTestSetupInstruction\(activeTestId/);
    assert.ok(
      positioningBlock.indexOf("getTestSetupInstruction") <
        positioningBlock.indexOf("getHoldStillStatus"),
    );
  });
});
