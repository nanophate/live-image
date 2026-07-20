import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const artifactDirectory = resolve("fixtures/validation/artifacts/closed-eye-corrective-v3-first-run");
const frozen = JSON.parse(
  readFileSync(resolve("fixtures/validation/semantic-mesh-v1.manifest.json"), "utf8"),
) as {
  cases: Array<{
    id: string;
    sourceSha256: string;
    expectedStatus: "full" | "limited" | "reject";
    expectedDisabledCapabilities: string[];
  }>;
};

test("local closed-eye candidate preserves frozen contracts and fails no required render", async ({ page }) => {
  test.skip(!existsSync(artifactDirectory), "local ignored corrective artifacts are not available");
  test.setTimeout(240_000);
  const browserErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:4174" && url.protocol !== "blob:") externalRequests.push(request.url());
  });

  const files = frozen.cases.map((definition) => {
    const payload = readFileSync(resolve(artifactDirectory, `${definition.id}.limg`));
    const manifest = JSON.parse(payload.toString("utf8")) as {
      compiler: { version: string };
      image: { sha256: string };
      quality: { status: string; disabledCapabilities: string[] };
      analysis: { features: { eyes: Array<{ rig: { deformation?: { semanticMesh?: unknown; closedEye?: unknown } } }> } };
    };
    expect(manifest.compiler.version).toBe("0.8.0");
    expect(manifest.image.sha256).toBe(definition.sourceSha256);
    expect(manifest.quality.status).toBe(definition.expectedStatus);
    expect(manifest.quality.disabledCapabilities).toEqual(definition.expectedDisabledCapabilities);
    expect(manifest.analysis.features.eyes.every((eye) => eye.rig.deformation?.semanticMesh)).toBe(true);
    expect(manifest.analysis.features.eyes.every((eye) => eye.rig.deformation?.closedEye)).toBe(true);
    return { name: `${definition.id}.limg`, mimeType: "application/json", buffer: payload };
  });

  await page.goto("/compare.html");
  await page.locator("#comparison-eye-deformation").selectOption("semantic-mesh-corrective-required");
  await page.locator("#comparison-files").setInputFiles(files);
  await expect(page.locator("#comparison-status")).toHaveText(
    "Rendered 6 characters in fixed deterministic states.",
    { timeout: 240_000 },
  );

  for (const definition of frozen.cases) {
    const character = page.locator(`[data-character-id="${definition.id}"]`);
    await expect(character).toHaveAttribute("data-eye-deformation", "semantic-mesh-corrective-required");
    await expect(character.locator(".comparison-cell-error")).toHaveCount(0);
    const disabled = new Set(definition.expectedDisabledCapabilities);
    const expectedSkipped = (disabled.has("blink") ? 4 : 0) + (disabled.has("gaze") ? 6 : 0) + (disabled.has("mouth") ? 3 : 0);
    await expect(character.locator(".comparison-cell-skipped")).toHaveCount(expectedSkipped);
    if (!disabled.has("blink")) {
      for (const state of ["blink-mid", "blink-full", "wink-left", "wink-right"]) {
        const cell = character.locator(`[data-state="${state}"]`);
        await expect(cell).toHaveAttribute("data-visible-effect", "true");
        await expect(cell).toHaveAttribute("data-outside-changed-pixels", "0");
      }
    }
  }

  expect(browserErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});
