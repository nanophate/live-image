import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Locator } from "@playwright/test";

interface CellMetrics {
  inside: number;
  outside: number;
  maxChannelDelta: number;
  visible: boolean;
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
  await expect(cell).toHaveAttribute("data-visible-effect", /^(true|false)$/);
  return cell.evaluate((element) => ({
    inside: Number((element as HTMLElement).dataset.insideChangedPixels),
    outside: Number((element as HTMLElement).dataset.outsideChangedPixels),
    maxChannelDelta: Number((element as HTMLElement).dataset.maxChannelDelta),
    visible: (element as HTMLElement).dataset.visibleEffect === "true",
  }));
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
  for (const characterId of ["teal-librarian", "copper-courier"]) {
    const character = page.locator(`[data-character-id="${characterId}"]`);
    const characterEvidence: Record<string, CellMetrics> = {};
    evidence[characterId] = characterEvidence;
    await expect(character).toBeVisible();
    await expect(character.locator(".comparison-cell-error")).toHaveCount(0);
    characterEvidence.neutral = await cellMetrics(character, "neutral");
    expect(characterEvidence.neutral).toEqual({
      inside: 0,
      outside: 0,
      maxChannelDelta: 0,
      visible: false,
    });
    for (const state of controlledStates) {
      const metrics = await cellMetrics(character, state);
      characterEvidence[state] = metrics;
      expect(metrics.visible, `${characterId}/${state} should visibly change its allowed ROI`).toBe(true);
      expect(metrics.inside, `${characterId}/${state} should change at least one allowed pixel`).toBeGreaterThan(0);
      expect(metrics.outside, `${characterId}/${state} leaked outside its allowed ROI`).toBe(0);
      expect(metrics.maxChannelDelta, `${characterId}/${state} should have a non-zero channel delta`).toBeGreaterThan(0);
    }
    await expect(character.locator(".comparison-timeline-evidence")).toHaveAttribute(
      "data-differing-pixels",
      "0",
    );
  }

  expect(browserErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
  console.log(`LOCALITY_EVIDENCE ${JSON.stringify(evidence)}`);
});
