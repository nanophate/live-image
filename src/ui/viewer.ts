import type { ControlState } from "../behavior.js";
import { canvasRecordingSupported, recordCanvasAction } from "../recording.js";
import { LivingImagePlayer, type RuntimeReaction } from "../runtime.js";
import { SHOWCASE_DURATION_SECONDS, showcaseFrameAt } from "../showcase.js";
import {
  fetchLivingImage,
  loadLivingImageFile,
  parseLivingImage,
  type LivingImageManifest,
} from "../schema.js";
import { renderQuality, renderRejectDiagnostic, requireElement, SAMPLE_URLS } from "./shared.js";

const pageMode = document.body.dataset.productMode === "compiler" ? "compiler" : "viewer";
const canvas = requireElement<HTMLCanvasElement>("character-canvas");
const player = new LivingImagePlayer(canvas, { eyeDeformation: "best-available" });
const fileInput = requireElement<HTMLInputElement>("file-input");
const autoIdle = requireElement<HTMLInputElement>("auto-idle");
const status = requireElement<HTMLElement>("render-status");
const name = requireElement<HTMLElement>("character-name");
const meta = requireElement<HTMLElement>("character-meta");
const qualityCard = requireElement<HTMLElement>("quality-card");
const compileProgress = document.getElementById("compile-progress");
const compileElapsed = document.getElementById("compile-elapsed");
const compileResult = document.getElementById("compile-result");
const compileResultReasons = document.getElementById("compile-result-reasons");
const tryAnotherButton = document.getElementById("try-another-button");
const compilerNote = requireElement<HTMLElement>("compiler-note");
const deploymentLabel = requireElement<HTMLElement>("deployment-label");
const fileButtonLabel = requireElement<HTMLElement>("file-button-label");
const downloadLimg = requireElement<HTMLAnchorElement>("download-limg");
const demoButton = requireElement<HTMLButtonElement>("demo-button");
const recordButton = requireElement<HTMLButtonElement>("record-button");
const showcaseLabel = requireElement<HTMLOutputElement>("showcase-label");
const showcaseProgress = requireElement<HTMLProgressElement>("showcase-progress");
const sampleTealButton = requireElement<HTMLButtonElement>("sample-teal");
const sampleCopperButton = requireElement<HTMLButtonElement>("sample-copper");
const sampleButtons = [sampleTealButton, sampleCopperButton];
const resetButton = requireElement<HTMLButtonElement>("reset-button");
const inputs = [...document.querySelectorAll<HTMLInputElement>("[data-control]")];
const reactionButtons = new Map<RuntimeReaction, HTMLButtonElement>([
  ["blink", requireElement<HTMLButtonElement>("blink-button")],
  ["talk", requireElement<HTMLButtonElement>("talk-button")],
  ["look-left", requireElement<HTMLButtonElement>("look-left-button")],
  ["look-right", requireElement<HTMLButtonElement>("look-right-button")],
]);

let currentManifest: LivingImageManifest | null = null;
let downloadUrl: string | null = null;
let showcaseAnimation: number | null = null;
let finishShowcase: (() => void) | null = null;
let restoreAutoIdleAfterShowcase: boolean | null = null;
let busy = false;
let compileProgressTimer: number | null = null;
let compilerMode: "local" | "hosted" | "unavailable" = "unavailable";
let compilerEnabled = false;
let compilerConfigReady: Promise<void>;

interface CompilerConfig {
  compiler: "local" | "hosted";
  enabled: boolean;
  authentication?: "cloudflare-access" | "none" | "platform";
  reviewExpiresAt?: string;
  samplesAvailable: boolean;
  provider?: "cloudflare" | "hugging-face";
}

