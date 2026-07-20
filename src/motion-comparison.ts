import { ZERO_STATE, type ControlState } from "./behavior.js";
import type { LivingImageManifest } from "./schema.js";

export type MotionCapability = "blink" | "gaze" | "mouth";
export type MotionComparisonPhase = "reference" | "acceptance" | "stress";

export const MOTION_SETTLE_FRAMES = 30;
export const MOTION_SETTLE_DELTA_SECONDS = 1 / 60;
export const MOTION_STATE_TOLERANCE = 0.005;

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

export function controlStateMaxError(expected: ControlState, actual: Readonly<ControlState>): number {
  return Math.max(...Object.keys(expected).map((key) => {
    const control = key as keyof ControlState;
    return Math.abs(expected[control] - actual[control]);
  }));
}
