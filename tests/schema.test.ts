import assert from "node:assert/strict";
import test from "node:test";

import { parseLivingImage, validateManifest } from "../src/schema.js";
import { fixtureManifest } from "./fixture.js";

test("validates a version-one portable manifest", () => {
  const manifest = fixtureManifest();
  assert.equal(validateManifest(manifest), manifest);
  assert.equal(parseLivingImage(JSON.stringify(manifest)).id, "fixture");
});

test("rejects missing embedded images and unknown versions", () => {
  const manifest = fixtureManifest() as unknown as Record<string, unknown>;
  manifest.version = 2;
  assert.throws(() => validateManifest(manifest), /unsupported/);

  const invalidDimensions = fixtureManifest();
  invalidDimensions.image.width = 0;
  assert.throws(() => validateManifest(invalidDimensions), /invalid image dimensions/);

  const oversized = fixtureManifest();
  oversized.image.width = 8192;
  oversized.image.height = 8192;
  assert.throws(() => validateManifest(oversized), /invalid image dimensions/);
});

test("rejects unsafe feature geometry before it reaches Canvas", () => {
  const malformedRig = fixtureManifest() as unknown as {
    analysis: { features: { eyes: Array<{ rig: { maxGazeX: unknown } }> } };
  };
  malformedRig.analysis.features.eyes[0]!.rig.maxGazeX = "bad";
  assert.throws(() => validateManifest(malformedRig), /rig ranges are invalid/);

  const duplicateSide = fixtureManifest();
  duplicateSide.analysis.features.eyes[1]!.side = "left";
  assert.throws(() => validateManifest(duplicateSide), /one left eye and one right eye/);

  const malformedMouth = fixtureManifest();
  malformedMouth.analysis.features.mouth.rig.maxOpen = Number.NaN;
  assert.throws(() => validateManifest(malformedMouth), /mouth rig ranges are invalid/);
});

test("validates optional compiler-authored local deformation", () => {
  const manifest = fixtureManifest();
  const eye = manifest.analysis.features.eyes[0];
  assert.ok(eye);
  eye.rig.deformation = {
    method: "fixed-boundary-piecewise-affine-v1",
    sourceRows: [0.3, 0.34, 0.38, 0.46, 0.48, 0.5],
    closedRows: [0.3, 0.35, 0.418, 0.422, 0.475, 0.5],
    gazeRowWeights: [0, 0, 1, 1, 0, 0],
    region: { ...eye.region },
    protectedLineArtMask: {
      dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAAAAACo4kLRAAAAKklEQVQYGW3BAQEAAABAIP6fdkDJkCFDhgwZMmTIkCFDhgwZMmTIkCFDRhLeABUEcxpKAAAAAElFTkSuQmCC",
      width: 20,
      height: 20,
      coverage: 0.1,
      method: "canny-active-aperture-v1",
      cannyLow: 20,
      cannyHigh: 50,
    },
  };
  assert.equal(validateManifest(manifest), manifest);

  eye.rig.deformation.closedRows[3] = eye.rig.deformation.closedRows[2] ?? 0;
  assert.throws(() => validateManifest(manifest), /strictly increasing/);
});
