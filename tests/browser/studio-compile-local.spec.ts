import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const studioUrl = process.env.LIVING_IMAGE_STUDIO_URL;

test("local Studio compiles PNG, exposes .limg, and immediately runs the showcase", async ({ page }, testInfo) => {
  test.skip(!studioUrl, "set LIVING_IMAGE_STUDIO_URL to an already-running local Studio");
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(`${studioUrl}/compiler.html`);
  await page.locator("#file-input").setInputFiles({
    name: "teal-studio-review.png",
    mimeType: "image/png",
    buffer: readFileSync(resolve("fixtures/source/teal-librarian.png")),
  });
  await expect(page.locator("#render-status")).toHaveText("Compiled · ready to review", { timeout: 120_000 });
  await expect(page.locator("#quality-card .quality-head strong")).toHaveText("full");
  await expect(page.locator("#download-limg")).toBeVisible();
  await expect(page.locator("#download-limg")).toHaveAttribute("download", "teal-studio-review.limg");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#download-limg").click();
  const download = await downloadPromise;
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  expect(statSync(downloadedPath!).size).toBeGreaterThan(1_000_000);

  await page.locator("#demo-button").click();
  await page.waitForTimeout(3_250);
  await page.screenshot({ path: testInfo.outputPath("studio-showcase.png"), fullPage: true });
  await expect(page.locator("#showcase-label")).toHaveText("Complete", { timeout: 10_000 });
  expect(errors).toEqual([]);
});

test("local Studio clearly rejects an unsupported image without exposing a character download", async ({ page }) => {
  test.skip(!studioUrl, "set LIVING_IMAGE_STUDIO_URL to an already-running local Studio");
  test.setTimeout(120_000);

  await page.goto(`${studioUrl}/compiler.html`);
  await page.locator("#file-input").setInputFiles({
    name: "unsupported-no-face.png",
    mimeType: "image/png",
    buffer: readFileSync(resolve("fixtures/source/unsupported-no-face.png")),
  });

  await expect(page.locator("#render-status")).toHaveText("Not supported · no character file created", { timeout: 120_000 });
  await expect(page.locator("#quality-card .quality-head strong")).toHaveText("reject");
  await expect(page.locator("#quality-card")).toContainText("no near-frontal anime face detected");
  await expect(page.locator("#download-limg")).toBeHidden();
  await expect(page.locator("#demo-button")).toBeDisabled();
  await expect(page.locator("#record-button")).toBeDisabled();
});
