import {
  compareRgbaPixels,
  controlStateMaxError,
  measureProtectedMaskQuality,
  measureRgbaLocality,
  MOTION_SETTLE_DELTA_SECONDS,
  MOTION_SETTLE_FRAMES,
  MOTION_STATE_TOLERANCE,
  planBlinkTransition,
  planMotionComparison,
  type AlignedAlphaMask,
  type MotionComparisonCell,
} from "../motion-comparison.js";
import { LivingImagePlayer } from "../runtime.js";
import { planEyeSemanticMesh } from "../semantic-mesh.js";
import {
  fetchLivingImage,
  loadLivingImageFile,
  type LivingImageManifest,
  type Rect,
} from "../schema.js";
import { eyeIrisPlan } from "../warp.js";
import { requireElement } from "./shared.js";

const fileInput = requireElement<HTMLInputElement>("comparison-files");
const urlInput = requireElement<HTMLTextAreaElement>("comparison-urls");
const loadUrlsButton = requireElement<HTMLButtonElement>("load-comparison-urls");
const status = requireElement<HTMLElement>("comparison-status");
const output = requireElement<HTMLElement>("comparison-output");
const eyeDeformationSelect = requireElement<HTMLSelectElement>("comparison-eye-deformation");
const frameUrls = new Set<string>();
const LOCALITY_PADDING_PIXELS = 1;

interface NamedManifest {
  source: string;
  manifest: LivingImageManifest;
}

let currentManifests: NamedManifest[] = [];

function selectedEyeDeformation() {
  if (eyeDeformationSelect.value === "semantic-mesh-required") return "semantic-mesh-required" as const;
  if (eyeDeformationSelect.value === "semantic-mesh-corrective-required") {
    return "semantic-mesh-corrective-required" as const;
  }
  return "row-grid" as const;
}

function createPlayer(canvas: HTMLCanvasElement): LivingImagePlayer {
  return new LivingImagePlayer(canvas, { eyeDeformation: selectedEyeDeformation() });
}

interface EyeProtectionEvidence {
  side: "left" | "right";
  region: Rect;
  mask: AlignedAlphaMask;
}

function parseUrlList(value: string): string[] {
  return [...new Set(value.split(/[\n,]/u).map((item) => item.trim()).filter(Boolean))];
}

function settlePlayer(player: LivingImagePlayer, cell: MotionComparisonCell): number {
  player.setAutoIdle(false);
  player.setState(cell.requestedState);
  // Fixed increments make screenshots independent of refresh rate and wall time.
  for (let frame = 0; frame < MOTION_SETTLE_FRAMES; frame += 1) {
    player.step(MOTION_SETTLE_DELTA_SECONDS);
  }
  return controlStateMaxError(cell.requestedState, player.getState());
}

async function canvasPngUrl(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("frame PNG encoding failed")), "image/png");
  });
  const url = URL.createObjectURL(blob);
  frameUrls.add(url);
  return url;
}

function releaseFrameUrls(): void {
  for (const url of frameUrls) URL.revokeObjectURL(url);
  frameUrls.clear();
}

function previewCanvas(source: HTMLCanvasElement, manifest: LivingImageManifest, maxWidth: number, label: string): HTMLCanvasElement {
  const preview = document.createElement("canvas");
  const scale = Math.min(1, maxWidth / manifest.image.width);
  preview.width = Math.max(1, Math.round(manifest.image.width * scale));
  preview.height = Math.max(1, Math.round(manifest.image.height * scale));
  preview.setAttribute("aria-label", label);
  preview.getContext("2d", { willReadFrequently: true })?.drawImage(source, 0, 0, preview.width, preview.height);
  return preview;
}

function canvasPixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D is not available for transition evidence");
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function controlledEyes(manifest: LivingImageManifest, cell: MotionComparisonCell) {
  if (cell.capability === "gaze") return manifest.analysis.features.eyes;
  if (cell.capability !== "blink") return [];
  return manifest.analysis.features.eyes.filter((eye) => eye.side === "left"
    ? cell.requestedState.blinkLeft > 0
    : cell.requestedState.blinkRight > 0);
}

