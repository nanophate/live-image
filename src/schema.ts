export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

export interface ProtectedLineArtMask {
  dataUrl: string;
  width: number;
  height: number;
  coverage: number;
  method: string;
  cannyLow: number;
  cannyHigh: number;
}

export interface EyeDeformationRig {
  method: string;
  sourceRows: number[];
  closedRows: number[];
  gazeRowWeights: number[];
  protectedLineArtMask: ProtectedLineArtMask;
  region: Rect;
}

export interface MouthDeformationRig {
  method: string;
  upperBand: Rect;
  lowerBand: Rect;
  cavity: { centreX: number; centreY: number; radiusX: number; maxRadiusY: number };
  upperTravel: number;
  lowerTravel: number;
  lineContrast: number;
}

export interface EyeFeature {
  side: "left" | "right";
  landmarkIndices: number[];
  landmarks: Point[];
  region: Rect;
  anchors: { left: number; right: number; top: number; bottom: number; centreY: number };
  pupil: Point & { radius: number; confidence: number; contrast: number; method: string };
  rig: { maxGazeX: number; maxGazeY: number; blinkFloor: number; deformation?: EyeDeformationRig };
  confidence: number;
  landmarkConfidence: number;
  geometryConfidence: number;
}

export interface MouthFeature {
  landmarkIndices: number[];
  landmarks: Point[];
  region: Rect;
  anchors: { left: number; right: number; centreX: number; centreY: number };
  rig: { maxOpen: number; interiorColour: string; deformation?: MouthDeformationRig };
  confidence: number;
  landmarkConfidence: number;
  lineConfidence?: number;
}

export interface QualityReport {
  status: "full" | "limited" | "reject";
  score: number;
  disabledCapabilities: string[];
  warnings: string[];
  rejectionReasons: string[];
  metrics: Record<string, number>;
}

export interface LivingImageManifest {
  format: "living-image";
  version: 1;
  id: string;
  compiler: {
    name: string;
    version: string;
    detector: string;
    detectorVersion: string;
    faceModel: string;
    landmarkModel: string;
    modelSha256: Record<string, string>;
  };
  image: { mimeType: string; width: number; height: number; sha256: string; dataUrl: string };
  analysis: {
    face: { bbox: Rect; score: number };
    landmarks: Array<Point & { score: number }>;
    features: { eyes: EyeFeature[]; mouth: MouthFeature };
  };
  rig: {
    controls: Record<string, { min: number; max: number }>;
    breath: { pivotY: number; maxScaleY: number; maxLift: number };
  };
  behavior: {
    seed: number;
    blink: { interval: number; jitter: number; duration: number };
    breath: { period: number };
    smoothing: { gaze: number; mouth: number };
  };
  quality: QualityReport;
  provenance: Record<string, unknown>;
}

export const MAX_IMAGE_DIMENSION = 8192;
export const MAX_IMAGE_PIXELS = 33_554_432;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function assertPoint(value: unknown, label: string): asserts value is Point {
  if (!value || typeof value !== "object") throw new Error(`${label} must be an object`);
  const point = value as Record<string, unknown>;
  if (!finite(point.x) || !finite(point.y)) throw new Error(`${label} must contain finite x/y`);
}

function assertRect(value: unknown, label: string): asserts value is Rect {
  assertPoint(value, label);
  const rect = value as unknown as Record<string, unknown>;
  if (!finite(rect.width) || !finite(rect.height) || rect.width <= 0 || rect.height <= 0) {
    throw new Error(`${label} must contain a positive width/height`);
  }
}

function assertFiniteArray(value: unknown, label: string): asserts value is number[] {
  if (!Array.isArray(value) || !value.every(finite)) throw new Error(`${label} must contain finite numbers`);
}

function assertInsideRect(inner: Rect, outer: Rect, label: string): void {
  const epsilon = 1e-7;
  if (
    inner.x < outer.x - epsilon
    || inner.y < outer.y - epsilon
    || inner.x + inner.width > outer.x + outer.width + epsilon
    || inner.y + inner.height > outer.y + outer.height + epsilon
  ) throw new Error(`${label} must stay inside its feature region`);
}

function assertPointInsideRect(point: Point, outer: Rect, label: string): void {
  const epsilon = 1e-7;
  if (
    point.x < outer.x - epsilon
    || point.y < outer.y - epsilon
    || point.x > outer.x + outer.width + epsilon
    || point.y > outer.y + outer.height + epsilon
  ) throw new Error(`${label} must stay inside its feature region`);
}

