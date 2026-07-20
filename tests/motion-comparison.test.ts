import assert from "node:assert/strict";
import test from "node:test";

import {
  BLINK_TRANSITION_TIME_FRACTIONS,
  compareRgbaPixels,
  controlStateMaxError,
  MOTION_SETTLE_DELTA_SECONDS,
  MOTION_SETTLE_FRAMES,
  MOTION_STATE_TOLERANCE,
  planBlinkTransition,
  planMotionComparison,
} from "../src/motion-comparison.js";
import {
  blinkPulseAmount,
  BLINK_PULSE_CLOSE_FRACTION,
  DEFAULT_BLINK_PULSE_DURATION_SECONDS,
} from "../src/runtime.js";
import { fixtureManifest } from "./fixture.js";

test("comparison plan exposes fixed normalized runtime states", () => {
  const plan = planMotionComparison(fixtureManifest());
  assert.deepEqual(plan.map((cell) => cell.id), [
    "neutral", "blink-mid", "blink-full", "wink-left", "wink-right",
    "gaze-left", "gaze-right", "gaze-up", "gaze-down", "mouth-small",
    "mouth-open", "stress-gaze-left", "stress-gaze-right", "stress-mouth",
  ]);
  assert.equal(plan.find((cell) => cell.id === "blink-mid")?.requestedState.blinkLeft, 0.5);
  assert.equal(plan.find((cell) => cell.id === "gaze-left")?.requestedState.gazeX, -0.6);
  assert.equal(plan.find((cell) => cell.id === "gaze-down")?.requestedState.gazeY, 0.4);
  assert.equal(plan.find((cell) => cell.id === "mouth-open")?.requestedState.mouthOpen, 0.62);
  assert.equal(plan.find((cell) => cell.id === "stress-mouth")?.requestedState.mouthOpen, 1);
  assert.equal(plan.find((cell) => cell.id === "stress-mouth")?.phase, "stress");
  assert.ok(plan.every((cell) => cell.status === "available"));
  assert.equal(MOTION_SETTLE_FRAMES, 30);
  assert.equal(MOTION_SETTLE_DELTA_SECONDS, 1 / 60);
  assert.equal(MOTION_STATE_TOLERANCE, 0.005);
});

test("compiler-disabled capabilities are visibly skipped as a group", () => {
  const manifest = fixtureManifest();
  manifest.quality.disabledCapabilities = ["gaze", "mouth"];
  const plan = planMotionComparison(manifest);

  assert.equal(plan.find((cell) => cell.id === "neutral")?.status, "available");
  assert.equal(plan.find((cell) => cell.id === "blink-full")?.status, "available");
  assert.deepEqual(
    plan.filter((cell) => cell.capability === "gaze").map((cell) => cell.status),
    ["skipped", "skipped", "skipped", "skipped", "skipped", "skipped"],
  );
  assert.equal(plan.find((cell) => cell.id === "mouth-open")?.reason, "mouth disabled by compiler");
});

test("rejected assets retain a neutral reference but skip every motion", () => {
  const manifest = fixtureManifest();
  manifest.quality.status = "reject";
  const plan = planMotionComparison(manifest);

  assert.equal(plan[0]?.status, "available");
  assert.ok(plan.slice(1).every((cell) => cell.status === "skipped"));
  assert.ok(plan.slice(1).every((cell) => cell.reason === "Asset rejected by compiler"));
});

test("blink transition samples the runtime pulse through its close and reopen peak", () => {
  const transition = planBlinkTransition(fixtureManifest());

  assert.equal(transition.status, "available");
  assert.equal(transition.frames.length, BLINK_TRANSITION_TIME_FRACTIONS.length);
  assert.equal(transition.frames[0]?.blinkAmount, 0);
  assert.equal(transition.frames.at(-1)?.blinkAmount, 0);
  const peak = transition.frames.find((frame) => frame.blinkAmount === 1);
  assert.ok(peak);
  assert.equal(peak?.label, "close 100%");
  assert.ok(transition.frames.some((frame) => frame.label.startsWith("reopen")));
  assert.ok(transition.frames.every((frame) => frame.requestedState.blinkLeft === frame.blinkAmount));
  assert.ok(transition.frames.every((frame) => frame.requestedState.blinkRight === frame.blinkAmount));
});

test("runtime blink pulse has stable boundaries and a single close peak", () => {
  const duration = DEFAULT_BLINK_PULSE_DURATION_SECONDS;
  assert.equal(blinkPulseAmount(-0.001, duration), 0);
  assert.equal(blinkPulseAmount(0, duration), 0);
  assert.equal(blinkPulseAmount(duration * BLINK_PULSE_CLOSE_FRACTION, duration), 1);
  assert.equal(blinkPulseAmount(duration, duration), 0);
  assert.equal(blinkPulseAmount(duration + 0.001, duration), 0);
  assert.equal(blinkPulseAmount(duration / 2, duration), (1 - 0.5) / (1 - BLINK_PULSE_CLOSE_FRACTION));
  assert.equal(blinkPulseAmount(0.1, 0), 0);
  assert.equal(blinkPulseAmount(0.1, -1), 0);
});

test("blink transition skips rejected and blink-disabled assets without allocating frames", () => {
  const disabled = fixtureManifest();
  disabled.quality.disabledCapabilities = ["blink"];
  const rejected = fixtureManifest();
  rejected.quality.status = "reject";

  assert.deepEqual(planBlinkTransition(disabled), {
    status: "skipped", reason: "blink disabled by compiler", frames: [],
  });
  assert.deepEqual(planBlinkTransition(rejected), {
    status: "skipped", reason: "Asset rejected by compiler", frames: [],
  });
});

test("RGBA comparison counts changed pixels and their maximum channel delta", () => {
  const first = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
  const same = new Uint8ClampedArray(first);
  const changed = new Uint8ClampedArray([10, 20, 30, 255, 40, 80, 55, 255]);

  assert.deepEqual(compareRgbaPixels(first, same), { differingPixels: 0, maxChannelDelta: 0 });
  assert.deepEqual(compareRgbaPixels(first, changed), { differingPixels: 1, maxChannelDelta: 30 });
  assert.throws(
    () => compareRgbaPixels(first, new Uint8ClampedArray(4)),
    /same pixel dimensions/,
  );
});

test("state error checks every normalized control", () => {
  const expected = {
    blinkLeft: 0.5, blinkRight: 0.5, gazeX: -0.6, gazeY: 0.4,
    mouthOpen: 0.35, breath: 0,
  };
  assert.equal(controlStateMaxError(expected, expected), 0);
  assert.ok(Math.abs(controlStateMaxError(expected, { ...expected, gazeX: -0.59 }) - 0.01) < 1e-12);
});
