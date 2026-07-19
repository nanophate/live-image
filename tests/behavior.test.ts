import assert from "node:assert/strict";
import test from "node:test";

import { IdleBehavior } from "../src/behavior.js";
import { eyeWarpGrids } from "../src/warp.js";
import { fixtureManifest } from "./fixture.js";

test("idle behavior is deterministic for a compiled seed", () => {
  const manifest = fixtureManifest();
  const first = new IdleBehavior(manifest);
  const second = new IdleBehavior(manifest);
  for (const time of [0, 1, 2.9, 3.2, 4.7, 8.1]) assert.deepEqual(first.sample(time), second.sample(time));
});

test("blink collapses only the inner rows while patch boundaries stay fixed", () => {
  const eye = fixtureManifest().analysis.features.eyes[0];
  assert.ok(eye);
  const grids = eyeWarpGrids(eye, 100, 100, 1, 0, 0);
  assert.deepEqual(grids.destination[0], grids.source[0]);
  assert.deepEqual(grids.destination.at(-1), grids.source.at(-1));
  const top = grids.destination[1]?.[1];
  const bottom = grids.destination[2]?.[1];
  assert.ok(top && bottom);
  assert.ok(bottom.y - top.y < 1);
});

test("gaze moves the pupil column without moving feature edges", () => {
  const eye = fixtureManifest().analysis.features.eyes[0];
  assert.ok(eye);
  const grids = eyeWarpGrids(eye, 100, 100, 0, 1, -1);
  assert.equal(grids.destination[1]?.[1]?.x, grids.source[1]?.[1]?.x);
  assert.ok((grids.destination[1]?.[2]?.x ?? 0) > (grids.source[1]?.[2]?.x ?? 0));
  assert.deepEqual(grids.destination[0], grids.source[0]);
});