function allowedMotionRegions(manifest: LivingImageManifest, cell: MotionComparisonCell): Rect[] {
  if (cell.capability === "mouth") return [manifest.analysis.features.mouth.region];
  return controlledEyes(manifest, cell).map((eye) => eye.region);
}

async function eyeProtectionEvidence(manifest: LivingImageManifest): Promise<EyeProtectionEvidence[]> {
  return Promise.all(manifest.analysis.features.eyes.flatMap((eye) => {
    const deformation = eye.rig.deformation;
    if (!deformation) return [];
    return [(async () => {
      const definition = deformation.protectedLineArtMask;
      const image = new Image();
      image.decoding = "async";
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(`${eye.side} protected line-art mask could not be decoded for evidence`));
        image.src = definition.dataUrl;
      });
      if (image.naturalWidth !== definition.width || image.naturalHeight !== definition.height) {
        throw new Error(`${eye.side} protected line-art evidence dimensions do not match its manifest`);
      }
      const regionLeft = deformation.region.x * manifest.image.width;
      const regionTop = deformation.region.y * manifest.image.height;
      const originX = Math.floor(regionLeft);
      const originY = Math.floor(regionTop);
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(regionLeft + deformation.region.width * manifest.image.width) - originX;
      canvas.height = Math.ceil(regionTop + deformation.region.height * manifest.image.height) - originY;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas 2D is not available for protected line-art evidence");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        image,
        regionLeft - originX,
        regionTop - originY,
        deformation.region.width * manifest.image.width,
        deformation.region.height * manifest.image.height,
      );
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const alpha = new Uint8ClampedArray(canvas.width * canvas.height);
      for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = rgba[pixel * 4 + 3] ?? 0;
      const maskWidth = canvas.width;
      const maskHeight = canvas.height;
      canvas.width = 1;
      canvas.height = 1;
      return {
        side: eye.side,
        region: deformation.region,
        mask: { data: alpha, width: maskWidth, height: maskHeight, originX, originY },
      };
    })()];
  }));
}

async function neutralPixels(manifest: LivingImageManifest): Promise<Uint8ClampedArray> {
  const canvas = document.createElement("canvas");
  const player = createPlayer(canvas);
  try {
    await player.load(manifest);
    player.setAutoIdle(false);
    player.resetState();
    player.step(MOTION_SETTLE_DELTA_SECONDS);
    return canvasPixels(canvas);
  } finally {
    player.destroy();
    canvas.width = 1;
    canvas.height = 1;
  }
}

function withoutRenderedIris(manifest: LivingImageManifest): LivingImageManifest {
  const clone = structuredClone(manifest);
  const transparentLayers = new Map<string, string>();
  for (const eye of clone.analysis.features.eyes) {
    const texture = eye.rig.deformation?.iris?.texture;
    if (!texture) continue;
    const key = `${texture.width}x${texture.height}`;
    let dataUrl = transparentLayers.get(key);
    if (!dataUrl) {
      const canvas = document.createElement("canvas");
      canvas.width = texture.width;
      canvas.height = texture.height;
      dataUrl = canvas.toDataURL("image/png");
      transparentLayers.set(key, dataUrl);
      canvas.width = 1;
      canvas.height = 1;
    }
    texture.dataUrl = dataUrl;
    texture.coverage = 0;
  }
  return clone;
}

async function renderedPixelsForState(
  manifest: LivingImageManifest,
  cell: MotionComparisonCell,
): Promise<Uint8ClampedArray> {
  const canvas = document.createElement("canvas");
  const player = createPlayer(canvas);
  try {
    await player.load(manifest);
    settlePlayer(player, cell);
    return canvasPixels(canvas);
  } finally {
    player.destroy();
    canvas.width = 1;
    canvas.height = 1;
  }
}

