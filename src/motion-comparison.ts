import { ZERO_STATE, type ControlState } from "./behavior.js";
import {
  blinkPulseAmount,
  DEFAULT_BLINK_PULSE_DURATION_SECONDS,
} from "./runtime.js";
import type { LivingImageManifest, Rect } from "./schema.js";

export type MotionCapability = "blink" | "gaze" | "mouth";
export type MotionComparisonPhase = "reference" | "acceptance" | "stress";

export const MOTION_SETTLE_FRAMES = 30;
export const MOTION_SETTLE_DELTA_SECONDS = 1 / 60;
export const MOTION_STATE_TOLERANCE = 0.005;
/**
 * A compact, fixed sampling of the runtime's actual blink pulse. The peak is
 * represented explicitly so an eyelid seam cannot be hidden between samples.
 */
export const BLINK_TRANSITION_TIME_FRACTIONS = [
  0, 0.1, 0.2, 0.3, 0.4, 0.42, 0.5, 0.625, 0.75, 0.875, 1,
] as const;

export interface MotionComparisonCell {
  id: string;
  label: string;
  capability: MotionCapability | null;
  phase: MotionComparisonPhase;
  requestedState: ControlState;
  status: "available" | "skipped";
  reason: string | null;
}

interface MotionScenario {
  id: string;
  label: string;
  capability: MotionCapability | null;
  phase: MotionComparisonPhase;
  patch: Partial<ControlState>;
}

export interface BlinkTransitionFrame {
  id: string;
  label: string;
  timeSeconds: number;
  blinkAmount: number;
  requestedState: ControlState;
}

export interface BlinkTransitionPlan {
  status: "available" | "skipped";
  reason: string | null;
  frames: BlinkTransitionFrame[];
}

export interface PixelDifference {
  differingPixels: number;
  maxChannelDelta: number;
}

export interface RgbaLocalityMetrics {
  insideChangedPixels: number;
  outsideChangedPixels: number;
  maxChannelDelta: number;
  visibleEffect: boolean;
}

export interface ProtectedMaskQualityMetrics {
  corePixels: number;
  coreErrorPixels: number;
  coreMaxRgbDelta: number;
  clearMaskPixels: number;
  clearMaskChangedPixels: number;
}

export interface ProtectedMaskQualityOptions {
  coreAlphaThreshold?: number;
  clearAlphaThreshold?: number;
  coreRgbTolerance?: number;
  regionInsetPixels?: number;
}

export interface AlignedAlphaMask {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  originX: number;
  originY: number;
}

const SCENARIOS: readonly MotionScenario[] = [
  { id: "neutral", label: "Neutral", capability: null, phase: "reference", patch: {} },
  { id: "blink-mid", label: "Blink 0.50", capability: "blink", phase: "acceptance", patch: { blinkLeft: 0.5, blinkRight: 0.5 } },
  { id: "blink-full", label: "Blink 1.00", capability: "blink", phase: "acceptance", patch: { blinkLeft: 1, blinkRight: 1 } },
  { id: "wink-left", label: "Wink left", capability: "blink", phase: "acceptance", patch: { blinkLeft: 1 } },
  { id: "wink-right", label: "Wink right", capability: "blink", phase: "acceptance", patch: { blinkRight: 1 } },
  { id: "gaze-left", label: "Gaze left 0.60", capability: "gaze", phase: "acceptance", patch: { gazeX: -0.6 } },
  { id: "gaze-right", label: "Gaze right 0.60", capability: "gaze", phase: "acceptance", patch: { gazeX: 0.6 } },
  { id: "gaze-up", label: "Gaze up 0.40", capability: "gaze", phase: "acceptance", patch: { gazeY: -0.4 } },
  { id: "gaze-down", label: "Gaze down 0.40", capability: "gaze", phase: "acceptance", patch: { gazeY: 0.4 } },
  { id: "mouth-small", label: "Mouth 0.35", capability: "mouth", phase: "acceptance", patch: { mouthOpen: 0.35 } },
  { id: "mouth-open", label: "Mouth 0.62", capability: "mouth", phase: "acceptance", patch: { mouthOpen: 0.62 } },
  { id: "stress-gaze-left", label: "Stress gaze −1", capability: "gaze", phase: "stress", patch: { gazeX: -1 } },
  { id: "stress-gaze-right", label: "Stress gaze +1", capability: "gaze", phase: "stress", patch: { gazeX: 1 } },
  { id: "stress-mouth", label: "Stress mouth 1", capability: "mouth", phase: "stress", patch: { mouthOpen: 1 } },
] as const;

