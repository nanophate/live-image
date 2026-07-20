import assert from "node:assert/strict";
import test from "node:test";

import { planEyeSemanticMesh } from "../src/semantic-mesh.js";
import type { EyeSemanticMeshRig } from "../src/schema.js";

function mesh(): EyeSemanticMeshRig {
  return {
    method: "semantic-weighted-triangle-mesh-v1",
    vertices: [
      { x: 0.2, y: 0.3 }, { x: 0.5, y: 0.3 }, { x: 0.8, y: 0.3 },
      { x: 0.2, y: 0.7 }, { x: 0.5, y: 0.7 }, { x: 0.8, y: 0.7 },
    ],
    triangles: [[0, 1, 4], [0, 4, 3], [1, 2, 5], [1, 5, 4]],
    fields: [{
      control: "blink",
      weights: [0, 1, 0, 0, 1, 0],
      maxDisplacements: [
        { x: 0, y: 0 }, { x: 0, y: 0.1 }, { x: 0, y: 0 },
        { x: 0, y: 0 }, { x: 0, y: -0.1 }, { x: 0, y: 0 },
      ],
    }],
    aperture: [0, 1, 2, 5, 4, 3],
    minimumAreaRatio: 0.5,
  };
}

test("semantic eye mesh is exact at neutral and applies compiler weights", () => {
  const neutral = planEyeSemanticMesh(mesh(), 100, 50, 0);
  assert.deepEqual(neutral.destination, neutral.source);
  assert.equal(neutral.minimumAreaRatio, 1);

  const closed = planEyeSemanticMesh(mesh(), 100, 50, 1);
  assert.deepEqual(closed.destination[1], { x: 50, y: 20 });
  assert.deepEqual(closed.destination[4], { x: 50, y: 30 });
  assert.deepEqual(closed.destination[0], closed.source[0]);
  assert.equal(closed.minimumAreaRatio, 0.5);
});

test("semantic eye mesh clamps controls and extracts the authored aperture", () => {
  const plan = planEyeSemanticMesh(mesh(), 100, 50, 2);
  assert.equal(plan.aperture.length, 6);
  assert.deepEqual(plan.aperture[1], plan.destination[1]);
  assert.deepEqual(plan.aperture[4], plan.destination[4]);
});

test("semantic eye mesh fails closed when a triangle changes winding", () => {
  const invalid = mesh();
  invalid.fields[0].maxDisplacements[1] = { x: 0, y: 0.5 };
  invalid.fields[0].maxDisplacements[4] = { x: 0, y: -0.5 };
  assert.throws(() => planEyeSemanticMesh(invalid, 100, 50, 1), /changed winding|collapsed/);
});
