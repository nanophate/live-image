import assert from "node:assert/strict";
import test from "node:test";

import {
  controlStateMaxError,
  MOTION_SETTLE_DELTA_SECONDS,
  MOTION_SETTLE_FRAMES,
  MOTION_STATE_TOLERANCE,
  planMotionComparison,
} from "../src/motion-comparison.js";
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

test("state error checks every normalized control", () => {
  const expected = {
    blinkLeft: 0.5, blinkRight: 0.5, gazeX: -0.6, gazeY: 0.4,
    mouthOpen: 0.35, breath: 0,
  };
  assert.equal(controlStateMaxError(expected, expected), 0);
  assert.ok(Math.abs(controlStateMaxError(expected, { ...expected, gazeX: -0.59 }) - 0.01) < 1e-12);
});