/**
 * Produce the same acceptance and stress states for every compiled character.
 * Runtime rig limits remain responsible for translating controls to pixels.
 */
export function planMotionComparison(manifest: LivingImageManifest): MotionComparisonCell[] {
  const disabled = new Set(manifest.quality.disabledCapabilities);
  const rejected = manifest.quality.status === "reject";

  return SCENARIOS.map((scenario) => {
    const controlled = scenario.capability !== null;
    const status = controlled && (rejected || disabled.has(scenario.capability!)) ? "skipped" : "available";
    const reason = status === "skipped"
      ? rejected
        ? "Asset rejected by compiler"
        : `${scenario.capability} disabled by compiler`
      : null;
    return {
      id: scenario.id,
      label: scenario.label,
      capability: scenario.capability,
      phase: scenario.phase,
      requestedState: { ...ZERO_STATE, ...scenario.patch },
      status,
      reason,
    };
  });
}

/**
 * Plan a bounded close/reopen strip from the exact pulse curve used by the
 * runtime. The same frame list is used for every character; only its rig maps
 * normalized blink values into pixels.
 */
export function planBlinkTransition(manifest: LivingImageManifest): BlinkTransitionPlan {
  const rejected = manifest.quality.status === "reject";
  const blinkDisabled = manifest.quality.disabledCapabilities.includes("blink");
  if (rejected || blinkDisabled) {
    return {
      status: "skipped",
      reason: rejected ? "Asset rejected by compiler" : "blink disabled by compiler",
      frames: [],
    };
  }

  return {
    status: "available",
    reason: null,
    frames: BLINK_TRANSITION_TIME_FRACTIONS.map((fraction, index) => {
      const timeSeconds = fraction * DEFAULT_BLINK_PULSE_DURATION_SECONDS;
      const blinkAmount = blinkPulseAmount(timeSeconds, DEFAULT_BLINK_PULSE_DURATION_SECONDS);
      const direction = fraction <= 0.42 ? "close" : "reopen";
      return {
        id: `blink-transition-${index}`,
        label: index === 0 || index === BLINK_TRANSITION_TIME_FRACTIONS.length - 1
          ? "open"
          : `${direction} ${Math.round(blinkAmount * 100)}%`,
        timeSeconds,
        blinkAmount,
        requestedState: { ...ZERO_STATE, blinkLeft: blinkAmount, blinkRight: blinkAmount },
      };
    }),
  };
}

/** Compare equally-sized RGBA frames without retaining full-resolution canvases. */
export function compareRgbaPixels(
  first: Uint8ClampedArray,
  second: Uint8ClampedArray,
): PixelDifference {
  if (first.length !== second.length || first.length % 4 !== 0) {
    throw new Error("RGBA frames must have the same pixel dimensions");
  }
  let differingPixels = 0;
  let maxChannelDelta = 0;
  for (let offset = 0; offset < first.length; offset += 4) {
    let pixelDiffers = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs((first[offset + channel] ?? 0) - (second[offset + channel] ?? 0));
      if (delta > 0) pixelDiffers = true;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
    }
    if (pixelDiffers) differingPixels += 1;
  }
  return { differingPixels, maxChannelDelta };
}

/**
 * Measure whether a full-resolution RGBA change stays inside compiler-authored
 * normalized regions. A pixel is allowed when its area intersects a region;
 * pixel padding expands those resulting integer bounds before clipping them to
 * the frame. `visibleEffect` deliberately requires an in-region change, so an
 * outside-only rendering leak is not mistaken for an intended motion effect.
 */
