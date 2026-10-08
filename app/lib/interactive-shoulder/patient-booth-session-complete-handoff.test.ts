/**
 * Run: npx tsx --test app/lib/interactive-shoulder/patient-booth-session-complete-handoff.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDetachedBoothVoicePlaybackActive,
  resetBoothVoiceAudioPlaybackForTests,
} from "@/app/lib/booth/booth-voice-audio";
import { resetBoothVoiceGuidance } from "@/app/lib/booth/booth-voice-guidance";
import type { InteractiveShoulderSessionCompletionSnapshot } from "@/app/lib/interactive-shoulder/orchestrator-cv-session-types";
import {
  createPatientBoothVoiceSessionState,
  patientBoothVoiceOnSessionComplete,
} from "@/app/lib/interactive-shoulder/patient-booth-voice-runtime";
import { invokePatientBoothSessionCompleteHandoff } from "./patient-booth-session-complete-handoff";

const SNAPSHOT: InteractiveShoulderSessionCompletionSnapshot = {
  sessionState: "completed",
  sessionElapsedSeconds: 120,
  accumulatedBlockResults: [],
};

function withMockAudio(run: () => void, AudioImpl: typeof Audio): void {
  const previous = (globalThis as { Audio?: typeof Audio }).Audio;
  (globalThis as { Audio: typeof Audio }).Audio = AudioImpl;
  try {
    run();
  } finally {
    resetBoothVoiceAudioPlaybackForTests();
    if (previous === undefined) {
      delete (globalThis as { Audio?: typeof Audio }).Audio;
    } else {
      (globalThis as { Audio: typeof Audio }).Audio = previous;
    }
  }
}

describe("patient booth session-complete clinical handoff", () => {
  it("runs clinical callback exactly once when Audio.play throws synchronously", () => {
    let clinicalCalls = 0;
    withMockAudio(() => {
      invokePatientBoothSessionCompleteHandoff(
        SNAPSHOT,
        () => patientBoothVoiceOnSessionComplete(createPatientBoothVoiceSessionState(), { muted: false }),
        () => {
          clinicalCalls += 1;
        },
      );
    }, class ThrowOnPlayAudio {
      preload = "auto";
      play(): Promise<void> {
        throw new Error("sync play blocked");
      }
      pause(): void {}
      constructor() {}
    } as typeof Audio);
    assert.equal(clinicalCalls, 1);
  });

  it("runs clinical callback exactly once when Audio construction throws", () => {
    let clinicalCalls = 0;
    invokePatientBoothSessionCompleteHandoff(
      SNAPSHOT,
      () => {
        throw new Error("audio construction failed");
      },
      () => {
        clinicalCalls += 1;
      },
    );
    assert.equal(clinicalCalls, 1);
  });

  it("starts session-complete voice before the clinical callback on the happy path", () => {
    const order: string[] = [];
    withMockAudio(() => {
      resetBoothVoiceGuidance();
      const state = createPatientBoothVoiceSessionState();
      invokePatientBoothSessionCompleteHandoff(
        SNAPSHOT,
        () => {
          patientBoothVoiceOnSessionComplete(state, { muted: false, nowMs: 0 });
          order.push("voice");
        },
        () => {
          order.push("clinical");
        },
      );
      assert.deepEqual(order, ["voice", "clinical"]);
      assert.equal(isDetachedBoothVoicePlaybackActive(), true);
    }, class MockAudio {
      preload = "auto";
      paused = true;
      play(): Promise<void> {
        this.paused = false;
        return Promise.resolve();
      }
      pause(): void {
        this.paused = true;
      }
      constructor() {}
    } as typeof Audio);
  });

  it("still runs clinical callback when detached play rejects asynchronously", () => {
    let clinicalCalls = 0;
    withMockAudio(() => {
      resetBoothVoiceGuidance();
      invokePatientBoothSessionCompleteHandoff(
        SNAPSHOT,
        () => {
          patientBoothVoiceOnSessionComplete(createPatientBoothVoiceSessionState(), { muted: false });
        },
        () => {
          clinicalCalls += 1;
        },
      );
    }, class RejectPlayAudio {
      preload = "auto";
      play(): Promise<void> {
        return Promise.reject(new Error("async play rejected"));
      }
      pause(): void {}
      addEventListener(): void {}
      constructor() {}
    } as typeof Audio);
    assert.equal(clinicalCalls, 1);
  });

  it("does not catch errors thrown by the clinical completion callback", () => {
    assert.throws(
      () =>
        invokePatientBoothSessionCompleteHandoff(
          SNAPSHOT,
          () => {},
          () => {
            throw new Error("clinical must propagate");
          },
        ),
      /clinical must propagate/,
    );
  });
});
