import { ZERO_STATE, type ControlState } from "./behavior.js";
import { clamp, easeInOut } from "./math.js";
import type { RuntimeCapabilities } from "./runtime.js";

export const SHOWCASE_DURATION_SECONDS = 6.4;

export interface ShowcaseFrame {
  state: ControlState;
  label: string;
  progress: number;
}

function windowAmount(time: number, start: number, end: number, edge = 0.24): number {
  if (time <= start || time >= end) return 0;
  return Math.min(
    easeInOut((time - start) / edge),
    easeInOut((end - time) / edge),
  );
}

function blinkAmount(time: number, start: number, duration: number): number {
  const phase = (time - start) / duration;
  if (phase < 0 || phase > 1) return 0;
  return phase < 0.42
    ? easeInOut(phase / 0.42)
    : easeInOut((1 - phase) / 0.58);
}

/** Deterministic product showcase that never bypasses compiler capabilities. */
export function showcaseFrameAt(elapsedSeconds: number, capabilities: RuntimeCapabilities): ShowcaseFrame {
  const time = clamp(elapsedSeconds, 0, SHOWCASE_DURATION_SECONDS);
  const progress = time / SHOWCASE_DURATION_SECONDS;
  if (!capabilities.loaded || capabilities.status === "reject") {
    return { state: { ...ZERO_STATE }, label: "Not playable", progress };
  }

  const fade = Math.min(
    easeInOut(time / 0.45),
    easeInOut((SHOWCASE_DURATION_SECONDS - time) / 0.65),
  );
  const leftLook = windowAmount(time, 0.65, 1.72);
  const rightLook = windowAmount(time, 1.82, 2.88);
  const talk = windowAmount(time, 3.05, 4.28, 0.18)
    * (0.18 + 0.58 * Math.sin((time - 3.05) * Math.PI * 4.1) ** 2);
  const blink = Math.max(
    blinkAmount(time, 2.30, 0.20),
    blinkAmount(time, 3.60, 0.18),
  );
  const wink = blinkAmount(time, 4.62, 0.32);
  const state: ControlState = {
    blinkLeft: capabilities.blink ? Math.max(blink, wink) : 0,
    blinkRight: capabilities.blink ? blink : 0,
    gazeX: capabilities.gaze ? (-0.62 * leftLook + 0.62 * rightLook + 0.16 * talk) : 0,
    gazeY: capabilities.gaze && talk > 0 ? -0.10 * talk : 0,
    mouthOpen: capabilities.mouth ? talk : 0,
    breath: capabilities.breath ? 0.30 * Math.sin(time * Math.PI * 0.72) * fade : 0,
  };

  let label = "Natural idle";
  if (time >= 0.65 && time < 1.72 && capabilities.gaze) label = "Look left";
  else if (time >= 1.82 && time < 2.88 && capabilities.gaze) label = "Look right + blink";
  else if (time >= 3.05 && time < 4.28 && capabilities.mouth) label = "Talk reaction";
  else if (time >= 4.62 && time < 4.94 && capabilities.blink) label = "Wink";
  else if (time >= 5.1) label = "Return to idle";
  return { state, label, progress };
}
