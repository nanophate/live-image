import { clampState, IdleBehavior, ZERO_STATE, type ControlState } from "./behavior.js";
import { clamp, smooth } from "./math.js";
import { validateManifest, type EyeFeature, type LivingImageManifest, type MouthFeature } from "./schema.js";
import { drawGridWarp, eyeWarpGrids, mouthOpenPlan } from "./warp.js";

export type StatePatch = Partial<ControlState>;

/** Shared pulse shape for interactive blinks and deterministic visual checks. */
export const DEFAULT_BLINK_PULSE_DURATION_SECONDS = 0.16;
export const BLINK_PULSE_CLOSE_FRACTION = 0.42;

export function blinkPulseAmount(elapsedSeconds: number, durationSeconds: number): number {
  if (!Number.isFinite(elapsedSeconds) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  const phase = elapsedSeconds / durationSeconds;
  if (phase < 0 || phase > 1) return 0;
  return phase < BLINK_PULSE_CLOSE_FRACTION
    ? phase / BLINK_PULSE_CLOSE_FRACTION
    : (1 - phase) / (1 - BLINK_PULSE_CLOSE_FRACTION);
}

export class LivingImagePlayer {
  private readonly context: CanvasRenderingContext2D;
  private manifest: LivingImageManifest | null = null;
  private image: HTMLImageElement | null = null;
  private behavior: IdleBehavior | null = null;
  private manualState: ControlState = { ...ZERO_STATE };
  private renderedState: ControlState = { ...ZERO_STATE };
  private autoIdle = true;
  private elapsed = 0;
  private previousTimestamp: number | null = null;
  private animationFrame: number | null = null;
  private blinkPulseStart = Number.NEGATIVE_INFINITY;
  private blinkPulseDuration = DEFAULT_BLINK_PULSE_DURATION_SECONDS;
  private eyeProtectionLayers = new Map<string, HTMLCanvasElement>();
  private loadGeneration = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas 2D is not available");
    this.context = context;
    this.context.imageSmoothingEnabled = true;
    this.context.imageSmoothingQuality = "high";
  }

  async load(manifest: LivingImageManifest): Promise<void> {
    validateManifest(manifest);
    const generation = ++this.loadGeneration;
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("embedded source image could not be decoded"));
      image.src = manifest.image.dataUrl;
    });
    if (image.naturalWidth !== manifest.image.width || image.naturalHeight !== manifest.image.height) {
      throw new Error("embedded source image dimensions do not match its manifest");
    }
    const protectionLayers = await this.buildEyeProtectionLayers(manifest, image);
    if (generation !== this.loadGeneration) return;
    this.manifest = manifest;
    this.image = image;
    this.eyeProtectionLayers = protectionLayers;
    this.behavior = new IdleBehavior(manifest);
    this.elapsed = 0;
    this.previousTimestamp = null;
    this.manualState = { ...ZERO_STATE };
    this.renderedState = { ...ZERO_STATE };
    this.canvas.width = manifest.image.width;
    this.canvas.height = manifest.image.height;
    this.render();
  }

  setState(patch: StatePatch): void {
    this.manualState = clampState({ ...this.manualState, ...patch });
  }

  getState(): Readonly<ControlState> {
    return { ...this.renderedState };
  }

  resetState(): void {
    this.manualState = { ...ZERO_STATE };
  }

  setAutoIdle(enabled: boolean): void {
    this.autoIdle = enabled;
  }

  triggerBlink(duration = DEFAULT_BLINK_PULSE_DURATION_SECONDS): void {
    this.blinkPulseDuration = Math.max(0.06, duration);
    this.blinkPulseStart = this.elapsed;
  }

  start(): void {
    if (this.animationFrame !== null) return;
    const frame = (timestamp: number): void => {
      if (this.previousTimestamp === null) this.previousTimestamp = timestamp;
      const delta = Math.min(0.05, Math.max(0, (timestamp - this.previousTimestamp) / 1000));
      this.previousTimestamp = timestamp;
      this.step(delta);
      this.animationFrame = requestAnimationFrame(frame);
    };
    this.animationFrame = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.previousTimestamp = null;
  }

  destroy(): void {
    this.loadGeneration += 1;
    this.stop();
  }

  step(deltaSeconds: number): void {
    if (!this.manifest || !this.image || !this.behavior) return;
    const delta = clamp(deltaSeconds, 0, 0.1);
    this.elapsed += delta;
    const idle = this.autoIdle ? this.behavior.sample(this.elapsed) : ZERO_STATE;
    const pulse = blinkPulseAmount(this.elapsed - this.blinkPulseStart, this.blinkPulseDuration);
    const target = clampState({
      blinkLeft: Math.max(this.manualState.blinkLeft, idle.blinkLeft, pulse),
      blinkRight: Math.max(this.manualState.blinkRight, idle.blinkRight, pulse),
      gazeX: this.manualState.gazeX + idle.gazeX * (1 - Math.abs(this.manualState.gazeX)),
      gazeY: this.manualState.gazeY + idle.gazeY * (1 - Math.abs(this.manualState.gazeY)),
      mouthOpen: this.manualState.mouthOpen,
      breath: this.manualState.breath + idle.breath * (1 - Math.abs(this.manualState.breath)),
    });
    this.applyCapabilityGate(target);
    const smoothing = this.manifest.behavior.smoothing;
    this.renderedState = {
      blinkLeft: target.blinkLeft,
      blinkRight: target.blinkRight,
      gazeX: smooth(this.renderedState.gazeX, target.gazeX, smoothing.gaze, delta),
      gazeY: smooth(this.renderedState.gazeY, target.gazeY, smoothing.gaze, delta),
      mouthOpen: smooth(this.renderedState.mouthOpen, target.mouthOpen, smoothing.mouth, delta),
      breath: smooth(this.renderedState.breath, target.breath, 5, delta),
    };
    this.render();
  }

  private applyCapabilityGate(state: ControlState): void {
    if (!this.manifest) return;
    const disabled = new Set(this.manifest.quality.disabledCapabilities);
    if (disabled.has("blink")) state.blinkLeft = state.blinkRight = 0;
    if (disabled.has("gaze")) state.gazeX = state.gazeY = 0;
    if (disabled.has("mouth")) state.mouthOpen = 0;
    if (this.manifest.quality.status === "reject") {
      state.blinkLeft = state.blinkRight = state.gazeX = state.gazeY = state.mouthOpen = 0;
    }
  }

  private render(): void {
    const manifest = this.manifest;
    const image = this.image;
    if (!manifest || !image) return;
    const { width, height } = manifest.image;
    const context = this.context;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.save();
    const breathRig = manifest.rig.breath;
    const breath = this.renderedState.breath;
    const pivotY = breathRig.pivotY * height;
    context.translate(0, -breath * breathRig.maxLift * height);
    context.translate(0, pivotY);
    context.scale(1, 1 + breath * breathRig.maxScaleY);
    context.translate(0, -pivotY);
    context.drawImage(image, 0, 0, width, height);

    for (const eye of manifest.analysis.features.eyes) this.drawEye(eye, image, width, height);
    this.drawMouth(manifest.analysis.features.mouth, image, width, height);
    context.restore();
  }

  private drawEye(eye: EyeFeature, image: HTMLImageElement, width: number, height: number): void {
    const blink = eye.side === "left" ? this.renderedState.blinkLeft : this.renderedState.blinkRight;
    if (blink <= 0.001 && Math.abs(this.renderedState.gazeX) <= 0.001 && Math.abs(this.renderedState.gazeY) <= 0.001) return;
    const grids = eyeWarpGrids(eye, width, height, blink, this.renderedState.gazeX, this.renderedState.gazeY);
    drawGridWarp(this.context, image, grids.source, grids.destination);
    const protectedLayer = this.eyeProtectionLayers.get(eye.side);
    const protectionRegion = eye.rig.deformation?.region;
    if (protectedLayer && protectionRegion) {
      this.context.drawImage(
        protectedLayer,
        protectionRegion.x * width,
        protectionRegion.y * height,
        protectionRegion.width * width,
        protectionRegion.height * height,
      );
    }
  }

  private drawMouth(mouth: MouthFeature, image: HTMLImageElement, width: number, height: number): void {
    const open = this.renderedState.mouthOpen;
    if (open <= 0.001) return;
    const boundedPlan = mouthOpenPlan(mouth, width, height, open);
    if (boundedPlan) {
      const context = this.context;
      const region = mouth.region;
      context.save();
      context.beginPath();
      context.rect(region.x * width, region.y * height, region.width * width, region.height * height);
      context.clip();
      context.fillStyle = mouth.rig.interiorColour;
      context.beginPath();
      context.ellipse(
        boundedPlan.cavity.centreX,
        boundedPlan.cavity.centreY,
        boundedPlan.cavity.radiusX,
        boundedPlan.cavity.radiusY,
        0,
        0,
        Math.PI * 2,
      );
      context.fill();

      const bandClipRadiusY = boundedPlan.cavity.radiusY + Math.max(
        boundedPlan.upper.source.height,
        boundedPlan.lower.source.height,
      );
      context.beginPath();
      context.ellipse(
        boundedPlan.cavity.centreX,
        boundedPlan.cavity.centreY,
        boundedPlan.cavity.radiusX * 1.08,
        bandClipRadiusY,
        0,
        0,
        Math.PI * 2,
      );
      context.clip();
      for (const band of [boundedPlan.upper, boundedPlan.lower]) {
        context.drawImage(
          image,
          band.source.x,
          band.source.y,
          band.source.width,
          band.source.height,
          band.destination.x,
          band.destination.y,
          band.destination.width,
          band.destination.height,
        );
      }
      context.restore();
      return;
    }

    const region = mouth.region;
    const x0 = region.x * width;
    const y0 = region.y * height;
    const x1 = (region.x + region.width) * width;
    const y1 = (region.y + region.height) * height;
    const centreX = mouth.anchors.centreX * width;
    const centreY = mouth.anchors.centreY * height;
    const mouthWidth = (mouth.anchors.right - mouth.anchors.left) * width;
    const gap = mouth.rig.maxOpen * height * clamp(open, 0, 1);
    const context = this.context;

    context.save();
    context.beginPath();
    context.rect(x0, y0, x1 - x0, y1 - y0);
    context.clip();
    context.fillStyle = mouth.rig.interiorColour;
    context.beginPath();
    context.ellipse(centreX, centreY, mouthWidth * 0.40, Math.max(1, gap * 0.62), 0, 0, Math.PI * 2);
    context.fill();

    const topSourceHeight = Math.max(1, centreY - y0);
    const topDestinationHeight = Math.max(1, topSourceHeight - gap * 0.5);
    context.drawImage(image, x0, y0, x1 - x0, topSourceHeight, x0, y0, x1 - x0, topDestinationHeight);
    const bottomSourceHeight = Math.max(1, y1 - centreY);
    const bottomDestinationY = centreY + gap * 0.5;
    context.drawImage(image, x0, centreY, x1 - x0, bottomSourceHeight, x0, bottomDestinationY, x1 - x0, Math.max(1, y1 - bottomDestinationY));
    context.restore();
  }

  private async buildEyeProtectionLayers(
    manifest: LivingImageManifest,
    image: HTMLImageElement,
  ): Promise<Map<string, HTMLCanvasElement>> {
    const layers = new Map<string, HTMLCanvasElement>();
    await Promise.all(manifest.analysis.features.eyes.map(async (eye) => {
      const deformation = eye.rig.deformation;
      if (!deformation) return;
      const maskDefinition = deformation.protectedLineArtMask;
      const mask = new Image();
      mask.decoding = "async";
      await new Promise<void>((resolve, reject) => {
        mask.onload = () => resolve();
        mask.onerror = () => reject(new Error(`${eye.side} protected line-art mask could not be decoded`));
        mask.src = maskDefinition.dataUrl;
      });
      if (mask.naturalWidth !== maskDefinition.width || mask.naturalHeight !== maskDefinition.height) {
        throw new Error(`${eye.side} protected line-art mask dimensions do not match its manifest`);
      }
      const layer = document.createElement("canvas");
      layer.width = maskDefinition.width;
      layer.height = maskDefinition.height;
      const layerContext = layer.getContext("2d");
      if (!layerContext) throw new Error("Canvas 2D is not available for protected line art");
      const region = deformation.region;
      layerContext.drawImage(
        image,
        region.x * manifest.image.width,
        region.y * manifest.image.height,
        region.width * manifest.image.width,
        region.height * manifest.image.height,
        0,
        0,
        layer.width,
        layer.height,
      );
      layerContext.globalCompositeOperation = "destination-in";
      layerContext.drawImage(mask, 0, 0, layer.width, layer.height);
      layerContext.globalCompositeOperation = "source-over";
      layers.set(eye.side, layer);
    }));
    return layers;
  }
}
