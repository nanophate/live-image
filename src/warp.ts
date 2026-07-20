import type { EyeFeature, MouthFeature, Rect } from "./schema.js";
import { clamp, mix } from "./math.js";

export interface Vec2 { x: number; y: number }

function affine(source: readonly Vec2[], destination: readonly Vec2[]): [number, number, number, number, number, number] | null {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = destination;
  if (!s0 || !s1 || !s2 || !d0 || !d1 || !d2) return null;
  const denominator = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(denominator) < 1e-5) return null;
  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denominator;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denominator;
  const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denominator;
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denominator;
  const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  return [a, b, c, d, e, f];
}

export function drawTexturedTriangle(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  source: readonly Vec2[],
  destination: readonly Vec2[],
): void {
  const transform = affine(source, destination);
  const [d0, d1, d2] = destination;
  if (!transform || !d0 || !d1 || !d2) return;
  context.save();
  context.beginPath();
  context.moveTo(d0.x, d0.y);
  context.lineTo(d1.x, d1.y);
  context.lineTo(d2.x, d2.y);
  context.closePath();
  context.clip();
  context.transform(...transform);
  const sourceX = Math.floor(Math.min(...source.map((point) => point.x)));
  const sourceY = Math.floor(Math.min(...source.map((point) => point.y)));
  const sourceWidth = Math.max(1, Math.ceil(Math.max(...source.map((point) => point.x))) - sourceX);
  const sourceHeight = Math.max(1, Math.ceil(Math.max(...source.map((point) => point.y))) - sourceY);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
  );
  context.restore();
}

export function drawGridWarp(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  source: readonly (readonly Vec2[])[],
  destination: readonly (readonly Vec2[])[],
  options: { sourceOrigin?: Vec2 } = {},
): void {
  const sourceOrigin = options.sourceOrigin ?? { x: 0, y: 0 };
  for (let row = 0; row < source.length - 1; row += 1) {
    const sourceTop = source[row];
    const sourceBottom = source[row + 1];
    const destinationTop = destination[row];
    const destinationBottom = destination[row + 1];
    if (!sourceTop || !sourceBottom || !destinationTop || !destinationBottom) continue;
    for (let column = 0; column < sourceTop.length - 1; column += 1) {
      const s00 = sourceTop[column], s10 = sourceTop[column + 1], s01 = sourceBottom[column], s11 = sourceBottom[column + 1];
      const d00 = destinationTop[column], d10 = destinationTop[column + 1], d01 = destinationBottom[column], d11 = destinationBottom[column + 1];
      if (!s00 || !s10 || !s01 || !s11 || !d00 || !d10 || !d01 || !d11) continue;
      // The compiler may embed a compact eye-base texture instead of the full
      // source image. Keep destination coordinates in image space while
      // remapping only the texture's source coordinates to its local origin.
      const local = (point: Vec2): Vec2 => ({ x: point.x - sourceOrigin.x, y: point.y - sourceOrigin.y });
      drawTexturedTriangle(context, image, [local(s00), local(s10), local(s11)], [d00, d10, d11]);
      drawTexturedTriangle(context, image, [local(s00), local(s11), local(s01)], [d00, d11, d01]);
    }
  }
}

export function eyeWarpGrids(
  eye: EyeFeature,
  imageWidth: number,
  imageHeight: number,
  blinkValue: number,
  gazeX: number,
  gazeY: number,
): { source: Vec2[][]; destination: Vec2[][] } {
  const region = eye.region;
  const x0 = region.x * imageWidth;
  const x1 = (region.x + region.width) * imageWidth;
  const y0 = region.y * imageHeight;
  const y1 = (region.y + region.height) * imageHeight;
  const eyeLeft = eye.anchors.left * imageWidth;
  const eyeRight = eye.anchors.right * imageWidth;
  const eyeTop = eye.anchors.top * imageHeight;
  const eyeBottom = eye.anchors.bottom * imageHeight;
  const pupilX = clamp(eye.pupil.x * imageWidth, eyeLeft + 1, eyeRight - 1);
  const sourceXs = [x0, eyeLeft, pupilX, eyeRight, x1];
  const deformation = eye.rig.deformation;
  const sourceYs = deformation
    ? deformation.sourceRows.map((row) => row * imageHeight)
    : [y0, eyeTop, eyeBottom, y1];
  const source = sourceYs.map((y) => sourceXs.map((x) => ({ x, y })));
  const blink = clamp(blinkValue, 0, 1);
  const closedYs = deformation
    ? deformation.closedRows.map((row) => row * imageHeight)
    : (() => {
        const centreY = eye.anchors.centreY * imageHeight;
        const floor = eye.rig.blinkFloor * imageHeight;
        return [y0, centreY - floor * 0.5, centreY + floor * 0.5, y1];
      })();
  const gazeSuppression = 1 - blink;
  const shiftX = clamp(gazeX, -1, 1) * eye.rig.maxGazeX * imageWidth * gazeSuppression;
  const shiftY = clamp(gazeY, -1, 1) * eye.rig.maxGazeY * imageHeight * gazeSuppression;

  const destination = source.map((row, rowIndex) => row.map((point, columnIndex) => {
    const gazeWeight = deformation
      ? (deformation.gazeRowWeights[rowIndex] ?? 0)
      : (rowIndex === 1 || rowIndex === 2 ? 1 : 0);
    const closedY = closedYs[rowIndex] ?? point.y;
    const y = mix(point.y, closedY, blink);
    const columnWeight = columnIndex === 2 ? 1 : 0;
    return {
      x: point.x + shiftX * columnWeight * gazeWeight,
      y: y + shiftY * columnWeight * gazeWeight,
    };
  }));
  return { source, destination };
}

