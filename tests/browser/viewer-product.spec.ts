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

test("viewer-only mode keeps the loaded character when PNG compilation is unavailable", async ({ page }) => {
  const configRequests: string[] = [];
  const compileRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/config") {
      configRequests.push(request.url());
    }
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/compile") {
      compileRequests.push(request.url());
    }
  });

  await page.goto("/viewer.html");
  await expect(page.locator("#file-button-label")).toHaveText("Open .limg");
  await expect(page.locator("#compiler-note")).toContainText("never sent to the Compiler");
  await page.locator("#file-input").setInputFiles({
    name: "teal-librarian.limg",
    mimeType: "application/json",
    buffer: compiledRig(),
  });
  await expect(page.locator("#character-name")).toHaveText("teal librarian");
  await expect(page.locator("#blink-button")).toBeEnabled();

  await page.locator("#file-input").setInputFiles({
    name: "should-not-upload.png",
    mimeType: "image/png",
    buffer: readFileSync(resolve("fixtures/source/teal-librarian.png")),
  });

  await expect(page.locator("#render-status")).toHaveText("Viewer accepts .limg files only");
  await expect(page.locator("#character-name")).toHaveText("teal librarian");
  await expect(page.locator("#blink-button")).toBeEnabled();
  await expect(page.locator("#character-meta")).toContainText("Use the Compiler path");
  expect(configRequests).toEqual([]);
  expect(compileRequests).toEqual([]);
});

test("hosted mode explains a non-JSON access-gateway rejection", async ({ page }) => {
  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ compiler: "hosted", enabled: true, samplesAvailable: false }),
    });
  });
  await page.route("**/api/compile", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "text/html",
      headers: { "X-Request-Id": "access-test-1" },
      body: "<html><body>Cloudflare Access</body></html>",
    });
  });

  await page.goto("/compiler.html");
  await expect(page.locator("#file-button-label")).toHaveText("Open PNG or JPEG");
  await page.locator("#file-input").setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: readFileSync(resolve("fixtures/source/teal-librarian.png")),
  });

  await expect(page.locator("#render-status")).toHaveText("Compilation unavailable");
  await expect(page.locator("#character-meta")).toContainText("Hosted compiler returned HTTP 401");
  await expect(page.locator("#character-meta")).toContainText("request access-test-1");
});

test("Compiler shows honest progress and a plain-language unsupported result", async ({ page }) => {
  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        compiler: "hosted",
        enabled: true,
        authentication: "cloudflare-access",
        samplesAvailable: false,
        provider: "cloudflare",
      }),
    });
  });
  await page.route("**/api/compile", async (route) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_800));
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        status: "reject",
        rejectionReasons: [
          "no near-frontal anime face detected",
          ...Array.from({ length: 12 }, (_, index) => `additional detector detail ${index + 1}`),
        ],
      }),
    });
  });

  await page.goto("/compiler.html");
  await page.locator("#file-input").setInputFiles({
    name: "unsupported.png",
    mimeType: "image/png",
    buffer: readFileSync(resolve("fixtures/source/unsupported-no-face.png")),
  });

  await expect(page.locator("#compile-progress")).toBeVisible();
  await expect(page.locator("#compile-progress strong")).toHaveText("Compiling character…");
  await expect(page.getByRole("progressbar", { name: "Compilation in progress" })).toBeVisible();
  await expect(page.locator("#render-status")).toHaveText("Compiling character…");
  await expect(page.locator("#compile-elapsed")).toContainText("elapsed", { timeout: 2_000 });
  await expect(page.locator("#render-status")).toHaveText("This image isn’t supported yet");
  await expect(page.locator("#compile-progress")).toBeHidden();
  await expect(page.locator("#compile-result")).toBeVisible();
  await expect(page.locator("#compile-result strong")).toHaveText("This image isn’t supported yet");
  await expect(page.locator("#compile-result")).toContainText("No character file created");
  await expect(page.locator("#compile-result")).toContainText("no near-frontal anime face detected");
  await expect(page.getByRole("button", { name: "Try another image" })).toBeVisible();
  await expect(page.locator("#quality-card .quality-head strong")).toHaveText("not supported");
  await expect(page.locator("#quality-card")).toContainText("Nothing is broken");
  await expect(page.locator("#quality-card")).toContainText("no near-frontal anime face detected");

  await page.setViewportSize({ width: 390, height: 667 });
  const resultLayout = await page.locator(".compile-result-card").evaluate((element) => ({
    cardHeight: element.clientHeight,
    overlayHeight: element.parentElement?.clientHeight ?? 0,
    scrollHeight: element.scrollHeight,
  }));
  expect(resultLayout.cardHeight).toBeLessThanOrEqual(resultLayout.overlayHeight);
  expect(resultLayout.scrollHeight).toBeGreaterThan(resultLayout.cardHeight);
  await page.getByRole("button", { name: "Try another image" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Try another image" })).toBeInViewport();
});