export function measureRgbaLocality(
  baseline: Uint8ClampedArray,
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  allowedRects: readonly Rect[],
  pixelPadding = 0,
): RgbaLocalityMetrics {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error("RGBA frame width and height must be positive safe integers");
  }
  const expectedLength = width * height * 4;
  if (!Number.isSafeInteger(expectedLength)) {
    throw new Error("RGBA frame dimensions are too large");
  }
  if (baseline.length !== expectedLength || frame.length !== expectedLength) {
    throw new Error(`RGBA frames must each contain exactly ${expectedLength} channels`);
  }
  if (!Number.isSafeInteger(pixelPadding) || pixelPadding < 0) {
    throw new Error("Pixel padding must be a non-negative safe integer");
  }
  if (!Array.isArray(allowedRects)) {
    throw new Error("Allowed rectangles must be an array");
  }

  const snapPixelBoundary = (value: number): number => {
    const nearestInteger = Math.round(value);
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * 8;
    return Math.abs(value - nearestInteger) <= tolerance ? nearestInteger : value;
  };
  const pixelBounds = allowedRects.map((rect, index) => {
    if (rect === null || typeof rect !== "object") {
      throw new Error(`Allowed rectangle ${index} must be an object`);
    }
    const values = [rect.x, rect.y, rect.width, rect.height];
    if (!values.every(Number.isFinite)) {
      throw new Error(`Allowed rectangle ${index} must contain finite values`);
    }
    if (
      rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0
      || rect.x + rect.width > 1 || rect.y + rect.height > 1
    ) {
      throw new Error(`Allowed rectangle ${index} must be a positive normalized rectangle`);
    }
    const left = snapPixelBoundary(rect.x * width);
    const top = snapPixelBoundary(rect.y * height);
    const right = snapPixelBoundary((rect.x + rect.width) * width);
    const bottom = snapPixelBoundary((rect.y + rect.height) * height);
    return {
      left: Math.max(0, Math.floor(left) - pixelPadding),
      top: Math.max(0, Math.floor(top) - pixelPadding),
      right: Math.min(width, Math.ceil(right) + pixelPadding),
      bottom: Math.min(height, Math.ceil(bottom) + pixelPadding),
    };
  });

  let insideChangedPixels = 0;
  let outsideChangedPixels = 0;
  let maxChannelDelta = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      let pixelDiffers = false;
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs((baseline[offset + channel] ?? 0) - (frame[offset + channel] ?? 0));
        if (delta > 0) pixelDiffers = true;
        maxChannelDelta = Math.max(maxChannelDelta, delta);
      }
      if (!pixelDiffers) continue;
      const inside = pixelBounds.some((bounds) => (
        x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom
      ));
      if (inside) insideChangedPixels += 1;
      else outsideChangedPixels += 1;
    }
  }

  return {
    insideChangedPixels,
    outsideChangedPixels,
    maxChannelDelta,
    visibleEffect: insideChangedPixels > 0,
  };
}

/**
 * Measure the two complementary contracts of a compiler-authored eye mask.
 * Opaque protected-core pixels must retain their canonical RGB, while
 * clear-mask pixels must still show the requested motion. Sampling is performed
 * in full-resolution destination pixels so the result covers the same mask
 * scaling and placement used by Canvas.
 */
