import type { EyeFeature } from "./schema.js";
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
  context.drawImage(image, 0, 0);
  context.restore();
}

export function drawGridWarp(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  source: readonly (readonly Vec2[])[],
  destination: readonly (readonly Vec2[])[],
): void {
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
      drawTexturedTriangle(context, image, [s00, s10, s11], [d00, d10, d11]);
      drawTexturedTriangle(context, image, [s00, s11, s01], [d00, d11, d01]);
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
  const sourceYs = [y0, eyeTop, eyeBottom, y1];
  const source = sourceYs.map((y) => sourceXs.map((x) => ({ x, y })));
  const blink = clamp(blinkValue, 0, 1);
  const centreY = eye.anchors.centreY * imageHeight;
  const floor = eye.rig.blinkFloor * imageHeight;
  const closedTop = centreY - floor * 0.5;
  const closedBottom = centreY + floor * 0.5;
  const innerTop = mix(eyeTop, closedTop, blink);
  const innerBottom = mix(eyeBottom, closedBottom, blink);
  const gazeSuppression = 1 - blink;
  const shiftX = clamp(gazeX, -1, 1) * eye.rig.maxGazeX * imageWidth * gazeSuppression;
  const shiftY = clamp(gazeY, -1, 1) * eye.rig.maxGazeY * imageHeight * gazeSuppression;

  const destination = source.map((row, rowIndex) => row.map((point, columnIndex) => {
    const innerRow = rowIndex === 1 || rowIndex === 2;
    let y = point.y;
    if (rowIndex === 1) y = innerTop;
    if (rowIndex === 2) y = innerBottom;
    const columnWeight = columnIndex === 2 ? 1 : 0;
    return {
      x: point.x + (innerRow ? shiftX * columnWeight : 0),
      y: y + (innerRow ? shiftY * columnWeight : 0),
    };
  }));
  return { source, destination };
}
