import assert from "node:assert/strict";
import test from "node:test";

import { measureRgbaLocality } from "../src/motion-comparison.js";
import type { Rect } from "../src/schema.js";

function rgbaFrame(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4);
}

function setPixel(
  frame: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  rgba: readonly [number, number, number, number],
): void {
  frame.set(rgba, (y * width + x) * 4);
}

test("locality counts an in-region RGBA change as a visible effect", () => {
  const baseline = rgbaFrame(4, 3);
  const frame = new Uint8ClampedArray(baseline);
  setPixel(frame, 4, 1, 1, [10, 80, 20, 255]);

  assert.deepEqual(
    measureRgbaLocality(baseline, frame, 4, 3, [
      { x: 0.25, y: 1 / 3, width: 0.25, height: 1 / 3 },
    ]),
    {
      insideChangedPixels: 1,
      outsideChangedPixels: 0,
      maxChannelDelta: 255,
      visibleEffect: true,
    },
  );
});

test("locality reports outside leakage separately from the intended effect", () => {
  const baseline = rgbaFrame(3, 2);
  const frame = new Uint8ClampedArray(baseline);
  setPixel(frame, 3, 0, 0, [12, 0, 0, 0]);
  setPixel(frame, 3, 2, 1, [0, 0, 91, 0]);

  assert.deepEqual(
    measureRgbaLocality(baseline, frame, 3, 2, [
      { x: 0, y: 0, width: 1 / 3, height: 0.5 },
    ]),
    {
      insideChangedPixels: 1,
      outsideChangedPixels: 1,
      maxChannelDelta: 91,
      visibleEffect: true,
    },
  );
});

test("an unchanged frame has no visible effect or leakage", () => {
  const baseline = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);

  assert.deepEqual(
    measureRgbaLocality(baseline, new Uint8ClampedArray(baseline), 2, 1, []),
    {
      insideChangedPixels: 0,
      outsideChangedPixels: 0,
      maxChannelDelta: 0,
      visibleEffect: false,
    },
  );
});

test("outside-only changes are leakage and not an intended visible effect", () => {
  const baseline = rgbaFrame(2, 1);
  const frame = new Uint8ClampedArray(baseline);
  setPixel(frame, 2, 1, 0, [25, 0, 0, 0]);

  assert.deepEqual(
    measureRgbaLocality(baseline, frame, 2, 1, [
      { x: 0, y: 0, width: 0.5, height: 1 },
    ]),
    {
      insideChangedPixels: 0,
      outsideChangedPixels: 1,
      maxChannelDelta: 25,
      visibleEffect: false,
    },
  );
});

test("pixel padding expands allowed bounds without floating-point overreach", () => {
  const baseline = rgbaFrame(5, 1);
  const frame = new Uint8ClampedArray(baseline);
  setPixel(frame, 5, 1, 0, [1, 0, 0, 0]);
  setPixel(frame, 5, 3, 0, [2, 0, 0, 0]);
  setPixel(frame, 5, 4, 0, [3, 0, 0, 0]);
  const region = { x: 0.4, y: 0, width: 0.2, height: 1 };

  assert.deepEqual(measureRgbaLocality(baseline, frame, 5, 1, [region], 1), {
    insideChangedPixels: 2,
    outsideChangedPixels: 1,
    maxChannelDelta: 3,
    visibleEffect: true,
  });
});

test("locality rejects malformed dimensions, arrays, padding, and rectangles", () => {
  const pixel = rgbaFrame(1, 1);
  const validRect: Rect = { x: 0, y: 0, width: 1, height: 1 };

  assert.throws(() => measureRgbaLocality(pixel, pixel, 0, 1, []), /positive safe integers/);
  assert.throws(() => measureRgbaLocality(pixel, pixel, 1.5, 1, []), /positive safe integers/);
  assert.throws(
    () => measureRgbaLocality(pixel, new Uint8ClampedArray(8), 1, 1, []),
    /exactly 4 channels/,
  );
  assert.throws(() => measureRgbaLocality(pixel, pixel, 1, 1, [], -1), /non-negative safe integer/);
  assert.throws(() => measureRgbaLocality(pixel, pixel, 1, 1, [], 0.5), /non-negative safe integer/);
  assert.throws(
    () => measureRgbaLocality(pixel, pixel, 1, 1, [{ ...validRect, x: Number.NaN }]),
    /finite values/,
  );
  assert.throws(
    () => measureRgbaLocality(pixel, pixel, 1, 1, [{ ...validRect, height: Number.POSITIVE_INFINITY }]),
    /finite values/,
  );
  assert.throws(
    () => measureRgbaLocality(pixel, pixel, 1, 1, [{ ...validRect, width: 0 }]),
    /positive normalized rectangle/,
  );
  assert.throws(
    () => measureRgbaLocality(pixel, pixel, 1, 1, [{ x: 0.5, y: 0, width: 0.6, height: 1 }]),
    /positive normalized rectangle/,
  );
});