export function measureProtectedMaskQuality(
  baseline: Uint8ClampedArray,
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Readonly<AlignedAlphaMask>,
  region: Rect,
  options: Readonly<ProtectedMaskQualityOptions> = {},
): ProtectedMaskQualityMetrics {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error("RGBA frame width and height must be positive safe integers");
  }
  const expectedLength = width * height * 4;
  if (!Number.isSafeInteger(expectedLength) || baseline.length !== expectedLength || frame.length !== expectedLength) {
    throw new Error(`RGBA frames must each contain exactly ${expectedLength} channels`);
  }
  if (!Number.isSafeInteger(mask.width) || mask.width <= 0 || !Number.isSafeInteger(mask.height) || mask.height <= 0) {
    throw new Error("Aligned mask width and height must be positive safe integers");
  }
  if (!Number.isSafeInteger(mask.originX) || !Number.isSafeInteger(mask.originY)) {
    throw new Error("Aligned mask origin must contain safe integers");
  }
  if (mask.data.length !== mask.width * mask.height) {
    throw new Error(`Aligned mask alpha must contain exactly ${mask.width * mask.height} values`);
  }
  if (
    !Number.isFinite(region.x) || !Number.isFinite(region.y)
    || !Number.isFinite(region.width) || !Number.isFinite(region.height)
    || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
    || region.x + region.width > 1 || region.y + region.height > 1
  ) {
    throw new Error("Mask region must be a positive normalized rectangle");
  }

  const coreAlphaThreshold = options.coreAlphaThreshold ?? 255;
  const clearAlphaThreshold = options.clearAlphaThreshold ?? 0;
  const coreRgbTolerance = options.coreRgbTolerance ?? 1;
  const regionInsetPixels = options.regionInsetPixels ?? 1;
  for (const [label, value] of [
    ["core alpha threshold", coreAlphaThreshold],
    ["clear alpha threshold", clearAlphaThreshold],
    ["core RGB tolerance", coreRgbTolerance],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
      throw new Error(`${label} must be an 8-bit safe integer`);
    }
  }
  if (clearAlphaThreshold >= coreAlphaThreshold) {
    throw new Error("Clear alpha threshold must be lower than core alpha threshold");
  }
  if (!Number.isSafeInteger(regionInsetPixels) || regionInsetPixels < 0) {
    throw new Error("Region inset must be a non-negative safe integer");
  }

  const left = region.x * width;
  const top = region.y * height;
  const regionWidth = region.width * width;
  const regionHeight = region.height * height;
  const x0 = Math.max(0, Math.floor(left) + regionInsetPixels);
  const y0 = Math.max(0, Math.floor(top) + regionInsetPixels);
  const x1 = Math.min(width, Math.ceil(left + regionWidth) - regionInsetPixels);
  const y1 = Math.min(height, Math.ceil(top + regionHeight) - regionInsetPixels);
  if (
    Math.floor(left) < mask.originX || Math.floor(top) < mask.originY
    || Math.ceil(left + regionWidth) > mask.originX + mask.width
    || Math.ceil(top + regionHeight) > mask.originY + mask.height
  ) {
    throw new Error("Aligned mask does not cover its normalized region");
  }

  let corePixels = 0;
  let coreErrorPixels = 0;
  let coreMaxRgbDelta = 0;
  let clearMaskPixels = 0;
  let clearMaskChangedPixels = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const alpha = mask.data[(y - mask.originY) * mask.width + (x - mask.originX)] ?? 0;
      if (alpha < coreAlphaThreshold && alpha > clearAlphaThreshold) continue;
      const offset = (y * width + x) * 4;
      let maxRgbDelta = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        maxRgbDelta = Math.max(
          maxRgbDelta,
          Math.abs((baseline[offset + channel] ?? 0) - (frame[offset + channel] ?? 0)),
        );
      }
      if (alpha >= coreAlphaThreshold) {
        corePixels += 1;
        coreMaxRgbDelta = Math.max(coreMaxRgbDelta, maxRgbDelta);
        if (maxRgbDelta > coreRgbTolerance) coreErrorPixels += 1;
      } else {
        clearMaskPixels += 1;
        if (maxRgbDelta > 0) clearMaskChangedPixels += 1;
      }
    }
  }

  return { corePixels, coreErrorPixels, coreMaxRgbDelta, clearMaskPixels, clearMaskChangedPixels };
}

export function controlStateMaxError(expected: ControlState, actual: Readonly<ControlState>): number {
  return Math.max(...Object.keys(expected).map((key) => {
    const control = key as keyof ControlState;
    return Math.abs(expected[control] - actual[control]);
  }));
}