async function loadCompilerConfig(): Promise<void> {
  if (pageMode === "viewer") {
    compilerMode = "unavailable";
    compilerEnabled = false;
    deploymentLabel.textContent = "Portable Viewer";
    fileInput.accept = ".limg,application/json";
    fileButtonLabel.textContent = "Open .limg";
    compilerNote.textContent = "This Viewer accepts .limg files only. Character files stay in this browser and are never sent to the Compiler.";
    return;
  }
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const config = await response.json() as CompilerConfig;
    compilerMode = config.compiler;
    compilerEnabled = config.enabled;
    for (const button of sampleButtons) button.hidden = !config.samplesAvailable;
    if (!config.enabled) {
      deploymentLabel.textContent = "Compiler unavailable";
      compilerNote.textContent = config.authentication === "none"
        ? "The public review window is missing or expired. Redeploy review mode to create a new two-hour window."
        : "Compilation is not configured for this deployment.";
      return;
    }
    fileInput.accept = ".png,.jpg,.jpeg,image/png,image/jpeg";
    fileButtonLabel.textContent = "Open PNG or JPEG";
    if (config.compiler === "hosted") {
      deploymentLabel.textContent = config.provider === "hugging-face"
        ? "Hosted Compiler"
        : config.authentication === "none"
        ? "Public review Compiler"
        : "Access-protected Compiler";
      compilerNote.textContent = config.provider === "hugging-face"
        ? "PNG and JPEG files are sent to the compiler hosted by Hugging Face. Living Image does not write source images or .limg files to application storage, but the provider may process network and operational logs. Do not upload sensitive images."
        : config.authentication === "none"
          ? `Public review mode expires at ${config.reviewExpiresAt ?? "an unreported time"}. Images are processed without application storage; do not upload sensitive images.`
          : "PNG and JPEG files are sent through Cloudflare Access to the private Compiler. The app does not save source images or .limg files to application storage.";
    } else {
      deploymentLabel.textContent = "Local Compiler";
      compilerNote.innerHTML = "PNG compilation runs on this machine. The first online run may download reviewed detector weights; <code>studio:offline</code> requires them to be cached.";
    }
  } catch {
    compilerMode = "unavailable";
    compilerEnabled = false;
    deploymentLabel.textContent = "Portable Runtime";
    compilerNote.innerHTML = "This deployment is a .limg Viewer. For local PNG compilation, run <code>nodenv exec npm run studio</code>.";
  }
}

function setDownload(payload: Blob | null, filename = "character.limg"): void {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = payload ? URL.createObjectURL(payload) : null;
  downloadLimg.hidden = !downloadUrl;
  downloadLimg.removeAttribute("href");
  if (downloadUrl) {
    downloadLimg.href = downloadUrl;
    downloadLimg.download = filename;
  }
}

function resetControlInputs(): void {
  for (const input of inputs) {
    input.value = "0";
    const output = document.getElementById(`${input.dataset.control}-output`);
    if (output) output.textContent = "0.00";
  }
}

function syncControlInputs(state: ControlState): void {
  for (const input of inputs) {
    const control = input.dataset.control as keyof ControlState;
    const value = state[control];
    input.value = value.toFixed(2);
    const output = document.getElementById(`${control}-output`);
    if (output) output.textContent = value.toFixed(2);
  }
}

function setBusy(nextBusy: boolean): void {
  busy = nextBusy;
  fileInput.disabled = busy;
  autoIdle.disabled = busy;
  resetButton.disabled = busy;
  for (const button of sampleButtons) button.disabled = busy;
  refreshCapabilityControls();
}

function startCompileProgress(): void {
  if (!compileProgress || !compileElapsed) return;
  if (compileProgressTimer !== null) window.clearInterval(compileProgressTimer);
  const startedAt = performance.now();
  compileProgress.hidden = false;
  compileElapsed.textContent = "Starting…";
  compileProgressTimer = window.setInterval(() => {
    const elapsedSeconds = Math.max(1, Math.floor((performance.now() - startedAt) / 1000));
    compileElapsed.textContent = `Working · ${elapsedSeconds}s elapsed`;
  }, 500);
}

function stopCompileProgress(): void {
  if (compileProgressTimer !== null) window.clearInterval(compileProgressTimer);
  compileProgressTimer = null;
  if (compileProgress) compileProgress.hidden = true;
}

function hideCompileResult(): void {
  if (compileResult) compileResult.hidden = true;
  if (compileResultReasons) compileResultReasons.replaceChildren();
}

function showUnsupportedResult(diagnostic: { rejectionReasons?: string[]; warnings?: string[] }): void {
  if (!compileResult || !compileResultReasons) return;
  const messages = [...(diagnostic.rejectionReasons ?? []), ...(diagnostic.warnings ?? [])];
  compileResultReasons.replaceChildren(...messages.map((message) => {
    const item = document.createElement("li");
    item.textContent = message;
    return item;
  }));
  compileResult.hidden = false;
  compileResult.focus();
}

function refreshCapabilityControls(): void {
  const capabilities = player.getCapabilities();
  const hasCurrentManifest = currentManifest !== null;
  for (const input of inputs) {
    const control = input.dataset.control ?? "";
    input.disabled = busy
      || !hasCurrentManifest
      || !capabilities.loaded
      || capabilities.status === "reject"
      || (control.startsWith("blink") && !capabilities.blink)
      || (control.startsWith("gaze") && !capabilities.gaze)
      || (control === "mouthOpen" && !capabilities.mouth)
      || (control === "breath" && !capabilities.breath);
  }
  reactionButtons.get("blink")!.disabled = busy || !hasCurrentManifest || !capabilities.blink;
  reactionButtons.get("talk")!.disabled = busy || !hasCurrentManifest || !capabilities.mouth;
  reactionButtons.get("look-left")!.disabled = busy || !hasCurrentManifest || !capabilities.gaze;
  reactionButtons.get("look-right")!.disabled = busy || !hasCurrentManifest || !capabilities.gaze;
  demoButton.disabled = busy || !hasCurrentManifest || !capabilities.loaded || capabilities.status === "reject";
  recordButton.disabled = demoButton.disabled || !canvasRecordingSupported(canvas);
}

