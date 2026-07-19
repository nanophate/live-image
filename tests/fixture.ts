import type { LivingImageManifest } from "../src/schema.js";

export function fixtureManifest(): LivingImageManifest {
  const eye = (side: "left" | "right", offset: number) => ({
    side,
    landmarkIndices: [11, 12, 13, 16, 15, 14],
    landmarks: [{ x: offset, y: 0.4 }],
    region: { x: offset - 0.1, y: 0.3, width: 0.2, height: 0.2 },
    anchors: { left: offset - 0.06, right: offset + 0.06, top: 0.38, bottom: 0.46, centreY: 0.42 },
    pupil: { x: offset, y: 0.42, radius: 0.02, confidence: 0.8, contrast: 90, method: "test" },
    rig: { maxGazeX: 0.01, maxGazeY: 0.005, blinkFloor: 0.002 },
    confidence: 0.9,
    landmarkConfidence: 0.9,
    geometryConfidence: 0.9,
  });
  return {
    format: "living-image", version: 1, id: "fixture",
    compiler: { name: "test", version: "1", detector: "test", detectorVersion: "1", faceModel: "face", landmarkModel: "landmark", modelSha256: {} },
    image: { mimeType: "image/png", width: 100, height: 100, sha256: "x", dataUrl: "data:image/png;base64,AA==" },
    analysis: {
      face: { bbox: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 }, score: 1 }, landmarks: [],
      features: {
        eyes: [eye("left", 0.35), eye("right", 0.65)],
        mouth: {
          landmarkIndices: [24, 25, 26, 27], landmarks: [], region: { x: 0.4, y: 0.6, width: 0.2, height: 0.1 },
          anchors: { left: 0.43, right: 0.57, centreX: 0.5, centreY: 0.65 },
          rig: { maxOpen: 0.02, interiorColour: "#221118" }, confidence: 0.9, landmarkConfidence: 0.9,
        },
      },
    },
    rig: { controls: {}, breath: { pivotY: 0.7, maxScaleY: 0.01, maxLift: 0.002 } },
    behavior: { seed: 42, blink: { interval: 3, jitter: 1, duration: 0.16 }, breath: { period: 4 }, smoothing: { gaze: 12, mouth: 18 } },
    quality: { status: "full", score: 0.9, disabledCapabilities: [], warnings: [], rejectionReasons: [], metrics: {} }, provenance: {},
  };
}

