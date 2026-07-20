import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

function compiledRig(): Buffer {
  const manifest = JSON.parse(readFileSync(resolve("fixtures/browser/teal-librarian.rig.json"), "utf8")) as {
    image: { mimeType: string; sha256: string; dataUrl?: string };
  };
  const source = readFileSync(resolve("fixtures/source/teal-librarian.png"));
  expect(createHash("sha256").update(source).digest("hex")).toBe(manifest.image.sha256);
  manifest.image.dataUrl = `data:${manifest.image.mimeType};base64,${source.toString("base64")}`;
  return Buffer.from(JSON.stringify(manifest));
}

test("product Viewer runs capability-gated reactions, showcase, and local WebM recording", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("404")) browserErrors.push(message.text());
  });

  await page.goto("/viewer.html");
  await page.locator("#file-input").setInputFiles({
    name: "teal-librarian.limg",
    mimeType: "application/json",
    buffer: compiledRig(),
  });
  await expect(page.locator("#render-status")).toHaveText("Ready · local deterministic runtime", { timeout: 30_000 });
  await expect(page.locator("#character-name")).toHaveText("teal librarian");
  await expect(page.locator("#quality-card .quality-head strong")).toHaveText("full");
  await expect(page.locator("#blink-button")).toBeEnabled();
  await expect(page.locator("#talk-button")).toBeEnabled();
  await expect(page.locator("#demo-button")).toBeEnabled();

  await page.locator("#auto-idle").uncheck();
  await page.locator("#reset-button").click();
  const canvasChecksum = async (): Promise<number> => page.locator("#character-canvas").evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    const pixels = element.getContext("2d")!.getImageData(0, 0, element.width, element.height).data;
    let checksum = 0;
    for (let index = 0; index < pixels.length; index += 4096) checksum = (checksum + (pixels[index] ?? 0)) % 1_000_000_007;
    return checksum;
  });
  const neutralChecksum = await canvasChecksum();
  await page.locator("#blink-button").click();
  await page.waitForTimeout(60);
  expect(await canvasChecksum()).not.toBe(neutralChecksum);

  await page.locator('[data-control="gazeX"]').fill("0.75");
  await page.waitForTimeout(100);
  expect(await canvasChecksum()).not.toBe(neutralChecksum);

  await page.locator("#demo-button").click();
  await expect(page.locator("#showcase-label")).toHaveText("Complete", { timeout: 10_000 });
  await expect(page.locator("#showcase-progress")).toHaveJSProperty("value", 1);
  await expect(page.locator("#gazeX-output")).toHaveText("0.00");
  await expect(page.locator("#mouthOpen-output")).toHaveText("0.00");
  expect(await canvasChecksum()).toBe(neutralChecksum);

  await page.locator('[data-control="gazeX"]').fill("-0.75");
  await page.waitForTimeout(100);
  expect(await canvasChecksum()).not.toBe(neutralChecksum);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#record-button").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("teal-librarian-showcase.webm");
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(statSync(path!).size).toBeGreaterThan(1_000);
  const evidencePath = testInfo.outputPath("teal-librarian-showcase.webm");
  await download.saveAs(evidencePath);
  expect(statSync(evidencePath).size).toBeGreaterThan(1_000);
  await expect(page.locator("#render-status")).toContainText("local WebM");
  expect(await canvasChecksum()).toBe(neutralChecksum);
  expect(browserErrors).toEqual([]);
});
