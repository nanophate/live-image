import assert from "node:assert/strict";
import test from "node:test";

import { LivingImagePlayer } from "../src/runtime.js";
import { fixtureManifest } from "./fixture.js";

const CLOSED_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAAAAACo4kLRAAAAKklEQVQYGW3BAQEAAABAIP6fdkDJkCFDhgwZMmTIkCFDhgwZMmTIkCFDRhLeABUEcxpKAAAAAElFTkSuQmCC";

class FakeContext {
  imageSmoothingEnabled = false;
  imageSmoothingQuality: ImageSmoothingQuality = "low";
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  globalAlpha = 1;
  fillStyle: string | CanvasGradient | CanvasPattern = "#000";
  readonly drawnImages: unknown[] = [];

  setTransform(): void {}
  clearRect(): void {}
  save(): void {}
  restore(): void {}
  translate(): void {}
  scale(): void {}
  transform(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  rect(): void {}
  clip(): void {}
  ellipse(): void {}
  fill(): void {}
  fillRect(): void {}
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
    if (value.includes("MASK") || value.includes("BASE") || value.includes("IRIS") || value === CLOSED_PNG) {
      this.naturalWidth = 20;
      this.naturalHeight = 20;
    }
    if (value.includes("WIDE")) this.naturalWidth = 21;
    queueMicrotask(() => {
      if (value.includes("BROKEN") || value.includes("FAIL")) this.onerror?.();
      else this.onload?.();
    });
  }

  get src(): string { return this.source; }
}

function addIrisLayers(manifest: ReturnType<typeof fixtureManifest>): void {
  const eye = manifest.analysis.features.eyes[0];
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
    iris: {
      method: "ellipse-cage-telea-v1",
      texture: { dataUrl: "data:image/png;base64,IRIS", width: 20, height: 20, coverage: 0.1, method: "source-rgba-ellipse-v1" },
      baseEye: { dataUrl: "data:image/png;base64,BASE", width: 20, height: 20, coverage: 1, method: "telea-inpaint-v1" },
      centre: { x: eye.pupil.x, y: eye.pupil.y },
      radiusX: 0.02,
      radiusY: 0.02,
      inpaintRadius: 3,
      segmentationConfidence: 0.9,
    },
  };
}

function addSemanticMesh(manifest: ReturnType<typeof fixtureManifest>): void {
  addIrisLayers(manifest);
  const deformation = manifest.analysis.features.eyes[0]?.rig.deformation;
  assert.ok(deformation);
  deformation.semanticMesh = {
    method: "semantic-weighted-triangle-mesh-v1",
    vertices: [
      { x: 0.25, y: 0.38 }, { x: 0.35, y: 0.38 }, { x: 0.45, y: 0.38 },
      { x: 0.25, y: 0.46 }, { x: 0.35, y: 0.46 }, { x: 0.45, y: 0.46 },
    ],
    triangles: [[0, 1, 4], [0, 4, 3], [1, 2, 5], [1, 5, 4]],
    fields: [{
      control: "blink",
      weights: [0, 1, 0, 0, 1, 0],
      maxDisplacements: [
        { x: 0, y: 0 }, { x: 0, y: 0.02 }, { x: 0, y: 0 },
        { x: 0, y: 0 }, { x: 0, y: -0.02 }, { x: 0, y: 0 },
      ],
    }],
    aperture: [0, 1, 2, 5, 4, 3],
    minimumAreaRatio: 0.5,
  };
}

function addClosedEyeCorrective(manifest: ReturnType<typeof fixtureManifest>): void {
  addSemanticMesh(manifest);
  const deformation = manifest.analysis.features.eyes[0]?.rig.deformation;
  assert.ok(deformation);
  deformation.closedEye = {
    dataUrl: CLOSED_PNG,
    width: 20,
    height: 20,
    coverage: 0.2,
    method: "telea-skin-fill-curve-v1",
    activationStart: 0.55,
    inpaintRadius: 3,
    lineThickness: 2,
  };
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

test("an undecodable iris texture rejects the new load transaction", async () => {
  const previousImage = globalThis.Image;
  const previousDocument = globalThis.document;
  Object.assign(globalThis, {
    Image: FakeImage,
    document: { createElement: () => new FakeCanvas() },
  });

  try {
    const player = new LivingImagePlayer(new FakeCanvas() as unknown as HTMLCanvasElement);
    const manifest = fixtureManifest();
    addIrisLayers(manifest);
    const iris = manifest.analysis.features.eyes[0]?.rig.deformation?.iris;
    assert.ok(iris);
    iris.texture.dataUrl = "data:image/png;base64,FAIL";
    await assert.rejects(player.load(manifest), /left iris texture could not be decoded/);
  } finally {
    Object.assign(globalThis, { Image: previousImage, document: previousDocument });
  }
});

test("an iris layer with mismatched intrinsic dimensions is rejected", async () => {
  const previousImage = globalThis.Image;
  const previousDocument = globalThis.document;
  Object.assign(globalThis, {
    Image: FakeImage,
    document: { createElement: () => new FakeCanvas() },
  });

  try {
    const player = new LivingImagePlayer(new FakeCanvas() as unknown as HTMLCanvasElement);
    const manifest = fixtureManifest();
    addIrisLayers(manifest);
    const iris = manifest.analysis.features.eyes[0]?.rig.deformation?.iris;
    assert.ok(iris);
    iris.baseEye.dataUrl = "data:image/png;base64,BASEWIDE";
    await assert.rejects(player.load(manifest), /left base eye dimensions do not match its manifest/);
  } finally {
    Object.assign(globalThis, { Image: previousImage, document: previousDocument });
  }
});

test("a rejected asset keeps every direct runtime control neutral", async () => {
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
    manifest.quality.status = "reject";
    await player.load(manifest);
    assert.deepEqual(player.getCapabilities(), {
      loaded: true,
      status: "reject",
      blink: false,
      gaze: false,
      mouth: false,
      breath: false,
    });
    assert.equal(player.triggerReaction("blink"), false);
    assert.equal(player.triggerReaction("talk"), false);
    assert.equal(player.triggerReaction("look-left"), false);
    player.setAutoIdle(false);
    player.setState({
      blinkLeft: 1,
      blinkRight: 1,
      gazeX: 1,
      gazeY: 1,
      mouthOpen: 1,
      breath: 1,
    });
    player.step(1 / 60);
    assert.deepEqual(player.getState(), {
      blinkLeft: 0,
      blinkRight: 0,
      gazeX: 0,
      gazeY: 0,
      mouthOpen: 0,
      breath: 0,
    });
  } finally {
    Object.assign(globalThis, { Image: previousImage, document: previousDocument });
  }
});

