import type { LivingImageManifest } from "../schema.js";

export const SAMPLE_URLS = {
  teal: "/fixtures/compiled/teal-librarian.limg",
  copper: "/fixtures/compiled/copper-courier.limg",
} as const;

export function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
}

export function renderQuality(container: HTMLElement, manifest: LivingImageManifest): void {
  const quality = manifest.quality;
  const messages = [...quality.rejectionReasons, ...quality.warnings];
  container.hidden = false;
  container.innerHTML = `
    <div class="quality-head"><strong>${quality.status}</strong><output>${quality.score.toFixed(3)}</output></div>
    <p>${quality.disabledCapabilities.length ? `Disabled: ${quality.disabledCapabilities.join(", ")}` : "Blink, gaze, mouth and breath available."}</p>
    ${messages.length ? `<ul>${messages.map((message) => `<li>${escapeHtml(message)}</li>`).join("")}</ul>` : ""}
  `;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

