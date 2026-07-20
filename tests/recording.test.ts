import assert from "node:assert/strict";
import test from "node:test";

import { recordCanvasAction } from "../src/recording.js";

test("recording settles recorder failure and stops tracks when the action rejects", async () => {
  const previousMediaRecorder = globalThis.MediaRecorder;
  let trackStopped = false;

  class FakeRecorder {
    static isTypeSupported(): boolean { return true; }
    state: RecordingState = "inactive";
    mimeType = "video/webm";
    ondataavailable: ((event: BlobEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onstop: ((event: Event) => void) | null = null;

    start(): void { this.state = "recording"; }
    stop(): void {
      this.state = "inactive";
      queueMicrotask(() => {
        this.onerror?.(new Event("error"));
        this.onstop?.(new Event("stop"));
      });
    }
  }

  const stream = {
    getTracks: () => [{ stop: () => { trackStopped = true; } }],
  } as unknown as MediaStream;
  const canvas = {
    captureStream: () => stream,
  } as unknown as HTMLCanvasElement;
  Object.assign(globalThis, { MediaRecorder: FakeRecorder });

  try {
    const original = new Error("showcase failed");
    await assert.rejects(recordCanvasAction(canvas, async () => { throw original; }), original);
    assert.equal(trackStopped, true);
  } finally {
    Object.assign(globalThis, { MediaRecorder: previousMediaRecorder });
  }
});