test("Compiler hands a successful character directly to the separate Viewer without another upload", async ({ page }) => {
  const compileRequests: string[] = [];
  const viewerRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === "/api/compile") compileRequests.push(request.url());
    if (url.pathname === "/viewer.html") viewerRequests.push(request.url());
  });
  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        compiler: "hosted",
        enabled: true,
        authentication: "cloudflare-access",
        samplesAvailable: false,
        provider: "cloudflare",
      }),
    });
  });
  await page.route("**/api/compile", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: compiledRig() });
  });

  await page.goto("/compiler.html");
  await page.locator("#file-input").setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: readFileSync(resolve("fixtures/source/teal-librarian.png")),
  });

  await expect(page.locator("#compile-success")).toBeVisible();
  await expect(page.locator("#compile-success .compile-success-card > strong")).toHaveText("Your character is ready");
  await expect(page.locator("#success-download-limg")).toHaveAttribute("download", "teal-librarian.limg");
  await expect(page.getByRole("button", { name: "Open in Viewer" })).toBeVisible();
  await page.getByRole("button", { name: "Open in Viewer" }).evaluate((element) => {
    const button = element as HTMLButtonElement;
    button.disabled = true;
    button.textContent = "Opening…";
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect(page.getByRole("button", { name: "Open in Viewer" })).toBeEnabled();
  await page.getByRole("button", { name: "Open in Viewer" }).click();

  await page.waitForURL("**/viewer.html");
  await expect(page.locator("#render-status")).toHaveText("Ready · local deterministic runtime");
  await expect(page.locator("#character-name")).toHaveText("teal librarian");
  await expect(page.locator("#blink-button")).toBeEnabled();
  await expect(page.locator("#download-limg")).toHaveAttribute("download", "teal-librarian.limg");
  await expect(page.locator("#compiler-note")).toContainText("Opened directly from the Compiler");
  expect(page.url()).not.toContain("handoff=");
  expect(compileRequests).toHaveLength(1);
  expect(viewerRequests).toHaveLength(1);
  expect(viewerRequests[0]).not.toContain("handoff=");

  const temporaryRecordCount = await page.evaluate(() => new Promise<number>((resolveCount, rejectCount) => {
    const request = indexedDB.open("living-image-handoff", 1);
    request.onerror = () => rejectCount(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("characters", "readonly");
      const countRequest = transaction.objectStore("characters").count();
      countRequest.onerror = () => rejectCount(countRequest.error);
      countRequest.onsuccess = () => {
        database.close();
        resolveCount(countRequest.result);
      };
    };
  }));
  expect(temporaryRecordCount).toBe(0);
});

