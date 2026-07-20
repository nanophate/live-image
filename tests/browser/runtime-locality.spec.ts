import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Locator } from "@playwright/test";

interface CellMetrics {
  inside: number;
  outside: number;
  maxChannelDelta: number;
  visible: boolean;
  protection: {
    corePixels: number;
    coreErrorPixels: number;
    coreMaxRgbDelta: number;
    clearMaskPixels: number;
    clearMaskChangedPixels: number;
    eyes: Array<{
      side: "left" | "right";
      metrics: {
        corePixels: number;
        coreErrorPixels: number;
        coreMaxRgbDelta: number;
        clearMaskPixels: number;
        clearMaskChangedPixels: number;
      };
    }>;
  } | null;
  iris: Array<{
    side: "left" | "right";
    alpha: number;
    shiftX: number;
    shiftY: number;
    radiusX: number;
    radiusY: number;
    renderedTexturePixels: number;
  }>;
}

function compiledRig(name: "teal-librarian" | "copper-courier"): Buffer {
  const manifest = JSON.parse(
    readFileSync(resolve(`fixtures/browser/${name}.rig.json`), "utf8"),
  ) as { image: { mimeType: string; sha256: string; dataUrl?: string } };
  const source = readFileSync(resolve(`fixtures/source/${name}.png`));
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  if (manifest.image.dataUrl !== undefined || sourceSha256 !== manifest.image.sha256) {
    throw new Error(`${name} browser rig does not match its tracked source image`);
  }
  manifest.image.dataUrl = `data:${manifest.image.mimeType};base64,${source.toString("base64")}`;
  return Buffer.from(JSON.stringify(manifest));
}

async function cellMetrics(character: Locator, state: string): Promise<CellMetrics> {
  const cell = character.locator(`[data-state="${state}"]`);
  await expect(cell).toBeAttached();
  const visibleEffect = await cell.getAttribute("data-visible-effect");
  if (visibleEffect === null) {
    const renderedErrors = await cell.locator(".comparison-render-error, .comparison-error-text").allTextContents();
    throw new Error(`${state} did not produce pixel evidence: ${renderedErrors.join(" · ") || "unknown render error"}`);
  }
  expect(visibleEffect).toMatch(/^(true|false)$/);
  return cell.evaluate((element) => {
    const dataset = (element as HTMLElement).dataset;
    return {
      inside: Number(dataset.insideChangedPixels),
      outside: Number(dataset.outsideChangedPixels),
      maxChannelDelta: Number(dataset.maxChannelDelta),
      visible: dataset.visibleEffect === "true",
      protection: dataset.protectedCorePixels === undefined
        ? null
        : {
          corePixels: Number(dataset.protectedCorePixels),
          coreErrorPixels: Number(dataset.protectedCoreErrorPixels),
          coreMaxRgbDelta: Number(dataset.protectedCoreMaxRgbDelta),
          clearMaskPixels: Number(dataset.clearMaskPixels),
          clearMaskChangedPixels: Number(dataset.clearMaskChangedPixels),
          eyes: JSON.parse(dataset.protectionByEye ?? "[]"),
        },
      iris: JSON.parse(dataset.irisByEye ?? "[]"),
    };
  });
}