export interface IrisMotionPlan {
  /** Pixel-space centre of the rigid iris/highlight texture. */
  centre: Vec2;
  /** Pixel radii stay invariant: gaze is translation only. */
  radiusX: number;
  radiusY: number;
  /** The compact texture's destination origin, in full-image pixel space. */
  textureOrigin: Vec2;
  /** The current eyelid aperture, assembled from the destination cage. */
  aperture: Vec2[];
  /** Exactly zero at the compiler-authored full-close floor. */
  alpha: number;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value > edge0 ? 1 : 0;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Plan the rigid iris/highlight layer independently of the eyelid mesh. The
 * aperture is derived from the same destination rows as the base-eye warp so
 * canvas compositing cannot diverge from the compiler's geometry.
 */
export function eyeIrisPlan(
  eye: EyeFeature,
  imageWidth: number,
  imageHeight: number,
  blinkValue: number,
  gazeX: number,
  gazeY: number,
  apertureOverride?: readonly Vec2[],
): IrisMotionPlan | null {
  const deformation = eye.rig.deformation;
  const iris = deformation?.iris;
  if (!deformation || !iris) return null;
  const blink = clamp(blinkValue, 0, 1);
  // The base eye and eyelid aperture only blink. Gaze is a rigid iris
  // translation; feeding it back into these rows would deform the sclera and
  // translate the clip a second time.
  const grids = eyeWarpGrids(eye, imageWidth, imageHeight, blink, 0, 0);
  let aperture: Vec2[];
  let topCentre: Vec2 | undefined;
  let bottomCentre: Vec2 | undefined;
  if (apertureOverride) {
    if (apertureOverride.length < 6 || apertureOverride.length % 2 !== 0) return null;
    const half = apertureOverride.length / 2;
    const top = apertureOverride.slice(0, half);
    const bottomReversed = apertureOverride.slice(half);
    topCentre = top[Math.floor(top.length / 2)];
    bottomCentre = bottomReversed[Math.floor(bottomReversed.length / 2)];
    aperture = [...apertureOverride];
  } else {
    const top = grids.destination[2];
    const bottom = grids.destination[3];
    if (!top || !bottom) return null;
    const topLeft = top[1], legacyTopCentre = top[2], topRight = top[3];
    const bottomLeft = bottom[1], legacyBottomCentre = bottom[2], bottomRight = bottom[3];
    if (!topLeft || !legacyTopCentre || !topRight || !bottomLeft || !legacyBottomCentre || !bottomRight) return null;
    topCentre = legacyTopCentre;
    bottomCentre = legacyBottomCentre;
    aperture = [topLeft, legacyTopCentre, topRight, bottomRight, legacyBottomCentre, bottomLeft];
  }
  if (!topCentre || !bottomCentre) return null;

  const gazeSuppression = 1 - blink;
  const shiftX = clamp(gazeX, -1, 1) * eye.rig.maxGazeX * imageWidth * gazeSuppression;
  const shiftY = clamp(gazeY, -1, 1) * eye.rig.maxGazeY * imageHeight * gazeSuppression;
  const apertureHeight = Math.max(0, bottomCentre.y - topCentre.y);
  const closeFloor = eye.rig.blinkFloor * imageHeight;
  const irisDiameter = iris.radiusY * imageHeight * 2;

  return {
    centre: {
      x: iris.centre.x * imageWidth + shiftX,
      y: iris.centre.y * imageHeight + shiftY,
    },
    radiusX: iris.radiusX * imageWidth,
    radiusY: iris.radiusY * imageHeight,
    textureOrigin: {
      x: deformation.region.x * imageWidth + shiftX,
      y: deformation.region.y * imageHeight + shiftY,
    },
    aperture,
    // Full close is a semantic endpoint even if an invalid/legacy cage leaves
    // a larger-than-floor numerical gap between its two lid rows.
    alpha: blink >= 1 ? 0 : smoothstep(closeFloor, closeFloor + irisDiameter * 0.35, apertureHeight),
  };
}

export interface MouthOpenPlan {
  amount: number;
  cavity: { centreX: number; centreY: number; radiusX: number; radiusY: number };
  upper: { source: Rect; destination: Rect };
  lower: { source: Rect; destination: Rect };
}

function pixelRect(rect: Rect, width: number, height: number): Rect {
  return { x: rect.x * width, y: rect.y * height, width: rect.width * width, height: rect.height * height };
}

/** Convert compiler-authored mouth bands into one bounded runtime draw plan. */
export function mouthOpenPlan(
  mouth: MouthFeature,
  imageWidth: number,
  imageHeight: number,
  openValue: number,
): MouthOpenPlan | null {
  const deformation = mouth.rig.deformation;
  const amount = clamp(openValue, 0, 1);
  if (!deformation || amount <= 0.001) return null;
  const upperSource = pixelRect(deformation.upperBand, imageWidth, imageHeight);
  const lowerSource = pixelRect(deformation.lowerBand, imageWidth, imageHeight);
  const upperOffset = deformation.upperTravel * imageHeight * amount;
  const lowerOffset = deformation.lowerTravel * imageHeight * amount;
  return {
    amount,
    cavity: {
      centreX: deformation.cavity.centreX * imageWidth,
      centreY: deformation.cavity.centreY * imageHeight,
      radiusX: deformation.cavity.radiusX * imageWidth,
      radiusY: Math.max(0.1, deformation.cavity.maxRadiusY * imageHeight * amount),
    },
    upper: {
      source: upperSource,
      destination: { ...upperSource, y: upperSource.y - upperOffset },
    },
    lower: {
      source: lowerSource,
      destination: { ...lowerSource, y: lowerSource.y + lowerOffset },
    },
  };
}