test("named reactions report capabilities and drive enabled controls", async () => {
  const previousImage = globalThis.Image;
  const previousDocument = globalThis.document;
  Object.assign(globalThis, {
    Image: FakeImage,
    document: { createElement: () => new FakeCanvas() },
  });

  try {
    const player = new LivingImagePlayer(new FakeCanvas() as unknown as HTMLCanvasElement);
    const manifest = fixtureManifest();
    manifest.quality.status = "limited";
    manifest.quality.disabledCapabilities = ["gaze"];
    await player.load(manifest);
    player.setAutoIdle(false);
    assert.deepEqual(player.getCapabilities(), {
      loaded: true,
      status: "limited",
      blink: true,
      gaze: false,
      mouth: true,
      breath: true,
    });
    assert.equal(player.triggerReaction("blink"), true);
    assert.equal(player.triggerReaction("talk"), true);
    assert.equal(player.triggerReaction("look-right"), false);
    player.step(0.1);
    assert.ok(player.getState().blinkLeft > 0);
    assert.ok(player.getState().mouthOpen > 0);
    assert.equal(player.getState().gazeX, 0);
    player.resetState();
    player.step(0.1);
    assert.equal(player.getState().blinkLeft, 0);
  } finally {
    Object.assign(globalThis, { Image: previousImage, document: previousDocument });
  }
});

test("semantic mesh mode renders blink from the compiler-authored topology", async () => {
  const previousImage = globalThis.Image;
  const previousDocument = globalThis.document;
  Object.assign(globalThis, {
    Image: FakeImage,
    document: { createElement: () => new FakeCanvas() },
  });

  try {
    const canvas = new FakeCanvas();
    const player = new LivingImagePlayer(canvas as unknown as HTMLCanvasElement, {
      eyeDeformation: "semantic-mesh-required",
    });
    const manifest = fixtureManifest();
    addSemanticMesh(manifest);
    manifest.quality.disabledCapabilities = ["gaze", "mouth"];
    await player.load(manifest);
    player.setAutoIdle(false);
    player.setState({ blinkLeft: 0.5 });
    player.step(1 / 60);
    assert.ok(canvas.context.drawnImages.length > 1);
  } finally {
    Object.assign(globalThis, { Image: previousImage, document: previousDocument });
  }
});

test("semantic mesh mode does not silently fall back when blink topology is absent", async () => {
  const previousImage = globalThis.Image;
  const previousDocument = globalThis.document;
  Object.assign(globalThis, {
    Image: FakeImage,
    document: { createElement: () => new FakeCanvas() },
  });

  try {
    const player = new LivingImagePlayer(new FakeCanvas() as unknown as HTMLCanvasElement, {
      eyeDeformation: "semantic-mesh-required",
    });
    const manifest = fixtureManifest();
    addIrisLayers(manifest);
    manifest.quality.disabledCapabilities = ["gaze", "mouth"];
    await player.load(manifest);
    player.setAutoIdle(false);
    player.setState({ blinkLeft: 0.5 });
    assert.throws(() => player.step(1 / 60), /missing its required semantic mesh/);
  } finally {
    Object.assign(globalThis, { Image: previousImage, document: previousDocument });
  }
});

test("corrective-required mode draws the closed-eye layer and fails closed when absent", async () => {
  const previousImage = globalThis.Image;
  const previousDocument = globalThis.document;
  Object.assign(globalThis, {
    Image: FakeImage,
    document: { createElement: () => new FakeCanvas() },
  });

  try {
    const canvas = new FakeCanvas();
    const player = new LivingImagePlayer(canvas as unknown as HTMLCanvasElement, {
      eyeDeformation: "semantic-mesh-corrective-required",
    });
    const manifest = fixtureManifest();
    addClosedEyeCorrective(manifest);
    manifest.quality.disabledCapabilities = ["gaze", "mouth"];
    await player.load(manifest);
    player.setAutoIdle(false);
    player.setState({ blinkLeft: 1 });
    player.step(1 / 60);
    assert.ok(canvas.context.drawnImages.some((image) => image instanceof FakeImage && image.src === CLOSED_PNG));

    const missing = fixtureManifest();
    addSemanticMesh(missing);
    missing.quality.disabledCapabilities = ["gaze", "mouth"];
    await player.load(missing);
    player.setAutoIdle(false);
    player.setState({ blinkLeft: 1 });
    assert.throws(() => player.step(1 / 60), /missing its required closed-eye corrective/);
  } finally {
    Object.assign(globalThis, { Image: previousImage, document: previousDocument });
  }
});
