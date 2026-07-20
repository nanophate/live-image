import assert from "node:assert/strict";
import test from "node:test";

import { IdleBehavior } from "../src/behavior.js";
import { eyeIrisPlan, eyeWarpGrids, mouthOpenPlan } from "../src/warp.js";
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

test("compiler-authored eye rows keep fixed boundaries and never invert", () => {
  const eye = fixtureManifest().analysis.features.eyes[0];
  assert.ok(eye);
  eye.rig.deformation = {
    method: "fixed-boundary-piecewise-affine-v1",
    sourceRows: [0.3, 0.34, 0.38, 0.46, 0.48, 0.5],
    closedRows: [0.3, 0.35, 0.418, 0.422, 0.475, 0.5],
    gazeRowWeights: [0, 0, 1, 1, 0, 0],
    region: { ...eye.region },
    protectedLineArtMask: {
      dataUrl: "data:image/png;base64,AA==",
      width: 20,
      height: 20,
      coverage: 0.1,
      method: "canny-active-aperture-v1",
      cannyLow: 20,
      cannyHigh: 50,
    },
  };

  for (const blink of [0, 0.25, 0.5, 0.75, 1]) {
    const grids = eyeWarpGrids(eye, 100, 100, blink, 0.8, -0.4);
    assert.equal(grids.source.length, 6);
    assert.deepEqual(grids.destination[0], grids.source[0]);
    assert.deepEqual(grids.destination.at(-1), grids.source.at(-1));
    const rows = grids.destination.map((row) => row[1]?.y ?? Number.NaN);
    assert.ok(rows.every((row, index) => index === 0 || row > (rows[index - 1] ?? row)));
  }
});

test("iris plan keeps its cage rigid, follows gaze, and vanishes at full blink", () => {
  const eye = fixtureManifest().analysis.features.eyes[0];
  assert.ok(eye);
  eye.rig.deformation = {
    method: "fixed-boundary-piecewise-affine-v1",
    sourceRows: [0.3, 0.34, 0.38, 0.46, 0.48, 0.5],
    closedRows: [0.3, 0.35, 0.418, 0.422, 0.475, 0.5],
    gazeRowWeights: [0, 0, 1, 1, 0, 0],
    region: { ...eye.region },
    protectedLineArtMask: {
      dataUrl: "data:image/png;base64,AA==",
      width: 20,
      height: 20,
      coverage: 0.1,
      method: "canny-active-aperture-v1",
      cannyLow: 20,
      cannyHigh: 50,
    },
    iris: {
      method: "ellipse-cage-telea-v1",
      texture: { dataUrl: "data:image/png;base64,AA==", width: 20, height: 20, coverage: 0.1, method: "source-rgba-ellipse-v1" },
      baseEye: { dataUrl: "data:image/png;base64,AA==", width: 20, height: 20, coverage: 1, method: "telea-inpaint-v1" },
      centre: { x: 0.35, y: 0.42 },
      radiusX: 0.03,
      radiusY: 0.025,
      inpaintRadius: 3,
      segmentationConfidence: 0.9,
    },
  };

  const neutral = eyeIrisPlan(eye, 100, 100, 0, 0, 0);
  const moved = eyeIrisPlan(eye, 100, 100, 0, 1, -1);
  const closed = eyeIrisPlan(eye, 100, 100, 1, 1, -1);
  assert.ok(neutral && moved && closed);
  assert.equal(neutral.radiusX, 3);
  assert.equal(neutral.radiusY, 2.5);
  assert.equal(moved.radiusX, neutral.radiusX);
  assert.equal(moved.radiusY, neutral.radiusY);
  assert.equal(moved.centre.x - neutral.centre.x, 1);
  assert.equal(moved.centre.y - neutral.centre.y, -0.5);
  assert.deepEqual(moved.aperture, neutral.aperture);
  assert.equal(closed.centre.x, neutral.centre.x);
  assert.equal(closed.centre.y, neutral.centre.y);
  assert.equal(closed.alpha, 0);
  const blinkAlphas = [0, 0.25, 0.5, 0.75, 1].map((blink) => {
    const plan = eyeIrisPlan(eye, 100, 100, blink, 0, 0);
    assert.ok(plan);
    return plan.alpha;
  });
  assert.equal(blinkAlphas[0], 1);
  assert.equal(blinkAlphas.at(-1), 0);
  assert.ok(blinkAlphas.every((alpha, index) => index === 0 || alpha <= (blinkAlphas[index - 1] ?? alpha)));
});

test("bounded mouth plan translates only compiler-authored line bands", () => {
  const mouth = fixtureManifest().analysis.features.mouth;
  mouth.rig.deformation = {
    method: "bounded-lip-bands-v1",
    upperBand: { x: 0.43, y: 0.635, width: 0.14, height: 0.015 },
    lowerBand: { x: 0.43, y: 0.65, width: 0.14, height: 0.015 },
    cavity: { centreX: 0.5, centreY: 0.65, radiusX: 0.055, maxRadiusY: 0.012 },
    upperTravel: 0.008,
    lowerTravel: 0.012,
    lineContrast: 40,
  };

  assert.equal(mouthOpenPlan(mouth, 100, 100, 0), null);
  const plan = mouthOpenPlan(mouth, 100, 100, 0.5);
  assert.ok(plan);
  assert.equal(plan.amount, 0.5);
  assert.equal(plan.upper.destination.y, plan.upper.source.y - 0.4);
  assert.equal(plan.lower.destination.y, plan.lower.source.y + 0.6);
  assert.equal(plan.upper.destination.width, plan.upper.source.width);
  assert.equal(plan.lower.destination.height, plan.lower.source.height);
});