function stopShowcase(label = "Ready"): void {
  if (showcaseAnimation !== null) cancelAnimationFrame(showcaseAnimation);
  showcaseAnimation = null;
  player.resetToNeutral();
  resetControlInputs();
  if (restoreAutoIdleAfterShowcase !== null) {
    autoIdle.checked = restoreAutoIdleAfterShowcase;
    player.setAutoIdle(restoreAutoIdleAfterShowcase);
    restoreAutoIdleAfterShowcase = null;
  }
  showcaseLabel.textContent = label;
  if (finishShowcase) finishShowcase();
  finishShowcase = null;
}

async function runShowcase(): Promise<void> {
  if (!currentManifest || currentManifest.quality.status === "reject") return;
  stopShowcase();
  restoreAutoIdleAfterShowcase = autoIdle.checked;
  autoIdle.checked = false;
  player.setAutoIdle(false);
  player.resetToNeutral();
  const capabilities = player.getCapabilities();
  const startedAt = performance.now();
  await new Promise<void>((resolve) => {
    finishShowcase = resolve;
    const frame = (timestamp: number): void => {
      const elapsed = Math.min(SHOWCASE_DURATION_SECONDS, (timestamp - startedAt) / 1000);
      const showcase = showcaseFrameAt(elapsed, capabilities);
      player.setState(showcase.state);
      syncControlInputs(showcase.state);
      showcaseLabel.textContent = showcase.label;
      showcaseProgress.value = showcase.progress;
      if (elapsed >= SHOWCASE_DURATION_SECONDS) {
        showcaseAnimation = null;
        player.resetToNeutral();
        resetControlInputs();
        const restoreAutoIdle = restoreAutoIdleAfterShowcase ?? false;
        autoIdle.checked = restoreAutoIdle;
        player.setAutoIdle(restoreAutoIdle);
        restoreAutoIdleAfterShowcase = null;
        showcaseLabel.textContent = "Complete";
        finishShowcase = null;
        resolve();
        return;
      }
      showcaseAnimation = requestAnimationFrame(frame);
    };
    showcaseAnimation = requestAnimationFrame(frame);
  });
}

async function useManifest(manifest: LivingImageManifest, downloadable?: { blob: Blob; filename: string }): Promise<void> {
  stopShowcase();
  status.textContent = "Decoding embedded texture…";
  await player.load(manifest);
  hideCompileResult();
  currentManifest = manifest;
  resetControlInputs();
  showcaseProgress.value = 0;
  player.setAutoIdle(autoIdle.checked);
  player.start();
  name.textContent = manifest.id.replaceAll("-", " ");
  meta.textContent = `${manifest.image.width}×${manifest.image.height} · ${manifest.compiler.detector} ${manifest.compiler.detectorVersion}`;
  status.textContent = manifest.quality.status === "reject" ? "Rejected asset · animation gated" : "Ready · local deterministic runtime";
  renderQuality(qualityCard, manifest);
  setDownload(downloadable?.blob ?? null, downloadable?.filename);
  refreshCapabilityControls();
}

async function loadSample(url: string): Promise<void> {
  try {
    setBusy(true);
    status.textContent = "Loading compiled fixture…";
    await useManifest(await fetchLivingImage(url));
  } catch (error) {
    status.textContent = "Sample missing";
    meta.textContent = `${(error as Error).message}. Run npm run compile:fixtures first.`;
  } finally {
    setBusy(false);
  }
}

async function showSourcePreview(file: File): Promise<void> {
  const bitmap = await createImageBitmap(file);
  player.stop();
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas 2D is unavailable");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
}