async function makeCell(
  manifest: LivingImageManifest,
  noIrisManifest: LivingImageManifest,
  cell: MotionComparisonCell,
  baselinePixels: Uint8ClampedArray,
  protectionEvidence: readonly EyeProtectionEvidence[],
): Promise<HTMLElement> {
  const article = document.createElement("article");
  article.className = `comparison-cell comparison-cell-${cell.status}`;
  article.dataset.state = cell.id;
  article.dataset.phase = cell.phase;

  const heading = document.createElement("div");
  heading.className = "comparison-cell-heading";
  const title = document.createElement("h3");
  title.textContent = cell.label;
  const badge = document.createElement("span");
  badge.textContent = cell.status;
  heading.append(title, badge);
  article.append(heading);

  if (cell.status === "skipped") {
    const skipped = document.createElement("div");
    skipped.className = "comparison-skipped";
    skipped.innerHTML = `<strong>Not rendered</strong><span>${cell.reason ?? "Capability unavailable"}</span>`;
    article.append(skipped);
    return article;
  }

  const renderCanvas = document.createElement("canvas");
  const player = createPlayer(renderCanvas);
  try {
    await player.load(manifest);
    const stateError = settlePlayer(player, cell);
    const renderedState = player.getState();
    const renderedPixels = canvasPixels(renderCanvas);
    const selectedEyes = controlledEyes(manifest, cell);
    const noIrisPixels = selectedEyes.some((eye) => eye.rig.deformation?.iris)
      ? await renderedPixelsForState(noIrisManifest, cell)
      : null;
    const locality = measureRgbaLocality(
      baselinePixels,
      renderedPixels,
      manifest.image.width,
      manifest.image.height,
      allowedMotionRegions(manifest, cell),
      LOCALITY_PADDING_PIXELS,
    );
    article.dataset.insideChangedPixels = String(locality.insideChangedPixels);
    article.dataset.outsideChangedPixels = String(locality.outsideChangedPixels);
    article.dataset.maxChannelDelta = String(locality.maxChannelDelta);
    article.dataset.visibleEffect = String(locality.visibleEffect);
    const selectedEyeSides = new Set(selectedEyes.map((eye) => eye.side));
    const selectedProtections = protectionEvidence.filter((evidence) => selectedEyeSides.has(evidence.side));
    const protectionByEye = selectedProtections.map((evidence) => ({
      side: evidence.side,
      metrics: measureProtectedMaskQuality(
        baselinePixels,
        renderedPixels,
        manifest.image.width,
        manifest.image.height,
        evidence.mask,
        evidence.region,
      ),
    }));
    const protectionQuality = protectionByEye.length === 0
      ? null
      : protectionByEye.map((entry) => entry.metrics).reduce((total, metrics) => ({
        corePixels: total.corePixels + metrics.corePixels,
        coreErrorPixels: total.coreErrorPixels + metrics.coreErrorPixels,
        coreMaxRgbDelta: Math.max(total.coreMaxRgbDelta, metrics.coreMaxRgbDelta),
        clearMaskPixels: total.clearMaskPixels + metrics.clearMaskPixels,
        clearMaskChangedPixels: total.clearMaskChangedPixels + metrics.clearMaskChangedPixels,
      }));
    if (protectionQuality) {
      article.dataset.protectedCorePixels = String(protectionQuality.corePixels);
      article.dataset.protectedCoreErrorPixels = String(protectionQuality.coreErrorPixels);
      article.dataset.protectedCoreMaxRgbDelta = String(protectionQuality.coreMaxRgbDelta);
      article.dataset.clearMaskPixels = String(protectionQuality.clearMaskPixels);
      article.dataset.clearMaskChangedPixels = String(protectionQuality.clearMaskChangedPixels);
      article.dataset.protectionByEye = JSON.stringify(protectionByEye);
    }
    const irisByEye = selectedEyes.flatMap((eye) => {
      const blink = eye.side === "left" ? renderedState.blinkLeft : renderedState.blinkRight;
      const semanticAperture = selectedEyeDeformation() !== "row-grid" && blink > 0.001
        ? (() => {
            const mesh = eye.rig.deformation?.semanticMesh;
            if (!mesh) throw new Error(`${eye.side} eye is missing its required semantic mesh`);
            return planEyeSemanticMesh(mesh, manifest.image.width, manifest.image.height, blink).aperture;
          })()
        : undefined;
      const plan = eyeIrisPlan(
        eye,
        manifest.image.width,
        manifest.image.height,
        blink,
        renderedState.gazeX,
        renderedState.gazeY,
        semanticAperture,
      );
      const iris = eye.rig.deformation?.iris;
      if (!plan || !iris) return [];
      const renderedTexturePixels = noIrisPixels
        ? measureRgbaLocality(
          noIrisPixels,
          renderedPixels,
          manifest.image.width,
          manifest.image.height,
          [eye.region],
          0,
        ).insideChangedPixels
        : 0;
      return [{
        side: eye.side,
        alpha: plan.alpha,
        shiftX: plan.centre.x - iris.centre.x * manifest.image.width,
        shiftY: plan.centre.y - iris.centre.y * manifest.image.height,
        radiusX: plan.radiusX,
        radiusY: plan.radiusY,
        renderedTexturePixels,
      }];
    });
    if (irisByEye.length > 0) article.dataset.irisByEye = JSON.stringify(irisByEye);
    article.append(previewCanvas(renderCanvas, manifest, 420, `${manifest.id}: ${cell.label}`));

    const evidence = document.createElement("div");
    evidence.className = "comparison-evidence";
    const phase = document.createElement("span");
    phase.textContent = cell.phase;
    const error = document.createElement("span");
    error.textContent = `state error ${stateError.toFixed(4)}`;
    if (stateError > MOTION_STATE_TOLERANCE) {
      article.classList.add("comparison-cell-error");
      error.classList.add("comparison-error-text");
    }
    const localityEvidence = document.createElement("span");
    localityEvidence.textContent = cell.capability === null
      ? `canonical Δ ${locality.insideChangedPixels + locality.outsideChangedPixels}`
      : `local Δ ${locality.insideChangedPixels} · outside ${locality.outsideChangedPixels} · max ${locality.maxChannelDelta}`;
    const missingEffect = cell.capability !== null && !locality.visibleEffect;
    if (locality.outsideChangedPixels > 0 || missingEffect) {
      article.classList.add("comparison-cell-error");
      localityEvidence.classList.add("comparison-error-text");
    }
    const protection = document.createElement("span");
    if (protectionQuality) {
      protection.textContent = `protected errors ${protectionQuality.coreErrorPixels}/${protectionQuality.corePixels} · max RGB ${protectionQuality.coreMaxRgbDelta} · clear-mask Δ ${protectionQuality.clearMaskChangedPixels}/${protectionQuality.clearMaskPixels}`;
      const invalidEye = protectionByEye.some(({ metrics }) => (
        metrics.corePixels === 0
        || metrics.coreErrorPixels > 0
        || metrics.clearMaskPixels === 0
        || metrics.clearMaskChangedPixels === 0
      ));
      if (invalidEye) {
        article.classList.add("comparison-cell-error");
        protection.classList.add("comparison-error-text");
      }
    }
    const download = document.createElement("a");
    download.href = await canvasPngUrl(renderCanvas);
    download.download = `${manifest.id}-${cell.id}.png`;
    download.textContent = "Full PNG";
    evidence.append(phase, error, localityEvidence);
    if (protectionQuality) evidence.append(protection);
    if (irisByEye.length > 0) {
      const irisEvidence = document.createElement("span");
      irisEvidence.textContent = irisByEye.map((entry) => (
        `${entry.side} iris α ${entry.alpha.toFixed(3)} · shift ${entry.shiftX.toFixed(2)}, ${entry.shiftY.toFixed(2)} px · rendered Δ ${entry.renderedTexturePixels}`
      )).join(" · ");
      evidence.append(irisEvidence);
    }
    evidence.append(download);
    article.append(evidence);
  } catch (error) {
    article.classList.add("comparison-cell-error");
    article.replaceChildren(heading);
    const message = document.createElement("p");
    message.className = "comparison-render-error";
    message.textContent = `Render failed: ${(error as Error).message}`;
    article.append(message);
  } finally {
    player.destroy();
    renderCanvas.width = 1;
    renderCanvas.height = 1;
  }
  return article;
}