function assertEyeGeometry(eye: EyeFeature, label: string): void {
  const anchors = eye.anchors;
  if (
    !anchors
    || !finite(anchors.left)
    || !finite(anchors.right)
    || !finite(anchors.top)
    || !finite(anchors.bottom)
    || !finite(anchors.centreY)
    || anchors.left >= anchors.right
    || anchors.top >= anchors.bottom
    || anchors.centreY < anchors.top
    || anchors.centreY > anchors.bottom
  ) throw new Error(`${label} anchors are invalid`);
  assertPointInsideRect({ x: anchors.left, y: anchors.top }, eye.region, `${label} anchors`);
  assertPointInsideRect({ x: anchors.right, y: anchors.bottom }, eye.region, `${label} anchors`);

  const rig = eye.rig;
  if (
    !rig
    || !finite(rig.maxGazeX)
    || !finite(rig.maxGazeY)
    || !finite(rig.blinkFloor)
    || rig.maxGazeX < 0
    || rig.maxGazeX > eye.region.width
    || rig.maxGazeY < 0
    || rig.maxGazeY > eye.region.height
    || rig.blinkFloor < 0
    || rig.blinkFloor > eye.region.height
  ) throw new Error(`${label} rig ranges are invalid`);

  if (
    !finite(eye.pupil.radius)
    || eye.pupil.radius <= 0
    || !finite(eye.pupil.confidence)
    || eye.pupil.confidence < 0
    || eye.pupil.confidence > 1
    || !finite(eye.pupil.contrast)
    || eye.pupil.contrast < 0
    || typeof eye.pupil.method !== "string"
    || eye.pupil.method.length === 0
  ) throw new Error(`${label} pupil metadata is invalid`);
}

function assertMouthGeometry(mouth: MouthFeature, label: string): void {
  const anchors = mouth.anchors;
  if (
    !anchors
    || !finite(anchors.left)
    || !finite(anchors.right)
    || !finite(anchors.centreX)
    || !finite(anchors.centreY)
    || anchors.left >= anchors.right
    || anchors.centreX < anchors.left
    || anchors.centreX > anchors.right
  ) throw new Error(`${label} anchors are invalid`);
  assertPointInsideRect({ x: anchors.left, y: anchors.centreY }, mouth.region, `${label} anchors`);
  assertPointInsideRect({ x: anchors.right, y: anchors.centreY }, mouth.region, `${label} anchors`);
  if (
    !mouth.rig
    || !finite(mouth.rig.maxOpen)
    || mouth.rig.maxOpen < 0
    || mouth.rig.maxOpen > mouth.region.height
    || typeof mouth.rig.interiorColour !== "string"
    || !/^#[0-9a-f]{6}$/i.test(mouth.rig.interiorColour)
  ) throw new Error(`${label} rig ranges are invalid`);
}

function assertEyeDeformation(
  value: unknown,
  featureRegion: Rect,
  imageWidth: number,
  imageHeight: number,
  label: string,
): void {
  if (!value || typeof value !== "object") throw new Error(`${label} must be an object`);
  const deformation = value as Partial<EyeDeformationRig>;
  if (deformation.method !== "fixed-boundary-piecewise-affine-v1") {
    throw new Error(`${label}.method is unsupported`);
  }
  assertFiniteArray(deformation.sourceRows, `${label}.sourceRows`);
  assertFiniteArray(deformation.closedRows, `${label}.closedRows`);
  assertFiniteArray(deformation.gazeRowWeights, `${label}.gazeRowWeights`);
  if (
    deformation.sourceRows.length !== 6
    || deformation.closedRows.length !== deformation.sourceRows.length
    || deformation.gazeRowWeights.length !== deformation.sourceRows.length
  ) throw new Error(`${label} row arrays must have the supported length of six`);
  for (const rows of [deformation.sourceRows, deformation.closedRows]) {
    if (!rows.every((row, index) => index === 0 || row > (rows[index - 1] ?? row))) {
      throw new Error(`${label} rows must be strictly increasing`);
    }
    if (!rows.every((row) => row >= featureRegion.y - 1e-7 && row <= featureRegion.y + featureRegion.height + 1e-7)) {
      throw new Error(`${label} rows must stay inside the eye region`);
    }
  }
  if (!deformation.gazeRowWeights.every((weight) => weight >= 0 && weight <= 1)) {
    throw new Error(`${label}.gazeRowWeights must stay in [0,1]`);
  }
  assertRect(deformation.region, `${label}.region`);
  assertInsideRect(deformation.region, featureRegion, `${label}.region`);
  const mask = deformation.protectedLineArtMask;
  if (!mask || typeof mask !== "object" || !mask.dataUrl?.startsWith("data:image/png;base64,")) {
    throw new Error(`${label}.protectedLineArtMask must contain an embedded PNG`);
  }
  if (mask.method !== "canny-active-aperture-v1") {
    throw new Error(`${label}.protectedLineArtMask method is unsupported`);
  }
  if (!Number.isInteger(mask.width) || mask.width <= 0 || !Number.isInteger(mask.height) || mask.height <= 0) {
    throw new Error(`${label}.protectedLineArtMask dimensions must be positive integers`);
  }
  const expectedWidth = Math.max(1, Math.round(deformation.region.width * imageWidth));
  const expectedHeight = Math.max(1, Math.round(deformation.region.height * imageHeight));
  if (mask.width !== expectedWidth || mask.height !== expectedHeight) {
    throw new Error(`${label}.protectedLineArtMask dimensions must match its feature region`);
  }
  if (!finite(mask.coverage) || mask.coverage < 0 || mask.coverage > 1) {
    throw new Error(`${label}.protectedLineArtMask coverage must stay in [0,1]`);
  }
  if (!finite(mask.cannyLow) || !finite(mask.cannyHigh) || mask.cannyLow < 0 || mask.cannyHigh < mask.cannyLow) {
    throw new Error(`${label}.protectedLineArtMask Canny thresholds are invalid`);
  }
}

