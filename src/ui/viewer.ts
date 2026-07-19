import type { ControlState } from "../behavior.js";
import { LivingImagePlayer } from "../runtime.js";
import { fetchLivingImage, loadLivingImageFile, type LivingImageManifest } from "../schema.js";
import { renderQuality, requireElement, SAMPLE_URLS } from "./shared.js";

const canvas = requireElement<HTMLCanvasElement>("character-canvas");
const player = new LivingImagePlayer(canvas);
const fileInput = requireElement<HTMLInputElement>("file-input");
const autoIdle = requireElement<HTMLInputElement>("auto-idle");
const status = requireElement<HTMLElement>("render-status");
const name = requireElement<HTMLElement>("character-name");
const meta = requireElement<HTMLElement>("character-meta");
const qualityCard = requireElement<HTMLElement>("quality-card");
const inputs = [...document.querySelectorAll<HTMLInputElement>("[data-control]")];

let mouthTimer: number | null = null;

function resetControlInputs(): void {
  for (const input of inputs) {
    input.value = "0";
    const output = document.getElementById(`${input.dataset.control}-output`);
    if (output) output.textContent = "0.00";
  }
}

async function useManifest(manifest: LivingImageManifest): Promise<void> {
  status.textContent = "Decoding embedded texture…";
  await player.load(manifest);
  resetControlInputs();
  player.start();
  name.textContent = manifest.id.replaceAll("-", " ");
  meta.textContent = `${manifest.image.width}×${manifest.image.height} · ${manifest.compiler.detector} ${manifest.compiler.detectorVersion}`;
  status.textContent = manifest.quality.status === "reject" ? "Rejected asset · animation gated" : "Local deterministic runtime";
  renderQuality(qualityCard, manifest);
  const disabled = new Set(manifest.quality.disabledCapabilities);
  for (const input of inputs) {
    const control = input.dataset.control ?? "";
    input.disabled = manifest.quality.status === "reject"
      || (control.startsWith("blink") && disabled.has("blink"))
      || (control.startsWith("gaze") && disabled.has("gaze"))
      || (control === "mouthOpen" && disabled.has("mouth"));
  }
}

async function loadSample(url: string): Promise<void> {
  try {
    status.textContent = "Loading compiled fixture…";
    await useManifest(await fetchLivingImage(url));
  } catch (error) {
    status.textContent = "Sample missing";
    meta.textContent = `${(error as Error).message}. Run npm run compile:fixtures first.`;
  }
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try { await useManifest(await loadLivingImageFile(file)); }
  catch (error) { status.textContent = "Load failed"; meta.textContent = (error as Error).message; }
});

for (const input of inputs) {
  input.addEventListener("input", () => {
    const control = input.dataset.control as keyof ControlState;
    const value = Number(input.value);
    player.setState({ [control]: value });
    const output = document.getElementById(`${control}-output`);
    if (output) output.textContent = value.toFixed(2);
  });
}

autoIdle.addEventListener("change", () => player.setAutoIdle(autoIdle.checked));
requireElement<HTMLButtonElement>("sample-teal").addEventListener("click", () => void loadSample(SAMPLE_URLS.teal));
requireElement<HTMLButtonElement>("sample-copper").addEventListener("click", () => void loadSample(SAMPLE_URLS.copper));
requireElement<HTMLButtonElement>("blink-button").addEventListener("click", () => player.triggerBlink());
requireElement<HTMLButtonElement>("talk-button").addEventListener("click", () => {
  if (mouthTimer !== null) window.clearInterval(mouthTimer);
  let ticks = 0;
  mouthTimer = window.setInterval(() => {
    player.setState({ mouthOpen: ticks % 2 === 0 ? 0.62 : 0.08 });
    ticks += 1;
    if (ticks >= 8) {
      if (mouthTimer !== null) window.clearInterval(mouthTimer);
      mouthTimer = null;
      player.setState({ mouthOpen: 0 });
    }
  }, 115);
});
requireElement<HTMLButtonElement>("reset-button").addEventListener("click", () => {
  player.resetState();
  resetControlInputs();
});

void loadSample(SAMPLE_URLS.teal);
