import { clamp } from "./math.js";
import type { EyeSemanticMeshRig, Point } from "./schema.js";
import { drawTexturedTriangle, type Vec2 } from "./warp.js";

export interface SemanticMeshPlan {
  source: Vec2[];
  destination: Vec2[];
  aperture: Vec2[];
  minimumAreaRatio: number;
}

function signedArea(first: Vec2, second: Vec2, third: Vec2): number {
  return ((second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x)) * 0.5;
}

function pixelPoint(point: Point, width: number, height: number): Vec2 {
  return { x: point.x * width, y: point.y * height };
}

/**
 * Resolve one compiler-authored semantic field and fail closed if the current
 * control value would invert or collapse any source triangle.
 */
export function planEyeSemanticMesh(
  mesh: EyeSemanticMeshRig,
  imageWidth: number,
  imageHeight: number,
  blinkValue: number,
): SemanticMeshPlan {
  const field = mesh.fields[0];
  if (!field || field.control !== "blink") throw new Error("semantic eye mesh is missing its blink field");
  const blink = clamp(blinkValue, 0, 1);
  const source = mesh.vertices.map((vertex) => pixelPoint(vertex, imageWidth, imageHeight));
  const destination = source.map((point, index) => {
    const displacement = field.maxDisplacements[index];
    const weight = field.weights[index];
    if (!displacement || weight === undefined) throw new Error("semantic eye mesh field does not match its vertices");
    return {
      x: point.x + blink * weight * displacement.x * imageWidth,
      y: point.y + blink * weight * displacement.y * imageHeight,
    };
  });

  let minimumAreaRatio = 1;
  for (const [triangleIndex, triangle] of mesh.triangles.entries()) {
    const sourceTriangle = triangle.map((index) => source[index]);
    const destinationTriangle = triangle.map((index) => destination[index]);
    const [s0, s1, s2] = sourceTriangle;
    const [d0, d1, d2] = destinationTriangle;
    if (!s0 || !s1 || !s2 || !d0 || !d1 || !d2) throw new Error(`semantic eye mesh triangle ${triangleIndex} is incomplete`);
    const sourceArea = signedArea(s0, s1, s2);
    const destinationArea = signedArea(d0, d1, d2);
    if (Math.abs(sourceArea) <= 1e-7 || sourceArea * destinationArea <= 0) {
      throw new Error(`semantic eye mesh triangle ${triangleIndex} changed winding`);
    }
    const ratio = Math.abs(destinationArea / sourceArea);
    minimumAreaRatio = Math.min(minimumAreaRatio, ratio);
    if (ratio < 0.02) throw new Error(`semantic eye mesh triangle ${triangleIndex} collapsed below 2%`);
  }
  // The runtime recomputes this value instead of trusting the manifest. The
  // compiler's preflight remains a useful lower bound across its fixed samples.
  if (minimumAreaRatio + 1e-9 < mesh.minimumAreaRatio) {
    throw new Error("semantic eye mesh area ratio is below its compiler-authored bound");
  }
  const aperture = mesh.aperture.map((index) => {
    const point = destination[index];
    if (!point) throw new Error("semantic eye mesh aperture index is out of range");
    return point;
  });
  return { source, destination, aperture, minimumAreaRatio };
}

export function drawSemanticMeshWarp(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  mesh: EyeSemanticMeshRig,
  plan: SemanticMeshPlan,
  options: { sourceOrigin?: Vec2 } = {},
): void {
  const origin = options.sourceOrigin ?? { x: 0, y: 0 };
  const local = (point: Vec2): Vec2 => ({ x: point.x - origin.x, y: point.y - origin.y });
  for (const triangle of mesh.triangles) {
    const [first, second, third] = triangle;
    const source = [plan.source[first!], plan.source[second!], plan.source[third!]];
    const destination = [plan.destination[first!], plan.destination[second!], plan.destination[third!]];
    const [s0, s1, s2] = source;
    const [d0, d1, d2] = destination;
    if (!s0 || !s1 || !s2 || !d0 || !d1 || !d2) throw new Error("semantic eye mesh triangle is incomplete");
    drawTexturedTriangle(context, image, [local(s0), local(s1), local(s2)], [d0, d1, d2]);
  }
}
