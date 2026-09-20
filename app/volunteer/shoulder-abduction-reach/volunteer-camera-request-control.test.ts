/**
 * Run: npx tsx --test app/volunteer/shoulder-abduction-reach/volunteer-camera-request-control.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCameraRequestController,
  disposeDetectorIfStale,
  disposePreviewStreamIfStale,
  stopDetectorInstance,
  stopMediaStreamTracks,
} from "./volunteer-camera-request-control";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mockStream() {
  let stopped = 0;
  const stream = {
    getTracks: () => [{ stop: () => { stopped += 1; } }, { stop: () => { stopped += 1; } }],
    stopped: () => stopped,
  };
  return stream;
}

function mockDetector() {
  let stopped = false;
  return {
    stop: () => {
      stopped = true;
    },
    stopped: () => stopped,
  };
}

describe("volunteer-camera-request-control", () => {
  it("beginPreviewRequest supersedes prior preview generations", () => {
    const controller = createCameraRequestController();
    const first = controller.beginPreviewRequest();
    const second = controller.beginPreviewRequest();
    assert.equal(controller.isPreviewCurrent(first), false);
    assert.equal(controller.isPreviewCurrent(second), true);
  });

  it("invalidatePreview marks in-flight preview requests stale", () => {
    const controller = createCameraRequestController();
    const generation = controller.beginPreviewRequest();
    controller.invalidatePreview();
    assert.equal(controller.isPreviewCurrent(generation), false);
  });

  it("beginDetectorRequest supersedes prior detector generations", () => {
    const controller = createCameraRequestController();
    const first = controller.beginDetectorRequest();
    const second = controller.beginDetectorRequest();
    assert.equal(controller.isDetectorCurrent(first), false);
    assert.equal(controller.isDetectorCurrent(second), true);
  });

  it("markUnmounted invalidates preview and detector requests", () => {
    const controller = createCameraRequestController();
    const previewGeneration = controller.beginPreviewRequest();
    const detectorGeneration = controller.beginDetectorRequest();
    controller.markUnmounted();
    assert.equal(controller.shouldApplyState(), false);
    assert.equal(controller.isPreviewCurrent(previewGeneration), false);
    assert.equal(controller.isDetectorCurrent(detectorGeneration), false);
  });

  it("stops stale MediaStream tracks when preview generation is superseded", () => {
    const controller = createCameraRequestController();
    const staleGeneration = controller.beginPreviewRequest();
    controller.beginPreviewRequest();
    const stream = mockStream();
    disposePreviewStreamIfStale(stream, controller, staleGeneration);
    assert.equal(stream.stopped(), 2);
  });

  it("does not stop MediaStream tracks when preview generation is still current", () => {
    const controller = createCameraRequestController();
    const generation = controller.beginPreviewRequest();
    const stream = mockStream();
    disposePreviewStreamIfStale(stream, controller, generation);
    assert.equal(stream.stopped(), 0);
  });

  it("stops stale detector instances when detector generation is superseded", () => {
    const controller = createCameraRequestController();
    const staleGeneration = controller.beginDetectorRequest();
    controller.beginDetectorRequest();
    const detector = mockDetector();
    disposeDetectorIfStale(detector, controller, staleGeneration);
    assert.equal(detector.stopped(), true);
  });

  it("simulates deferred getUserMedia resolving after invalidation", async () => {
    const controller = createCameraRequestController();
    const deferred = createDeferred<ReturnType<typeof mockStream>>();
    const generation = controller.beginPreviewRequest();
    const pending = deferred.promise.then((stream) => {
      disposePreviewStreamIfStale(stream, controller, generation);
      return controller.isPreviewCurrent(generation);
    });

    controller.invalidatePreview();
    deferred.resolve(mockStream());
    assert.equal(await pending, false);
  });

  it("simulates deferred detector.start resolving after invalidation", async () => {
    const controller = createCameraRequestController();
    const deferred = createDeferred<void>();
    const generation = controller.beginDetectorRequest();
    const detector = mockDetector();

    const pending = deferred.promise.then(() => {
      disposeDetectorIfStale(detector, controller, generation);
      return controller.isDetectorCurrent(generation);
    });

    controller.invalidateDetector();
    deferred.resolve();
    assert.equal(await pending, false);
    assert.equal(detector.stopped(), true);
  });

  it("stopMediaStreamTracks stops every track", () => {
    const stream = mockStream();
    stopMediaStreamTracks(stream);
    assert.equal(stream.stopped(), 2);
  });

  it("stopDetectorInstance stops the detector", () => {
    const detector = mockDetector();
    stopDetectorInstance(detector);
    assert.equal(detector.stopped(), true);
  });
});