async function compileImage(file: File): Promise<void> {
  await compilerConfigReady;
  if (!compilerEnabled) {
    status.textContent = "PNG compilation unavailable";
    meta.textContent = compilerMode === "hosted"
      ? "Hosted compilation is unavailable for this deployment."
      : "Run nodenv exec npm run studio for local PNG compilation. The currently loaded .limg remains playable.";
    return;
  }
  stopShowcase();
  currentManifest = null;
  setDownload(null);
  setBusy(true);
  hideCompileResult();
  startCompileProgress();
  try {
    await showSourcePreview(file);
    name.textContent = file.name.replace(/\.[^.]+$/u, "");
    meta.textContent = compilerMode === "hosted"
      ? "Uploading for automatic face, eye, iris, mouth, mesh, and quality analysis…"
      : "Running automatic face, eye, iris, mouth, mesh, and quality analysis locally…";
    status.textContent = "Compiling character…";
    qualityCard.hidden = true;
    const response = await fetch("/api/compile", {
      method: "POST",
      headers: {
        "Content-Type": file.type || (file.name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"),
        "X-Living-Image-Filename": encodeURIComponent(file.name),
      },
      body: file,
    });
    const payload = await response.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(payload) as unknown;
    } catch {
      // Access gateways and upstream failures may return HTML or plain text.
    }
    if (response.status === 422 && parsed !== null) {
      const diagnostic = parsed as { rejectionReasons?: string[]; warnings?: string[] };
      renderRejectDiagnostic(qualityCard, diagnostic);
      showUnsupportedResult(diagnostic);
      status.textContent = "This image isn’t supported yet";
      meta.textContent = "No character file was created. Try a near-frontal anime portrait with a larger, unobstructed face and both eyes visible.";
      return;
    }
    if (!response.ok) {
      const message = typeof parsed === "object" && parsed && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : `${compilerMode === "hosted" ? "Hosted" : "Local"} compiler returned HTTP ${response.status}`;
      const requestId = response.headers.get("X-Request-Id");
      throw new Error(requestId ? message + " (request " + requestId + ")" : message);
    }
    if (parsed === null) throw new Error("Compiler returned an invalid character response");
    const manifest = parseLivingImage(payload);
    const filename = `${manifest.id}.limg`;
    await useManifest(manifest, { blob: new Blob([payload], { type: "application/json" }), filename });
    status.textContent = manifest.quality.status === "limited"
      ? "Compiled with limited controls · ready to review"
      : "Compiled · ready to review";
  } catch (error) {
    status.textContent = "Compilation unavailable";
    meta.textContent = compilerMode === "hosted"
      ? (error as Error).message
      : (error as Error).message + ". Start this page with nodenv exec npm run studio.";
  } finally {
    stopCompileProgress();
    setBusy(false);
    refreshCapabilityControls();
  }
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const isLivingImage = file.name.toLowerCase().endsWith(".limg") || file.type === "application/json";
    if (pageMode === "viewer" && isLivingImage) {
      setBusy(true);
      await useManifest(await loadLivingImageFile(file));
    } else if (pageMode === "compiler" && !isLivingImage) {
      await compileImage(file);
    } else if (pageMode === "viewer") {
      status.textContent = "Viewer accepts .limg files only";
      meta.textContent = "Use the Compiler path to convert PNG or JPEG images first.";
    } else {
      status.textContent = "Compiler accepts PNG or JPEG files only";
      meta.textContent = "Use the Viewer path to open an existing .limg character.";
    }
  } catch (error) {
    status.textContent = "Load failed";
    meta.textContent = (error as Error).message;
  } finally {
    setBusy(false);
    refreshCapabilityControls();
    fileInput.value = "";
  }
});

tryAnotherButton?.addEventListener("click", () => fileInput.click());

for (const input of inputs) {
  input.addEventListener("input", () => {
    if (showcaseAnimation !== null) stopShowcase("Manual control");
    const control = input.dataset.control as keyof ControlState;
    const value = Number(input.value);
    player.setState({ [control]: value });
    const output = document.getElementById(`${control}-output`);
    if (output) output.textContent = value.toFixed(2);
  });
}

autoIdle.addEventListener("change", () => player.setAutoIdle(autoIdle.checked));
sampleTealButton.addEventListener("click", () => void loadSample(SAMPLE_URLS.teal));
sampleCopperButton.addEventListener("click", () => void loadSample(SAMPLE_URLS.copper));
for (const [reaction, button] of reactionButtons) {
  button.addEventListener("click", () => {
    stopShowcase("Reaction");
    if (!player.triggerReaction(reaction)) status.textContent = `${reaction} is unavailable for this character`;
  });
}
resetButton.addEventListener("click", () => {
  stopShowcase();
  player.resetToNeutral();
  resetControlInputs();
});
demoButton.addEventListener("click", async () => {
  setBusy(true);
  try { await runShowcase(); }
  finally { setBusy(false); refreshCapabilityControls(); }
});
recordButton.addEventListener("click", async () => {
  if (!currentManifest) return;
  setBusy(true);
  stopShowcase("Ready");
  status.textContent = "Recording local showcase…";
  try {
    const recording = await recordCanvasAction(canvas, runShowcase);
    const url = URL.createObjectURL(recording.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${currentManifest.id}-showcase.webm`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    status.textContent = `Recorded ${(recording.blob.size / 1024).toFixed(0)} KiB · local WebM`;
  } catch (error) {
    status.textContent = "Recording failed";
    meta.textContent = (error as Error).message;
  } finally {
    setBusy(false);
    refreshCapabilityControls();
  }
});

window.addEventListener("beforeunload", () => {
  stopShowcase();
  stopCompileProgress();
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  player.destroy();
});

refreshCapabilityControls();
compilerConfigReady = loadCompilerConfig();
