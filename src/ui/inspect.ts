import { fetchLivingImage, loadLivingImageFile, type LivingImageManifest, type Point, type Rect } from "../schema.js";
import { renderQuality, requireElement, SAMPLE_URLS } from "./shared.js";

const canvas = requireElement<HTMLCanvasElement>("inspection-canvas");
const drawingContext = canvas.getContext("2d");
if (!drawingContext) throw new Error("Canvas 2D is not available");
const context: CanvasRenderingContext2D = drawingContext;
const fileInput = requireElement<HTMLInputElement>("inspection-file");
const qualityCard = requireElement<HTMLElement>("inspection-quality");
const metricList = requireElement<HTMLElement>("metric-list");
const provenance = requireElement<HTMLElement>("provenance");
const name = requireElement<HTMLElement>("inspection-name");

const toPixel = (point: Point, width: number, height: number): [number, number] => [point.x * width, point.y * height];

function strokeRect(rect: Rect, width: number, height: number, colour: string, lineWidth: number): void {
  context.strokeStyle = colour;
  context.lineWidth = lineWidth;
  context.strokeRect(rect.x * width, rect.y * height, rect.width * width, rect.height * height);
}

async function draw(manifest: LivingImageManifest): Promise<void> {
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("embedded image could not be decoded"));
    image.src = manifest.image.dataUrl;
  });
  const { width, height } = manifest.image;
  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);
  context.lineJoin = "round";
  context.lineCap = "round";
  strokeRect(manifest.analysis.face.bbox, width, height, "#58ef9a", 2);

  context.font = `${Math.max(10, width / 72)}px ui-monospace, monospace`;
  for (const [index, landmark] of manifest.analysis.landmarks.entries()) {
    const [x, y] = toPixel(landmark, width, height);
    context.fillStyle = "#35d8ff";
    context.beginPath();
    context.arc(x, y, Math.max(2.5, width / 230), 0, Math.PI * 2);
    context.fill();
    context.fillText(String(index), x + 5, y - 5);
  }

  for (const eye of manifest.analysis.features.eyes) {
    strokeRect(eye.region, width, height, "rgba(58,175,255,.75)", 1.2);
    context.strokeStyle = "#ffe13f";
    context.lineWidth = 2.2;
    context.beginPath();
    for (const [index, point] of eye.landmarks.entries()) {
      const [x, y] = toPixel(point, width, height);
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.closePath();
    context.stroke();
    const [pupilX, pupilY] = toPixel(eye.pupil, width, height);
    context.strokeStyle = "#ff4f52";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(pupilX, pupilY, Math.max(5, eye.pupil.radius * Math.min(width, height)), 0, Math.PI * 2);
    context.stroke();
    const mesh = eye.rig.deformation?.semanticMesh;
    const blinkField = mesh?.fields[0];
    if (mesh && blinkField) {
      context.lineWidth = Math.max(0.65, width / 1400);
      context.strokeStyle = "rgba(255,167,64,.52)";
      for (const triangle of mesh.triangles) {
        const points = triangle.map((vertexIndex) => mesh.vertices[vertexIndex]);
        if (points.some((point) => !point)) continue;
        context.beginPath();
        points.forEach((point, index) => {
          const [meshX, meshY] = toPixel(point!, width, height);
          if (index === 0) context.moveTo(meshX, meshY); else context.lineTo(meshX, meshY);
        });
        context.closePath();
        context.stroke();
      }
      for (const [vertexIndex, vertex] of mesh.vertices.entries()) {
        const [meshX, meshY] = toPixel(vertex, width, height);
        const weight = blinkField.weights[vertexIndex] ?? 0;
        context.fillStyle = `rgba(255,${Math.round(88 + weight * 150)},64,${0.25 + weight * 0.75})`;
        context.beginPath();
        context.arc(meshX, meshY, Math.max(1.5, width / 360), 0, Math.PI * 2);
        context.fill();
      }
    }
  }
  strokeRect(manifest.analysis.features.mouth.region, width, height, "#ff55d7", 2.2);
}

async function useManifest(manifest: LivingImageManifest): Promise<void> {
  await draw(manifest);
  name.textContent = manifest.id.replaceAll("-", " ");
  renderQuality(qualityCard, manifest);
  metricList.innerHTML = Object.entries(manifest.quality.metrics)
    .map(([label, value]) => `<dt>${label}</dt><dd>${value.toFixed(3)}</dd>`)
    .join("");
  provenance.textContent = JSON.stringify({ compiler: manifest.compiler, provenance: manifest.provenance }, null, 2);
}

async function loadSample(url: string): Promise<void> {
  try { await useManifest(await fetchLivingImage(url)); }
  catch (error) {
    name.textContent = "Sample not compiled";
    metricList.textContent = `${(error as Error).message}. Run npm run compile:fixtures first.`;
  }
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try { await useManifest(await loadLivingImageFile(file)); }
  catch (error) { metricList.textContent = (error as Error).message; }
});
requireElement<HTMLButtonElement>("inspect-teal").addEventListener("click", () => void loadSample(SAMPLE_URLS.teal));
requireElement<HTMLButtonElement>("inspect-copper").addEventListener("click", () => void loadSample(SAMPLE_URLS.copper));

void loadSample(SAMPLE_URLS.teal);
