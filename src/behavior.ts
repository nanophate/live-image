import type { LivingImageManifest } from "./schema.js";
import { clamp, easeInOut, mulberry32 } from "./math.js";

export interface ControlState {
  blinkLeft: number;
  blinkRight: number;
  gazeX: number;
  gazeY: number;
  mouthOpen: number;
  breath: number;
}

export const ZERO_STATE: Readonly<ControlState> = Object.freeze({
  blinkLeft: 0,
  blinkRight: 0,
  gazeX: 0,
  gazeY: 0,
  mouthOpen: 0,
  breath: 0,
});

export class IdleBehavior {
  private readonly random: () => number;
  private nextBlink: number;
  private blinkStart = Number.POSITIVE_INFINITY;

  constructor(private readonly manifest: LivingImageManifest) {
    this.random = mulberry32(manifest.behavior.seed);
    this.nextBlink = manifest.behavior.blink.interval * (0.72 + this.random() * 0.4);
  }

  reset(): void {
    this.nextBlink = this.manifest.behavior.blink.interval * (0.72 + this.random() * 0.4);
    this.blinkStart = Number.POSITIVE_INFINITY;
  }

  sample(timeSeconds: number): ControlState {
    const blink = this.manifest.behavior.blink;
    while (timeSeconds >= this.nextBlink) {
      this.blinkStart = this.nextBlink;
      this.nextBlink += blink.interval + (this.random() * 2 - 1) * blink.jitter;
      this.nextBlink = Math.max(this.nextBlink, this.blinkStart + blink.duration + 0.2);
    }
    const phase = (timeSeconds - this.blinkStart) / blink.duration;
    let blinkAmount = 0;
    if (phase >= 0 && phase <= 1) {
      blinkAmount = phase < 0.42 ? easeInOut(phase / 0.42) : easeInOut((1 - phase) / 0.58);
    }
    const breath = Math.sin((timeSeconds / this.manifest.behavior.breath.period) * Math.PI * 2);
    const gazeX = 0.26 * Math.sin(timeSeconds * 0.47 + 0.4);
    const gazeY = 0.15 * Math.sin(timeSeconds * 0.31 - 0.7);
    return { blinkLeft: blinkAmount, blinkRight: blinkAmount, gazeX, gazeY, mouthOpen: 0, breath };
  }
}

export function clampState(state: ControlState): ControlState {
  return {
    blinkLeft: clamp(state.blinkLeft, 0, 1),
    blinkRight: clamp(state.blinkRight, 0, 1),
    gazeX: clamp(state.gazeX, -1, 1),
    gazeY: clamp(state.gazeY, -1, 1),
    mouthOpen: clamp(state.mouthOpen, 0, 1),
    breath: clamp(state.breath, -1, 1),
  };
}
