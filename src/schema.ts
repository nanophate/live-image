export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

export interface EyeFeature {
  side: "left" | "right";
  landmarkIndices: number[];
  landmarks: Point[];
  region: Rect;
  anchors: { left: number; right: number; top: number; bottom: number; centreY: number };
  pupil: Point & { radius: number; confidence: number; contrast: number; method: string };
  rig: { maxGazeX: number; maxGazeY: number; blinkFloor: number };
  confidence: number;
  landmarkConfidence: number;
  geometryConfidence: number;
}

export interface MouthFeature {
  landmarkIndices: number[];
  landmarks: Point[];
  region: Rect;
  anchors: { left: number; right: number; centreX: number; centreY: number };
  rig: { maxOpen: number; interiorColour: string };
  confidence: number;
  landmarkConfidence: number;
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

export function validateManifest(value: unknown): LivingImageManifest {
  if (!value || typeof value !== "object") throw new Error(".limg root must be an object");
  const manifest = value as Partial<LivingImageManifest>;
  if (manifest.format !== "living-image" || manifest.version !== 1) throw new Error("unsupported .limg format/version");
  if (!manifest.image || !Number.isInteger(manifest.image.width) || !Number.isInteger(manifest.image.height)) throw new Error("invalid image dimensions");
  if (!manifest.image.dataUrl?.startsWith("data:image/")) throw new Error("version 1 requires an embedded image data URL");
  if (!manifest.analysis?.features?.eyes || manifest.analysis.features.eyes.length !== 2) throw new Error("version 1 requires two eye features");
  if (!manifest.analysis.features.mouth || !manifest.quality || !manifest.rig || !manifest.behavior) throw new Error("incomplete .limg manifest");
  assertRect(manifest.analysis.face.bbox, "face bbox");
  for (const [index, eye] of manifest.analysis.features.eyes.entries()) {
    assertRect(eye.region, `eye ${index} region`);
    assertPoint(eye.pupil, `eye ${index} pupil`);
  }
  assertRect(manifest.analysis.features.mouth.region, "mouth region");
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