function assertMouthDeformation(value: unknown, featureRegion: Rect, label: string): void {
  if (!value || typeof value !== "object") throw new Error(`${label} must be an object`);
  const deformation = value as Partial<MouthDeformationRig>;
  if (deformation.method !== "bounded-lip-bands-v1") throw new Error(`${label}.method is unsupported`);
  assertRect(deformation.upperBand, `${label}.upperBand`);
  assertRect(deformation.lowerBand, `${label}.lowerBand`);
  assertInsideRect(deformation.upperBand, featureRegion, `${label}.upperBand`);
  assertInsideRect(deformation.lowerBand, featureRegion, `${label}.lowerBand`);
  const cavity = deformation.cavity;
  if (
    !cavity
    || !finite(cavity.centreX)
    || !finite(cavity.centreY)
    || !finite(cavity.radiusX)
    || !finite(cavity.maxRadiusY)
    || cavity.radiusX <= 0
    || cavity.maxRadiusY <= 0
  ) throw new Error(`${label}.cavity must contain finite positive geometry`);
  if (!finite(deformation.upperTravel) || deformation.upperTravel < 0 || !finite(deformation.lowerTravel) || deformation.lowerTravel < 0) {
    throw new Error(`${label} travel must be finite and non-negative`);
  }
  if (!finite(deformation.lineContrast) || deformation.lineContrast < 0) {
    throw new Error(`${label}.lineContrast must be finite and non-negative`);
  }
}

export function validateManifest(value: unknown): LivingImageManifest {
  if (!value || typeof value !== "object") throw new Error(".limg root must be an object");
  const manifest = value as Partial<LivingImageManifest>;
  if (manifest.format !== "living-image" || manifest.version !== 1) throw new Error("unsupported .limg format/version");
  if (
    !manifest.image
    || !Number.isInteger(manifest.image.width)
    || manifest.image.width <= 0
    || manifest.image.width > MAX_IMAGE_DIMENSION
    || !Number.isInteger(manifest.image.height)
    || manifest.image.height <= 0
    || manifest.image.height > MAX_IMAGE_DIMENSION
    || manifest.image.width * manifest.image.height > MAX_IMAGE_PIXELS
  ) throw new Error("invalid image dimensions");
  if (!manifest.image.dataUrl?.startsWith("data:image/")) throw new Error("version 1 requires an embedded image data URL");
  if (!manifest.analysis?.features?.eyes || manifest.analysis.features.eyes.length !== 2) throw new Error("version 1 requires two eye features");
  if (!manifest.analysis.features.mouth || !manifest.quality || !manifest.rig || !manifest.behavior) throw new Error("incomplete .limg manifest");
  assertRect(manifest.analysis.face.bbox, "face bbox");
  const eyeSides = manifest.analysis.features.eyes.map((eye) => eye.side).sort();
  if (eyeSides[0] !== "left" || eyeSides[1] !== "right") {
    throw new Error("version 1 requires one left eye and one right eye");
  }
  for (const [index, eye] of manifest.analysis.features.eyes.entries()) {
    assertRect(eye.region, `eye ${index} region`);
    assertPoint(eye.pupil, `eye ${index} pupil`);
    assertEyeGeometry(eye, `eye ${index}`);
    if (eye.rig?.deformation) {
      assertEyeDeformation(
        eye.rig.deformation,
        eye.region,
        manifest.image.width,
        manifest.image.height,
        `eye ${index} deformation`,
      );
    }
  }
  assertRect(manifest.analysis.features.mouth.region, "mouth region");
  assertMouthGeometry(manifest.analysis.features.mouth, "mouth");
  const mouthLineConfidence = manifest.analysis.features.mouth.lineConfidence;
  if (mouthLineConfidence !== undefined && (!finite(mouthLineConfidence) || mouthLineConfidence < 0 || mouthLineConfidence > 1)) {
    throw new Error("mouth lineConfidence must stay in [0,1]");
  }
  if (manifest.analysis.features.mouth.rig?.deformation) {
    assertMouthDeformation(
      manifest.analysis.features.mouth.rig.deformation,
      manifest.analysis.features.mouth.region,
      "mouth deformation",
    );
  }
  return manifest as LivingImageManifest;
}

export function parseLivingImage(text: string): LivingImageManifest {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (error) { throw new Error(`invalid .limg JSON: ${(error as Error).message}`); }
  return validateManifest(parsed);
}

export async function loadLivingImageFile(file: File): Promise<LivingImageManifest> {
  return parseLivingImage(await file.text());
}

export async function fetchLivingImage(url: string): Promise<LivingImageManifest> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not fetch ${url} (${response.status})`);
  return parseLivingImage(await response.text());
}
