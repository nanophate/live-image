import assert from "node:assert/strict";
import test from "node:test";

import { SHOWCASE_DURATION_SECONDS, showcaseFrameAt } from "../src/showcase.js";
import type { RuntimeCapabilities } from "../src/runtime.js";

const full: RuntimeCapabilities = {
  loaded: true,
  status: "full",
  blink: true,
  gaze: true,
  mouth: true,
  breath: true,
};

test("product showcase is deterministic, bounded, and returns to neutral", () => {
  const times = Array.from({ length: 65 }, (_, index) => index / 10);
  const first = times.map((time) => showcaseFrameAt(time, full));
  const second = times.map((time) => showcaseFrameAt(time, full));
  assert.deepEqual(first, second);
  for (const frame of first) {
    assert.ok(frame.progress >= 0 && frame.progress <= 1);
    assert.ok(frame.state.blinkLeft >= 0 && frame.state.blinkLeft <= 1);
    assert.ok(frame.state.blinkRight >= 0 && frame.state.blinkRight <= 1);
    assert.ok(frame.state.gazeX >= -1 && frame.state.gazeX <= 1);
    assert.ok(frame.state.gazeY >= -1 && frame.state.gazeY <= 1);
    assert.ok(frame.state.mouthOpen >= 0 && frame.state.mouthOpen <= 1);
    assert.ok(frame.state.breath >= -1 && frame.state.breath <= 1);
  }
  assert.deepEqual(showcaseFrameAt(SHOWCASE_DURATION_SECONDS, full).state, {
    blinkLeft: 0,
    blinkRight: 0,
    gazeX: 0,
    gazeY: 0,
    mouthOpen: 0,
    breath: 0,
  });
});

test("product showcase never bypasses disabled or rejected capabilities", () => {
  const limited = { ...full, status: "limited" as const, blink: false, mouth: false };
  for (let time = 0; time <= SHOWCASE_DURATION_SECONDS; time += 0.05) {
    const state = showcaseFrameAt(time, limited).state;
    assert.equal(state.blinkLeft, 0);
    assert.equal(state.blinkRight, 0);
    assert.equal(state.mouthOpen, 0);
  }
  assert.deepEqual(showcaseFrameAt(3, { ...full, status: "reject" }).state, {
    blinkLeft: 0,
    blinkRight: 0,
    gazeX: 0,
    gazeY: 0,
    mouthOpen: 0,
    breath: 0,
  });
});
