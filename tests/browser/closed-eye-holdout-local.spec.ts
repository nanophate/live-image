import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const holdoutDirectory = resolve("fixtures/holdout");
const artifactDirectory = resolve(holdoutDirectory, "artifacts");
const evidenceDirectory = resolve(artifactDirectory, "closed-eye-corrective-v3-visual");
const definitions = JSON.parse(readFileSync(resolve(holdoutDirectory, "manifest.json"), "utf8")) as {
  cases: Array<{ id: string; sourceSha256: string }>;
};
const report = JSON.parse(readFileSync(resolve(holdoutDirectory, "report.json"), "utf8")) as {
  cases: Array<{
    id: string;
    sourceSha256: string;
    artifactSha256: string;
    result: "full" | "limited" | "reject" | "error";
    capabilities?: { enabled: string[]; disabled: string[] };
  }>;
};

function artifactFor(id: string): Buffer {
  return readFileSync(resolve(artifactDirectory, id, `${id}.limg`));
}

test("Compiler 0.8 hold-out artifacts preserve actual contracts in corrected mode", async ({ page }) => {
  test.skip(!existsSync(artifactDirectory), "local ignored hold-out artifacts are not available");
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

  const files = definitions.cases.map((definition) => {
    const current = report.cases.find((item) => item.id === definition.id);
    expect(current).toBeTruthy();
    const payload = artifactFor(definition.id);
    expect(createHash("sha256").update(payload).digest("hex")).toBe(current!.artifactSha256);
    const manifest = JSON.parse(payload.toString("utf8")) as {
      compiler: { version: string };
      image: { sha256: string };
      quality: { status: string; disabledCapabilities: string[] };
    };
    expect(current!.sourceSha256).toBe(definition.sourceSha256);
    expect(manifest.compiler.version).toBe("0.8.0");
    expect(manifest.image.sha256).toBe(definition.sourceSha256);
    expect(manifest.quality.status).toBe(current!.result);
    expect(manifest.quality.disabledCapabilities).toEqual(current!.capabilities?.disabled ?? []);
    return { name: `${definition.id}.limg`, mimeType: "application/json", buffer: payload };
  });

  await page.goto("/compare.html");
  await page.locator("#comparison-eye-deformation").selectOption("semantic-mesh-corrective-required");
  await page.locator("#comparison-files").setInputFiles(files);
  await expect(page.locator("#comparison-status")).toHaveText(
    "Rendered 5 characters in fixed deterministic states.",
    { timeout: 240_000 },
  );

  for (const current of report.cases) {
    if (current.result === "error") continue;
    const character = page.locator(`[data-character-id="${current.id}"]`);
    const disabled = new Set(current.capabilities?.disabled ?? []);
    const expectedSkipped = (disabled.has("blink") ? 4 : 0) + (disabled.has("gaze") ? 6 : 0) + (disabled.has("mouth") ? 3 : 0);
    await expect(character).toHaveAttribute("data-eye-deformation", "semantic-mesh-corrective-required");
    await expect(character.locator(".comparison-cell-error")).toHaveCount(0);
    await expect(character.locator(".comparison-cell-skipped")).toHaveCount(expectedSkipped);
    if (!disabled.has("blink") && current.result !== "reject") {
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

test("capture the blink-enabled hold-out endpoint for local visual review", async ({ page }) => {
  const id = "stevenburrow-sample1";
  test.skip(!existsSync(resolve(artifactDirectory, id, `${id}.limg`)), "local hold-out artifact is not available");
  test.setTimeout(120_000);
  mkdirSync(evidenceDirectory, { recursive: true });
  await page.goto("/compare.html");
  await page.locator("#comparison-eye-deformation").selectOption("semantic-mesh-corrective-required");
  await page.locator("#comparison-files").setInputFiles({
    name: `${id}.limg`,
    mimeType: "application/json",
    buffer: artifactFor(id),
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
});