test("automatic rigs keep browser-rendered motion inside compiler feature regions", async ({ page }) => {
  const browserErrors: string[] = [];
  const externalRequests: string[] = [];
  const evidence: Record<string, Record<string, CellMetrics>> = {};
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:4174" && url.protocol !== "blob:") {
      externalRequests.push(request.url());
    }
  });

  await page.goto("/compare.html");
  await page.locator("#comparison-files").setInputFiles([
    { name: "teal-librarian.limg", mimeType: "application/json", buffer: compiledRig("teal-librarian") },
    { name: "copper-courier.limg", mimeType: "application/json", buffer: compiledRig("copper-courier") },
  ]);
  await expect(page.locator("#comparison-status")).toHaveText(
    "Rendered 2 characters in fixed deterministic states.",
    { timeout: 120_000 },
  );

  const controlledStates = [
    "blink-mid", "blink-full", "wink-left", "wink-right",
    "gaze-left", "gaze-right", "gaze-up", "gaze-down",
    "mouth-small", "mouth-open", "stress-gaze-left", "stress-gaze-right",
    "stress-mouth",
  ];
  const eyeStates = new Set([
    "blink-mid", "blink-full", "wink-left", "wink-right",
    "gaze-left", "gaze-right", "gaze-up", "gaze-down",
    "stress-gaze-left", "stress-gaze-right",
  ]);
  for (const characterId of ["teal-librarian", "copper-courier"]) {
    const character = page.locator(`[data-character-id="${characterId}"]`);
    const characterEvidence: Record<string, CellMetrics> = {};
    const irisGeometry = new Map<string, { radiusX: number; radiusY: number }>();
    evidence[characterId] = characterEvidence;
    await expect(character).toBeVisible();
    characterEvidence.neutral = await cellMetrics(character, "neutral");
    expect(characterEvidence.neutral).toEqual({
      inside: 0,
      outside: 0,
      maxChannelDelta: 0,
      visible: false,
      protection: null,
      iris: [],
    });
    for (const state of controlledStates) {
      const metrics = await cellMetrics(character, state);
      characterEvidence[state] = metrics;
      expect(metrics.visible, `${characterId}/${state} should visibly change its allowed ROI`).toBe(true);
      expect(metrics.inside, `${characterId}/${state} should change at least one allowed pixel`).toBeGreaterThan(0);
      expect(metrics.outside, `${characterId}/${state} leaked outside its allowed ROI`).toBe(0);
      expect(metrics.maxChannelDelta, `${characterId}/${state} should have a non-zero channel delta`).toBeGreaterThan(0);
      if (eyeStates.has(state)) {
        expect(metrics.protection, `${characterId}/${state} should expose protected-mask evidence`).not.toBeNull();
        const expectedEyeCount = state.startsWith("wink-") ? 1 : 2;
        expect(metrics.protection!.eyes, `${characterId}/${state} should report every selected eye`).toHaveLength(expectedEyeCount);
        expect(metrics.iris, `${characterId}/${state} should report every selected iris`).toHaveLength(expectedEyeCount);
        for (const eye of metrics.protection!.eyes) {
          const label = `${characterId}/${state}/${eye.side}`;
          expect(eye.metrics.corePixels, `${label} needs a non-empty protected core`).toBeGreaterThan(0);
          expect(eye.metrics.coreErrorPixels, `${label} changed protected core pixels`).toBe(0);
          expect(eye.metrics.coreMaxRgbDelta, `${label} exceeded protected RGB tolerance`).toBeLessThanOrEqual(1);
          expect(eye.metrics.clearMaskPixels, `${label} needs non-empty clear-mask evidence`).toBeGreaterThan(0);
          expect(eye.metrics.clearMaskChangedPixels, `${label} should move clear-mask pixels`).toBeGreaterThan(0);
        }
        for (const iris of metrics.iris) {
          const label = `${characterId}/${state}/${iris.side}`;
          expect(iris.alpha, `${label} alpha should stay normalized`).toBeGreaterThanOrEqual(0);
          expect(iris.alpha, `${label} alpha should stay normalized`).toBeLessThanOrEqual(1);
          expect(iris.radiusX, `${label} needs a horizontal cage radius`).toBeGreaterThan(0);
          expect(iris.radiusY, `${label} needs a vertical cage radius`).toBeGreaterThan(0);
          const canonical = irisGeometry.get(iris.side);
          if (canonical) {
            expect(iris.radiusX, `${label} changed rigid cage width`).toBe(canonical.radiusX);
            expect(iris.radiusY, `${label} changed rigid cage height`).toBe(canonical.radiusY);
          } else {
            irisGeometry.set(iris.side, { radiusX: iris.radiusX, radiusY: iris.radiusY });
          }
          const closed = state === "blink-full" || state.startsWith("wink-");
          if (closed) {
            expect(iris.alpha, `${label} must be invisible at full close`).toBe(0);
            expect(iris.renderedTexturePixels, `${label} rendered texture must vanish at full close`).toBe(0);
            expect(Math.abs(iris.shiftX), `${label} should return horizontal gaze at close`).toBeLessThan(1e-9);
            expect(Math.abs(iris.shiftY), `${label} should return vertical gaze at close`).toBeLessThan(1e-9);
          } else {
            expect(iris.alpha, `${label} should remain visible before full close`).toBeGreaterThan(0);
            expect(iris.renderedTexturePixels, `${label} must contain direct rendered-texture pixels`).toBeGreaterThan(0);
          }
          if (state.includes("gaze-left")) expect(iris.shiftX, `${label} should translate left`).toBeLessThan(0);
          if (state.includes("gaze-right")) expect(iris.shiftX, `${label} should translate right`).toBeGreaterThan(0);
          if (state === "gaze-up") expect(iris.shiftY, `${label} should translate up`).toBeLessThan(0);
          if (state === "gaze-down") expect(iris.shiftY, `${label} should translate down`).toBeGreaterThan(0);
        }
      } else {
        expect(metrics.protection, `${characterId}/${state} should not report eye-mask evidence`).toBeNull();
        expect(metrics.iris, `${characterId}/${state} should not report iris evidence`).toEqual([]);
      }
    }
    await expect(character.locator(".comparison-timeline-evidence")).toHaveAttribute(
      "data-differing-pixels",
      "0",
    );
    await expect(character.locator(".comparison-cell-error")).toHaveCount(0);
  }

  expect(browserErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
  console.log(`LOCALITY_EVIDENCE ${JSON.stringify(evidence)}`);
});
