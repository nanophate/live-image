import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const sourceArtifact = resolve("fixtures/validation/artifacts/semantic-mesh-v1-first-run/clean-teal.limg");
const evidenceDirectory = resolve("fixtures/validation/artifacts/semantic-mesh-v1-visual");

test("capture local bounded and semantic blink strips for visual review", async ({ page }) => {
  test.skip(!existsSync(sourceArtifact), "local ignored first-run artifact is not available");
  mkdirSync(evidenceDirectory, { recursive: true });
  const payload = readFileSync(sourceArtifact);
  for (const mode of ["row-grid", "semantic-mesh-required"] as const) {
    await page.goto("/compare.html");
    await page.locator("#comparison-eye-deformation").selectOption(mode);
    await page.locator("#comparison-files").setInputFiles({
      name: "clean-teal.limg",
      mimeType: "application/json",
      buffer: payload,
    });
    await expect(page.locator("#comparison-status")).toHaveText(
      "Rendered 1 character in fixed deterministic states.",
      { timeout: 120_000 },
    );
    for (const state of ["blink-mid", "blink-full"] as const) {
      const downloadPromise = page.waitForEvent("download");
      await page.locator(`[data-character-id=clean-teal] [data-state=${state}] a`, { hasText: "Full PNG" }).click();
      const download = await downloadPromise;
      await download.saveAs(resolve(evidenceDirectory, `clean-teal-${mode}-${state}-full.png`));
    }
    await page.locator("[data-character-id=clean-teal] .comparison-cell").evaluateAll((cells) => {
      const visible = new Set(["neutral", "blink-mid", "blink-full", "wink-left"]);
      for (const cell of cells) {
        if (!visible.has((cell as HTMLElement).dataset.state ?? "")) (cell as HTMLElement).style.display = "none";
      }
    });
    await page.locator("[data-character-id=clean-teal] .comparison-timeline").evaluate((element) => {
      (element as HTMLElement).style.display = "none";
    });
    await page.locator("[data-character-id=clean-teal]").screenshot({
      path: resolve(evidenceDirectory, `clean-teal-${mode}.png`),
    });
  }
});
