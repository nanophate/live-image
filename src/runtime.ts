import { clampState, IdleBehavior, ZERO_STATE, type ControlState } from "./behavior.js";
import { clamp, easeInOut, smooth } from "./math.js";
import { drawSemanticMeshWarp, planEyeSemanticMesh } from "./semantic-mesh.js";
import { validateManifest, type EyeFeature, type LivingImageManifest, type MouthFeature } from "./schema.js";
import { drawGridWarp, eyeIrisPlan, eyeWarpGrids, mouthOpenPlan } from "./warp.js";

export type StatePatch = Partial<ControlState>;

interface EyeIrisLayers {
  baseEye: HTMLImageElement;
  texture: HTMLImageElement;
}

export type EyeDeformationMode = "row-grid" | "semantic-mesh-required" | "semantic-mesh-corrective-required";

export interface LivingImagePlayerOptions {
  eyeDeformation?: EyeDeformationMode;
}

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
  private eyeIrisLayers = new Map<string, EyeIrisLayers>();
  private eyeCorrectiveLayers = new Map<string, HTMLImageElement>();
  private loadGeneration = 0;
  private readonly eyeDeformationMode: EyeDeformationMode;

  constructor(readonly canvas: HTMLCanvasElement, options: LivingImagePlayerOptions = {}) {
    this.eyeDeformationMode = options.eyeDeformation ?? "row-grid";
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
    const [protectionLayers, irisLayers, correctiveLayers] = await Promise.all([
      this.buildEyeProtectionLayers(manifest, image),
      this.buildEyeIrisLayers(manifest),
      this.buildEyeCorrectiveLayers(manifest),
    ]);
    if (generation !== this.loadGeneration) return;
    this.manifest = manifest;
    this.image = image;
    this.eyeProtectionLayers = protectionLayers;
    this.eyeIrisLayers = irisLayers;
    this.eyeCorrectiveLayers = correctiveLayers;
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
      state.blinkLeft = state.blinkRight = state.gazeX = state.gazeY = state.mouthOpen = state.breath = 0;
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
    const deformation = eye.rig.deformation;
    const semanticMesh = deformation?.semanticMesh;
    const semanticRequired = this.eyeDeformationMode !== "row-grid";
    const semanticPlan = semanticRequired && blink > 0.001
      ? (() => {
          if (!semanticMesh) throw new Error(`${eye.side} eye is missing its required semantic mesh`);
          return planEyeSemanticMesh(semanticMesh, width, height, blink);
        })()
      : null;
    const irisLayers = this.eyeIrisLayers.get(eye.side);
    const irisPlan = eyeIrisPlan(
      eye,
      width,
      height,
      blink,
      this.renderedState.gazeX,
      this.renderedState.gazeY,
      semanticPlan?.aperture,
    );
    if (semanticPlan && (!semanticMesh || !irisLayers || !irisPlan)) {
      throw new Error(`${eye.side} semantic eye mesh requires decoded iris/base-eye layers and an aperture`);
    }
    const grids = irisLayers && irisPlan
      ? eyeWarpGrids(eye, width, height, blink, 0, 0)
      : eyeWarpGrids(eye, width, height, blink, this.renderedState.gazeX, this.renderedState.gazeY);
    if (irisLayers && irisPlan) {
      const region = deformation?.region;
      if (!region) throw new Error(`${eye.side} iris layer is missing its deformation region`);
      if (semanticPlan && semanticMesh) {
        drawSemanticMeshWarp(this.context, irisLayers.baseEye, semanticMesh, semanticPlan, {
          sourceOrigin: { x: region.x * width, y: region.y * height },
        });
      } else {
        drawGridWarp(this.context, irisLayers.baseEye, grids.source, grids.destination, {
          sourceOrigin: { x: region.x * width, y: region.y * height },
        });
      }
      if (irisPlan.alpha > 0) {
        this.context.save();
        this.context.beginPath();
        for (const [index, point] of irisPlan.aperture.entries()) {
          if (index === 0) this.context.moveTo(point.x, point.y);
          else this.context.lineTo(point.x, point.y);
        }
        this.context.closePath();
        this.context.clip();
        this.context.globalAlpha = irisPlan.alpha;
        this.context.drawImage(
          irisLayers.texture,
          0,
          0,
          irisLayers.texture.naturalWidth,
          irisLayers.texture.naturalHeight,
          irisPlan.textureOrigin.x,
          irisPlan.textureOrigin.y,
          region.width * width,
          region.height * height,
        );
        this.context.restore();
      }
    } else {
      // v1 manifests without compiler-extracted iris layers retain the
      // original full-image warp path.
      drawGridWarp(this.context, image, grids.source, grids.destination);
    }
    const protectedLayer = this.eyeProtectionLayers.get(eye.side);
    const protectionRegion = eye.rig.deformation?.region;
    if (this.eyeDeformationMode === "semantic-mesh-corrective-required" && blink > 0.001) {
      const corrective = deformation?.closedEye;
      const correctiveLayer = this.eyeCorrectiveLayers.get(eye.side);
      if (!corrective || !correctiveLayer || !protectionRegion) {
        throw new Error(`${eye.side} eye is missing its required closed-eye corrective`);
      }
      const alpha = easeInOut((blink - corrective.activationStart) / (1 - corrective.activationStart));
      if (alpha > 0) {
        this.context.save();
        this.context.globalAlpha = alpha;
        this.context.drawImage(
          correctiveLayer,
          protectionRegion.x * width,
          protectionRegion.y * height,
          protectionRegion.width * width,
          protectionRegion.height * height,
        );
        this.context.restore();
      }
    }
    // Restore compiler-protected hair, glasses, and unrelated line art after
    // every moving/corrective layer so a full blink cannot paint over them.
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
      // The player canvas is opaque, so transparent source pixels are first
      // composited against black there. Cache the protected crop using the same
      // backing colour; retaining source alpha here would composite those pixels
      // a second time when the protection layer is restored.
      layerContext.fillStyle = "#000";
      layerContext.fillRect(0, 0, layer.width, layer.height);
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

  private async buildEyeIrisLayers(manifest: LivingImageManifest): Promise<Map<string, EyeIrisLayers>> {
    const layers = new Map<string, EyeIrisLayers>();
    await Promise.all(manifest.analysis.features.eyes.map(async (eye) => {
      const deformation = eye.rig.deformation;
      const iris = deformation?.iris;
      if (!deformation || !iris) return;
      const expectedWidth = Math.max(1, Math.round(deformation.region.width * manifest.image.width));
      const expectedHeight = Math.max(1, Math.round(deformation.region.height * manifest.image.height));
      const decode = async (label: "base eye" | "iris texture", dataUrl: string, width: number, height: number): Promise<HTMLImageElement> => {
        const layer = new Image();
        layer.decoding = "async";
        await new Promise<void>((resolve, reject) => {
          layer.onload = () => resolve();
          layer.onerror = () => reject(new Error(`${eye.side} ${label} could not be decoded`));
          layer.src = dataUrl;
        });
        if (layer.naturalWidth !== width || layer.naturalHeight !== height) {
          throw new Error(`${eye.side} ${label} dimensions do not match its manifest`);
        }
        if (width !== expectedWidth || height !== expectedHeight) {
          throw new Error(`${eye.side} ${label} dimensions do not match its deformation region`);
        }
        return layer;
      };
      const [baseEye, texture] = await Promise.all([
        decode("base eye", iris.baseEye.dataUrl, iris.baseEye.width, iris.baseEye.height),
        decode("iris texture", iris.texture.dataUrl, iris.texture.width, iris.texture.height),
      ]);
      layers.set(eye.side, { baseEye, texture });
    }));
    return layers;
  }

  private async buildEyeCorrectiveLayers(manifest: LivingImageManifest): Promise<Map<string, HTMLImageElement>> {
    const layers = new Map<string, HTMLImageElement>();
    await Promise.all(manifest.analysis.features.eyes.map(async (eye) => {
      const deformation = eye.rig.deformation;
      const corrective = deformation?.closedEye;
      if (!deformation || !corrective) return;
      const layer = new Image();
      layer.decoding = "async";
      await new Promise<void>((resolve, reject) => {
        layer.onload = () => resolve();
        layer.onerror = () => reject(new Error(`${eye.side} closed-eye corrective could not be decoded`));
        layer.src = corrective.dataUrl;
      });
      const expectedWidth = Math.max(1, Math.round(deformation.region.width * manifest.image.width));
      const expectedHeight = Math.max(1, Math.round(deformation.region.height * manifest.image.height));
      if (
        layer.naturalWidth !== corrective.width
        || layer.naturalHeight !== corrective.height
        || corrective.width !== expectedWidth
        || corrective.height !== expectedHeight
      ) throw new Error(`${eye.side} closed-eye corrective dimensions do not match its deformation region`);
      layers.set(eye.side, layer);
    }));
    return layers;
  }
}