async function makeBlinkTransition(manifest: LivingImageManifest): Promise<HTMLElement> {
  const transition = planBlinkTransition(manifest);
  const section = document.createElement("section");
  section.className = "comparison-timeline";
  section.dataset.transitionStatus = transition.status;

  const heading = document.createElement("header");
  const title = document.createElement("h3");
  title.textContent = "Blink close → reopen";
  const description = document.createElement("p");
  description.textContent = "Fixed samples from the same runtime pulse curve, rendered sequentially with one player; inspect neighboring frames for seams, flicker, and crushed highlights.";
  heading.append(title, description);
  section.append(heading);

  if (transition.status === "skipped") {
    const skipped = document.createElement("div");
    skipped.className = "comparison-timeline-skipped";
    skipped.textContent = `Not rendered — ${transition.reason ?? "blink unavailable"}`;
    section.append(skipped);
    return section;
  }

  const strip = document.createElement("div");
  strip.className = "comparison-timeline-strip";
  const renderCanvas = document.createElement("canvas");
  const player = createPlayer(renderCanvas);
  let openingPixels: Uint8ClampedArray | null = null;
  let reopenedPixels: Uint8ClampedArray | null = null;
  try {
    await player.load(manifest);
    player.setAutoIdle(false);
    for (const [index, frame] of transition.frames.entries()) {
      player.setState(frame.requestedState);
      // Advance a deterministic tick between each sample. Blink itself is
      // direct, but this catches rendering changes at adjacent pulse states.
      player.step(MOTION_SETTLE_DELTA_SECONDS);
      const stateError = controlStateMaxError(frame.requestedState, player.getState());
      const cell = document.createElement("figure");
      cell.className = "comparison-timeline-frame";
      cell.dataset.blinkAmount = frame.blinkAmount.toFixed(4);
      const preview = previewCanvas(renderCanvas, manifest, 180, `${manifest.id}: ${frame.label}`);
      cell.append(preview);
      if (index === 0) openingPixels = canvasPixels(renderCanvas);
      if (index === transition.frames.length - 1) reopenedPixels = canvasPixels(renderCanvas);
      const caption = document.createElement("figcaption");
      caption.textContent = `${frame.label} · ${Math.round(frame.timeSeconds * 1000)}ms`;
      cell.append(caption);
      if (stateError > MOTION_STATE_TOLERANCE) {
        cell.classList.add("comparison-cell-error");
        const error = document.createElement("span");
        error.className = "comparison-error-text";
        error.textContent = `state error ${stateError.toFixed(4)}`;
        cell.append(error);
      }
      strip.append(cell);
    }
    if (!openingPixels || !reopenedPixels) throw new Error("Blink transition has no open endpoints");
    const difference = compareRgbaPixels(openingPixels, reopenedPixels);
    const evidence = document.createElement("p");
    evidence.className = "comparison-timeline-evidence";
    evidence.dataset.differingPixels = String(difference.differingPixels);
    evidence.textContent = `Full-resolution open → reopened difference: ${difference.differingPixels} pixels · max channel delta ${difference.maxChannelDelta}`;
    if (difference.differingPixels > 0) {
      section.classList.add("comparison-cell-error");
      evidence.classList.add("comparison-error-text");
    }
    section.append(strip, evidence);
  } catch (error) {
    section.classList.add("comparison-cell-error");
    const message = document.createElement("p");
    message.className = "comparison-render-error";
    message.textContent = `Blink transition failed: ${(error as Error).message}`;
    section.append(message);
  } finally {
    player.destroy();
    renderCanvas.width = 1;
    renderCanvas.height = 1;
  }
  return section;
}

