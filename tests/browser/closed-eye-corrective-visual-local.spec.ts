import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const artifactDirectory = resolve("fixtures/validation/artifacts/closed-eye-corrective-v3-first-run");
const evidenceDirectory = resolve("fixtures/validation/artifacts/closed-eye-corrective-v3-visual");

test("capture three supported corrective candidates for visual review", async ({ page }) => {
  test.skip(!existsSync(artifactDirectory), "local ignored corrective artifacts are not available");
  test.setTimeout(240_000);
  mkdirSync(evidenceDirectory, { recursive: true });
  for (const id of ["clean-teal", "dark-iris-navy", "glasses-round"] as const) {
    const payload = readFileSync(resolve(artifactDirectory, `${id}.limg`));
    await page.goto("/compare.html");
    await page.locator("#comparison-eye-deformation").selectOption("semantic-mesh-corrective-required");
    await page.locator("#comparison-files").setInputFiles({
      name: `${id}.limg`,
      mimeType: "application/json",
      buffer: payload,
    });
    await expect(page.locator("#comparison-status")).toHaveText(
      "Rendered 1 character in fixed deterministic states.",
      { timeout: 120_000 },
    );
    for (const state of ["blink-mid", "blink-full", "wink-left", "wink-right"] as const) {
      const downloadPromise = page.waitForEvent("download");
      await page.locator(`[data-character-id="${id}"] [data-state="${state}"] a`, { hasText: "Full PNG" }).click();
      const download = await downloadPromise;
      await download.saveAs(resolve(evidenceDirectory, `${id}-${state}.png`));
    }
    await page.locator(`[data-character-id="${id}"] .comparison-cell`).evaluateAll((cells) => {
      const visible = new Set(["neutral", "blink-mid", "blink-full", "wink-left", "wink-right"]);
      for (const cell of cells) {
        if (!visible.has((cell as HTMLElement).dataset.state ?? "")) (cell as HTMLElement).style.display = "none";
      }
    });
    await page.locator(`[data-character-id="${id}"] .comparison-timeline`).evaluate((element) => {
      (element as HTMLElement).style.display = "none";
    });
    await page.locator(`[data-character-id="${id}"]`).screenshot({
      path: resolve(evidenceDirectory, `${id}-strip.png`),
    });
  }
});
