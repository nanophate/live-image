import assert from "node:assert/strict";
import test from "node:test";

import { LivingImagePlayer } from "../src/runtime.js";
import { fixtureManifest } from "./fixture.js";

class FakeContext {
  imageSmoothingEnabled = false;
  imageSmoothingQuality: ImageSmoothingQuality = "low";
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  fillStyle: string | CanvasGradient | CanvasPattern = "#000";
  readonly drawnImages: unknown[] = [];

  setTransform(): void {}
  clearRect(): void {}
  save(): void {}
  restore(): void {}
  translate(): void {}
  scale(): void {}
  beginPath(): void {}
  rect(): void {}
  clip(): void {}
  ellipse(): void {}
  fill(): void {}
  drawImage(image: unknown): void { this.drawnImages.push(image); }
}

class FakeCanvas {
  width = 0;
  height = 0;
  readonly context = new FakeContext();

  getContext(): FakeContext { return this.context; }
}

class FakeImage {
  decoding: "async" | "sync" | "auto" = "auto";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 100;
  naturalHeight = 100;
  source = "";

  set src(value: string) {
    this.source = value;
    if (value.includes("MASK")) {
      this.naturalWidth = 20;
      this.naturalHeight = 20;
    }
    queueMicrotask(() => {
      if (value.includes("BROKEN")) this.onerror?.();
      else this.onload?.();
    });
  }

  get src(): string { return this.source; }
}

test("a failed replacement load preserves the last playable character", async () => {
  const previousImage = globalThis.Image;
  const previousDocument = globalThis.document;
  Object.assign(globalThis, {
    Image: FakeImage,
    document: { createElement: () => new FakeCanvas() },
  });

  try {
    const canvas = new FakeCanvas();
    const player = new LivingImagePlayer(canvas as unknown as HTMLCanvasElement);
    const first = fixtureManifest();
    first.image.dataUrl = "data:image/png;base64,FIRST";
    const eye = first.analysis.features.eyes[0];
    assert.ok(eye);
    eye.rig.deformation = {
      method: "fixed-boundary-piecewise-affine-v1",
      sourceRows: [0.3, 0.34, 0.38, 0.46, 0.48, 0.5],
      closedRows: [0.3, 0.35, 0.418, 0.422, 0.475, 0.5],
      gazeRowWeights: [0, 0, 1, 1, 0, 0],
      region: { ...eye.region },
      protectedLineArtMask: {
        dataUrl: "data:image/png;base64,MASK",
        width: 20,
        height: 20,
        coverage: 0.1,
        method: "canny-active-aperture-v1",
        cannyLow: 20,
        cannyHigh: 50,
      },
    };
    await player.load(first);
    assert.equal(canvas.width, 100);

    const replacement = structuredClone(first);
    replacement.image.dataUrl = "data:image/png;base64,SECOND";
    const replacementEye = replacement.analysis.features.eyes[0];
    assert.ok(replacementEye?.rig.deformation);
    replacementEye.rig.deformation.protectedLineArtMask.dataUrl =
      "data:image/png;base64,BROKEN";

    await assert.rejects(
      player.load(replacement),
      /protected line-art mask could not be decoded/,
    );
    assert.equal(canvas.width, 100);

    canvas.context.drawnImages.length = 0;
    player.setAutoIdle(false);
    player.step(1 / 60);
    const source = canvas.context.drawnImages[0];
    assert.ok(source instanceof FakeImage);
    assert.equal(source.src, first.image.dataUrl);
  } finally {
    Object.assign(globalThis, { Image: previousImage, document: previousDocument });
  }
});

test("a source image with mismatched intrinsic dimensions is rejected", async () => {
  const previousImage = globalThis.Image;
  const previousDocument = globalThis.document;
  Object.assign(globalThis, {
    Image: FakeImage,
    document: { createElement: () => new FakeCanvas() },
  });

  try {
    const canvas = new FakeCanvas();
    const player = new LivingImagePlayer(canvas as unknown as HTMLCanvasElement);
    const manifest = fixtureManifest();
    manifest.image.width = 101;
    await assert.rejects(
      player.load(manifest),
      /source image dimensions do not match its manifest/,
    );
    assert.equal(canvas.width, 0);
  } finally {
    Object.assign(globalThis, { Image: previousImage, document: previousDocument });
  }
});