async function renderManifest({ source, manifest }: NamedManifest): Promise<HTMLElement> {
  const section = document.createElement("section");
  section.className = "comparison-character";
  section.dataset.characterId = manifest.id;
  section.dataset.eyeDeformation = selectedEyeDeformation();

  const heading = document.createElement("header");
  heading.className = "comparison-character-heading";
  const titleGroup = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = manifest.id.replaceAll("-", " ");
  const meta = document.createElement("p");
  meta.textContent = `${source} · ${manifest.image.width}×${manifest.image.height}`;
  titleGroup.append(title, meta);
  const quality = document.createElement("span");
  quality.className = `result-badge result-${manifest.quality.status}`;
  quality.textContent = manifest.quality.status;
  heading.append(titleGroup, quality);

  const grid = document.createElement("div");
  grid.className = "comparison-grid";
  const noIrisManifest = withoutRenderedIris(manifest);
  const [baselinePixels, protectionEvidence] = await Promise.all([
    neutralPixels(manifest),
    eyeProtectionEvidence(manifest),
  ]);
  for (const cell of planMotionComparison(manifest)) {
    grid.append(await makeCell(manifest, noIrisManifest, cell, baselinePixels, protectionEvidence));
  }
  section.append(heading, grid, await makeBlinkTransition(manifest));
  return section;
}

