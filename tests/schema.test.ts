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

const EMBEDDED_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAAAAACo4kLRAAAAKklEQVQYGW3BAQEAAABAIP6fdkDJkCFDhgwZMmTIkCFDhgwZMmTIkCFDRhLeABUEcxpKAAAAAElFTkSuQmCC";

function eyeDeformationWithIris() {
  return {
    method: "fixed-boundary-piecewise-affine-v1" as const,
    sourceRows: [0.3, 0.34, 0.38, 0.46, 0.48, 0.5],
    closedRows: [0.3, 0.35, 0.418, 0.422, 0.475, 0.5],
    gazeRowWeights: [0, 0, 1, 1, 0, 0],
    region: { x: 0.25, y: 0.3, width: 0.2, height: 0.2 },
    protectedLineArtMask: {
      dataUrl: EMBEDDED_PNG,
      width: 20, height: 20, coverage: 0.1, method: "canny-active-aperture-v1", cannyLow: 20, cannyHigh: 50,
    },
    iris: {
      method: "ellipse-cage-telea-v1" as const,
      texture: { dataUrl: EMBEDDED_PNG, width: 20, height: 20, coverage: 0.4, method: "source-rgba-ellipse-v1" as const },
      baseEye: { dataUrl: EMBEDDED_PNG, width: 20, height: 20, coverage: 1, method: "telea-inpaint-v1" as const },
      centre: { x: 0.35, y: 0.42 }, radiusX: 0.03, radiusY: 0.02, inpaintRadius: 3, segmentationConfidence: 0.8,
    },
  };
}

function semanticEyeMesh() {
  return {
    method: "semantic-weighted-triangle-mesh-v1" as const,
    vertices: [
      { x: 0.25, y: 0.38 }, { x: 0.35, y: 0.38 }, { x: 0.45, y: 0.38 },
      { x: 0.25, y: 0.46 }, { x: 0.35, y: 0.46 }, { x: 0.45, y: 0.46 },
    ],
    triangles: [[0, 1, 4], [0, 4, 3], [1, 2, 5], [1, 5, 4]] as Array<[number, number, number]>,
    fields: [{
      control: "blink" as const,
      weights: [0, 1, 0, 0, 1, 0],
      maxDisplacements: [
        { x: 0, y: 0 }, { x: 0, y: 0.02 }, { x: 0, y: 0 },
        { x: 0, y: 0 }, { x: 0, y: -0.02 }, { x: 0, y: 0 },
      ],
    }] as [{ control: "blink"; weights: number[]; maxDisplacements: Array<{ x: number; y: number }> }],
    aperture: [0, 1, 2, 5, 4, 3],
    minimumAreaRatio: 0.5,
  };
}

test("validates an optional compiler-authored iris/base-eye pair and preserves v1 fallback", () => {
  const manifest = fixtureManifest();
  manifest.analysis.features.eyes[0]!.rig.deformation = eyeDeformationWithIris();
  assert.equal(validateManifest(manifest), manifest);
  assert.equal(validateManifest(fixtureManifest()).id, "fixture");
});

test("rejects malformed iris layer pairs, dimensions, and ellipse geometry", () => {
  const manifest = fixtureManifest();
  manifest.analysis.features.eyes[0]!.rig.deformation = eyeDeformationWithIris();
  const iris = manifest.analysis.features.eyes[0]!.rig.deformation.iris!;

  iris.texture.width = 19;
  assert.throws(() => validateManifest(manifest), /texture dimensions/);

  iris.texture.width = 20;
  (iris as { baseEye?: unknown }).baseEye = undefined;
  assert.throws(() => validateManifest(manifest), /baseEye must be an object/);

  iris.baseEye = { dataUrl: EMBEDDED_PNG, width: 20, height: 20, coverage: 1, method: "telea-inpaint-v1" };
  iris.centre = { x: 0.18, y: 0.42 };
  assert.throws(() => validateManifest(manifest), /ellipse must stay inside/);

  iris.centre = { x: 0.35, y: 0.42 };
  iris.texture.dataUrl = "data:image/png;base64,";
  assert.throws(() => validateManifest(manifest), /texture must contain an embedded PNG/);
});

test("validates an optional compiler-authored semantic eye mesh", () => {
  const manifest = fixtureManifest();
  manifest.analysis.features.eyes[0]!.rig.deformation = eyeDeformationWithIris();
  manifest.analysis.features.eyes[0]!.rig.deformation.semanticMesh = semanticEyeMesh();
  assert.equal(validateManifest(manifest), manifest);
});

test("rejects malformed semantic mesh topology and fields", () => {
  const manifest = fixtureManifest();
  manifest.analysis.features.eyes[0]!.rig.deformation = eyeDeformationWithIris();
  const mesh = semanticEyeMesh();
  manifest.analysis.features.eyes[0]!.rig.deformation.semanticMesh = mesh;

  mesh.triangles[0] = [0, 0, 4];
  assert.throws(() => validateManifest(manifest), /invalid indices/);

  mesh.triangles[0] = [0, 1, 4];
  mesh.fields[0].weights.pop();
  assert.throws(() => validateManifest(manifest), /weights must match vertices/);

  mesh.fields[0].weights.push(0);
  mesh.minimumAreaRatio = 0.019;
  assert.throws(() => validateManifest(manifest), /minimumAreaRatio/);
});

test("validates and bounds an optional closed-eye corrective", () => {
  const manifest = fixtureManifest();
  manifest.analysis.features.eyes[0]!.rig.deformation = eyeDeformationWithIris();
  const deformation = manifest.analysis.features.eyes[0]!.rig.deformation!;
  deformation.closedEye = {
    dataUrl: EMBEDDED_PNG,
    width: 20,
    height: 20,
    coverage: 0.2,
    method: "telea-skin-fill-curve-v1" as const,
    activationStart: 0.55,
    inpaintRadius: 3,
    lineThickness: 2,
  };
  assert.equal(validateManifest(manifest), manifest);

  deformation.closedEye.activationStart = 1;
  assert.throws(() => validateManifest(manifest), /activationStart/);
  deformation.closedEye.activationStart = 0.55;
  deformation.closedEye.width = 19;
  assert.throws(() => validateManifest(manifest), /closedEye dimensions/);
  deformation.closedEye.width = 20;
  deformation.closedEye.lineThickness = 9;
  assert.throws(() => validateManifest(manifest), /lineThickness/);
});

test("requires affine closed-eye sampling evidence", () => {
  const manifest = fixtureManifest();
  manifest.analysis.features.eyes[0]!.rig.deformation = eyeDeformationWithIris();
  const deformation = manifest.analysis.features.eyes[0]!.rig.deformation!;
  deformation.closedEye = {
    dataUrl: EMBEDDED_PNG,
    width: 20,
    height: 20,
    coverage: 0.2,
    method: "affine-skin-fill-curve-v3",
    activationStart: 0.55,
    lineThickness: 2,
    sampleExclusionRadius: 4,
    retainedSamplePixels: 80,
    medianFitResidual: 2.5,
    upperSamplesIncluded: false,
  };
  assert.equal(validateManifest(manifest), manifest);
  deformation.closedEye.upperSamplesIncluded = undefined;
  assert.throws(() => validateManifest(manifest), /upperSamplesIncluded/);
});
