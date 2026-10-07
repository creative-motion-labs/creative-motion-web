/**
 * Patient camera stream helpers + releaseMediaStream lifecycle regressions.
 *
 * Preserves prior helper coverage and adds focused cleanup cases that prevent
 * orphaned MediaStream tracks from blocking subsequent getUserMedia calls.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PATIENT_CAMERA_NO_FRAMES_ERROR,
  getMediaStreamTrackDiagnostics,
  isVideoPreviewRenderable,
  releaseMediaStream,
  wouldDrawImageSucceed,
} from "./patient-camera-stream";

describe("patient-camera-stream", () => {
  it("getMediaStreamTrackDiagnostics returns empty for null stream", () => {
    assert.deepEqual(getMediaStreamTrackDiagnostics(null), []);
  });

  it("isVideoPreviewRenderable requires srcObject and decoded dimensions", () => {
    const video = {
      srcObject: null,
      videoWidth: 640,
      videoHeight: 480,
      readyState: 4,
    } as HTMLVideoElement;
    assert.equal(isVideoPreviewRenderable(video), false);

    const stream = {
      active: true,
      getVideoTracks: () => [{ readyState: "live", enabled: true }],
    } as unknown as MediaStream;

    const ready = {
      srcObject: stream,
      videoWidth: 640,
      videoHeight: 480,
      readyState: 4,
    } as HTMLVideoElement;
    assert.equal(isVideoPreviewRenderable(ready), true);

    const noFrames = {
      srcObject: stream,
      videoWidth: 0,
      videoHeight: 0,
      readyState: 2,
    } as HTMLVideoElement;
    assert.equal(isVideoPreviewRenderable(noFrames), false);
  });

  it("wouldDrawImageSucceed requires dimensions and playback", () => {
    assert.equal(
      wouldDrawImageSucceed({
        videoWidth: 640,
        videoHeight: 480,
        paused: false,
      } as HTMLVideoElement),
      true,
    );
    assert.equal(
      wouldDrawImageSucceed({
        videoWidth: 0,
        videoHeight: 0,
        paused: false,
      } as HTMLVideoElement),
      false,
    );
    assert.equal(wouldDrawImageSucceed(null), false);
  });

  it("exports stable no-frames error token", () => {
    assert.equal(PATIENT_CAMERA_NO_FRAMES_ERROR, "CAMERA_NO_DECODED_FRAMES");
  });
});

// Minimal MediaStreamTrack stub for releaseMediaStream tests
class StubTrack {
  kind: string;
  stopped = false;

  constructor(kind: string) {
    this.kind = kind;
  }

  stop(): void {
    this.stopped = true;
  }
}

// Minimal MediaStream stub for releaseMediaStream tests
class StubStream {
  private tracks: StubTrack[];

  constructor(trackCount = 1) {
    this.tracks = Array.from({ length: trackCount }, () => new StubTrack("video"));
  }

  getTracks(): StubTrack[] {
    return this.tracks;
  }

  getVideoTracks(): StubTrack[] {
    return this.tracks.filter((t) => t.kind === "video");
  }
}

// Minimal HTMLVideoElement stub for releaseMediaStream tests
class StubVideo {
  srcObject: unknown = null;
}

// Mock global MediaStream for instanceof checks in Node.js environment
// @ts-expect-error - MediaStream doesn't exist in Node.js, but we need it for instanceof checks
if (typeof MediaStream === "undefined") {
  // @ts-expect-error Test stub intentionally replaces the browser MediaStream constructor.
  global.MediaStream = StubStream;
}

describe("releaseMediaStream", () => {
  it("stops all tracks and detaches when stream parameter and video.srcObject are the SAME MediaStream", () => {
    const stream = new StubStream(2);
    const video = new StubVideo() as unknown as HTMLVideoElement;
    video.srcObject = stream;

    releaseMediaStream(stream as unknown as MediaStream, video);

    const tracks = stream.getTracks();
    assert.equal(tracks.length, 2, "stream should have 2 tracks");
    assert.equal(tracks[0].stopped, true, "first track should be stopped");
    assert.equal(tracks[1].stopped, true, "second track should be stopped");
    assert.equal(video.srcObject, null, "video.srcObject should be detached");
  });

  it("stops video.srcObject tracks when stream parameter is null", () => {
    const videoStream = new StubStream(2);
    const video = new StubVideo() as unknown as HTMLVideoElement;
    video.srcObject = videoStream;

    releaseMediaStream(null, video);

    const tracks = videoStream.getTracks();
    assert.equal(tracks[0].stopped, true, "video.srcObject track 0 must be stopped");
    assert.equal(tracks[1].stopped, true, "video.srcObject track 1 must be stopped");
    assert.equal(video.srcObject, null, "video.srcObject should be detached");
  });

  it("stops tracks from BOTH streams when stream parameter and video.srcObject are DIFFERENT MediaStreams", () => {
    const streamA = new StubStream(2);
    const streamB = new StubStream(3);
    const video = new StubVideo() as unknown as HTMLVideoElement;
    video.srcObject = streamB;

    releaseMediaStream(streamA as unknown as MediaStream, video);

    const tracksA = streamA.getTracks();
    const tracksB = streamB.getTracks();

    assert.equal(tracksA[0].stopped, true, "streamA track 0 must be stopped");
    assert.equal(tracksA[1].stopped, true, "streamA track 1 must be stopped");
    assert.equal(tracksB[0].stopped, true, "streamB track 0 must be stopped");
    assert.equal(tracksB[1].stopped, true, "streamB track 1 must be stopped");
    assert.equal(tracksB[2].stopped, true, "streamB track 2 must be stopped");
    assert.equal(video.srcObject, null, "video.srcObject should be detached");
  });

  it("is safe and idempotent when called repeatedly", () => {
    const stream = new StubStream(2);
    const video = new StubVideo() as unknown as HTMLVideoElement;
    video.srcObject = stream;

    releaseMediaStream(stream as unknown as MediaStream, video);
    const tracks = stream.getTracks();
    assert.equal(tracks[0].stopped, true, "track 0 stopped after first call");
    assert.equal(video.srcObject, null, "video detached after first call");

    releaseMediaStream(stream as unknown as MediaStream, video);
    assert.equal(tracks[0].stopped, true, "track 0 still stopped after second call");
    assert.equal(video.srcObject, null, "video still detached after second call");

    releaseMediaStream(null, video);
    assert.equal(video.srcObject, null, "cleanup with all nulls is safe");
  });

  it("handles video.srcObject that is not a MediaStream", () => {
    const stream = new StubStream(1);
    const video = new StubVideo() as unknown as HTMLVideoElement;
    video.srcObject = "not-a-stream";

    releaseMediaStream(stream as unknown as MediaStream, video);

    const tracks = stream.getTracks();
    assert.equal(tracks[0].stopped, true, "stream parameter track stopped");
    assert.equal(video.srcObject, null, "video.srcObject cleared regardless");
  });

  it("handles missing video parameter gracefully", () => {
    const stream = new StubStream(1);

    releaseMediaStream(stream as unknown as MediaStream, null);
    releaseMediaStream(stream as unknown as MediaStream, undefined);

    const tracks = stream.getTracks();
    assert.equal(tracks[0].stopped, true, "stream tracks stopped even without video");
  });
});
