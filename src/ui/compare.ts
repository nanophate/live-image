import {
  compareRgbaPixels,
  controlStateMaxError,
  MOTION_SETTLE_DELTA_SECONDS,
  MOTION_SETTLE_FRAMES,
  MOTION_STATE_TOLERANCE,
  planBlinkTransition,
  planMotionComparison,
  type MotionComparisonCell,
} from "../motion-comparison.js";
import { LivingImagePlayer } from "../runtime.js";
import {
  fetchLivingImage,
  loadLivingImageFile,
  type LivingImageManifest,
} from "../schema.js";
import { requireElement } from "./shared.js";

const fileInput = requireElement<HTMLInputElement>("comparison-files");
const urlInput = requireElement<HTMLTextAreaElement>("comparison-urls");
const loadUrlsButton = requireElement<HTMLButtonElement>("load-comparison-urls");
const status = requireElement<HTMLElement>("comparison-status");
const output = requireElement<HTMLElement>("comparison-output");
const frameUrls = new Set<string>();

interface NamedManifest {
  source: string;
  manifest: LivingImageManifest;
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

async function makeCell(manifest: LivingImageManifest, cell: MotionComparisonCell): Promise<HTMLElement> {
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
  const player = new LivingImagePlayer(renderCanvas);
  try {
    await player.load(manifest);
    const stateError = settlePlayer(player, cell);
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
    const download = document.createElement("a");
    download.href = await canvasPngUrl(renderCanvas);
    download.download = `${manifest.id}-${cell.id}.png`;
    download.textContent = "Full PNG";
    evidence.append(phase, error, download);
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
  const player = new LivingImagePlayer(renderCanvas);
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
  for (const cell of planMotionComparison(manifest)) grid.append(await makeCell(manifest, cell));
  section.append(heading, grid, await makeBlinkTransition(manifest));
  return section;
}

async function renderManifests(manifests: NamedManifest[]): Promise<void> {
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

const initialUrls = new URL(window.location.href).searchParams.getAll("asset").flatMap(parseUrlList);
if (initialUrls.length) {
  urlInput.value = initialUrls.join("\n");
  void loadUrls(initialUrls);
}