async function renderManifests(manifests: NamedManifest[]): Promise<void> {
  currentManifests = manifests;
  releaseFrameUrls();
  output.replaceChildren();
  status.textContent = `Rendering ${manifests.length} character${manifests.length === 1 ? "" : "s"} in fixed deterministic states…`;
  for (const manifest of manifests) output.append(await renderManifest(manifest));
  status.textContent = `Rendered ${manifests.length} character${manifests.length === 1 ? "" : "s"} in fixed deterministic states.`;
}

async function loadFiles(files: File[]): Promise<void> {
  if (!files.length) return;
  status.textContent = `Decoding ${files.length} local .limg file${files.length === 1 ? "" : "s"}…`;
  try {
    const manifests = await Promise.all(files.map(async (file) => ({
      source: file.name,
      manifest: await loadLivingImageFile(file),
    })));
    await renderManifests(manifests);
  } catch (error) {
    status.textContent = `Load failed: ${(error as Error).message}`;
  }
}

async function loadUrls(urls: string[]): Promise<void> {
  if (!urls.length) {
    status.textContent = "Enter at least one .limg URL.";
    return;
  }
  status.textContent = `Fetching ${urls.length} .limg asset${urls.length === 1 ? "" : "s"}…`;
  try {
    const manifests = await Promise.all(urls.map(async (url) => ({
      source: url,
      manifest: await fetchLivingImage(url),
    })));
    await renderManifests(manifests);
  } catch (error) {
    status.textContent = `Load failed: ${(error as Error).message}`;
  }
}

fileInput.addEventListener("change", () => void loadFiles([...fileInput.files ?? []]));
loadUrlsButton.addEventListener("click", () => void loadUrls(parseUrlList(urlInput.value)));
eyeDeformationSelect.addEventListener("change", () => {
  if (currentManifests.length) void renderManifests(currentManifests);
});

const initialLocation = new URL(window.location.href);
const initialEyeMode = initialLocation.searchParams.get("eyeMode");
if (initialEyeMode === "semantic-mesh-required" || initialEyeMode === "semantic-mesh-corrective-required") {
  eyeDeformationSelect.value = initialEyeMode;
}
const initialUrls = initialLocation.searchParams.getAll("asset").flatMap(parseUrlList);
if (initialUrls.length) {
  urlInput.value = initialUrls.join("\n");
  void loadUrls(initialUrls);
}