test("a temporary Compiler handoff can be consumed by only one Viewer tab", async ({ page }) => {
  const key = "a81de024-6b7c-4a26-9d63-54e608713869";
  const payload = compiledRig().toString("utf8");
  await page.goto("/viewer.html");
  await page.evaluate(async ({ handoffKey, handoffPayload }) => {
    await new Promise<void>((resolveWrite, rejectWrite) => {
      const openRequest = indexedDB.open("living-image-handoff", 1);
      openRequest.onerror = () => rejectWrite(openRequest.error);
      openRequest.onupgradeneeded = () => {
        if (!openRequest.result.objectStoreNames.contains("characters")) {
          openRequest.result.createObjectStore("characters", { keyPath: "key" });
        }
      };
      openRequest.onsuccess = () => {
        const database = openRequest.result;
        const transaction = database.transaction("characters", "readwrite");
        transaction.objectStore("characters").put({
          key: handoffKey,
          blob: new Blob([handoffPayload], { type: "application/json" }),
          filename: "teal-librarian.limg",
          createdAt: Date.now(),
        });
        transaction.oncomplete = () => { database.close(); resolveWrite(); };
        transaction.onerror = () => rejectWrite(transaction.error);
      };
    });
  }, { handoffKey: key, handoffPayload: payload });

  const secondViewer = await page.context().newPage();
  await Promise.all([
    page.goto(`/viewer.html?consumer=one#handoff=${key}`),
    secondViewer.goto(`/viewer.html?consumer=two#handoff=${key}`),
  ]);
  await expect(page.locator("#render-status")).toContainText(/Ready|Couldn’t open/u);
  await expect(secondViewer.locator("#render-status")).toContainText(/Ready|Couldn’t open/u);
  const outcomes = await Promise.all([
    page.locator("#render-status").textContent(),
    secondViewer.locator("#render-status").textContent(),
  ]);
  expect(outcomes.filter((outcome) => outcome === "Ready · local deterministic runtime")).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome === "Couldn’t open transferred character")).toHaveLength(1);
  expect(page.url()).not.toContain("handoff=");
  expect(secondViewer.url()).not.toContain("handoff=");
  await secondViewer.close();
});

test("Compiler keeps the downloadable character when temporary browser storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });
  });
  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        compiler: "hosted",
        enabled: true,
        authentication: "cloudflare-access",
        samplesAvailable: false,
        provider: "cloudflare",
      }),
    });
  });
  await page.route("**/api/compile", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: compiledRig() });
  });

  await page.goto("/compiler.html");
  await page.locator("#file-input").setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: readFileSync(resolve("fixtures/source/teal-librarian.png")),
  });
  await expect(page.locator("#compile-success")).toBeVisible();
  await page.getByRole("button", { name: "Open in Viewer" }).click();

  await expect(page.locator("#render-status")).toHaveText("Couldn’t open Viewer automatically");
  await expect(page.locator("#character-meta")).toContainText("private or in-app browsers");
  await expect(page.locator("#handoff-guidance")).toBeVisible();
  await expect(page.locator("#handoff-guidance")).toContainText("Download the .limg");
  await expect(page.locator("#handoff-guidance").getByRole("link", { name: "Open Viewer" })).toHaveAttribute("href", "/viewer.html");
  await expect(page.locator("#success-download-limg")).toHaveAttribute("download", "teal-librarian.limg");
  await expect(page.locator("#success-download-limg")).toHaveText("Download .limg (recommended)");
  await expect(page.locator("#success-download-limg")).not.toHaveClass(/secondary/u);
  await expect(page.getByRole("button", { name: "Try opening Viewer again" })).toBeEnabled();
});

test("Hugging Face hosted mode discloses provider processing and sensitive-image boundary", async ({ page }) => {
  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        compiler: "hosted",
        enabled: true,
        samplesAvailable: false,
        provider: "hugging-face",
      }),
    });
  });

  await page.goto("/compiler.html");
  await expect(page.locator("#deployment-label")).toHaveText("Hosted Compiler");
  await expect(page.locator("#compiler-note")).toContainText("hosted by Hugging Face");
  await expect(page.locator("#compiler-note")).toContainText("provider may process network and operational logs");
  await expect(page.locator("#compiler-note")).toContainText("Do not upload sensitive images");
});
