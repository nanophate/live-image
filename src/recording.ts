const RECORDING_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

export interface CanvasRecording {
  blob: Blob;
  mimeType: string;
}

export function canvasRecordingSupported(canvas: HTMLCanvasElement): boolean {
  return typeof canvas.captureStream === "function" && typeof MediaRecorder !== "undefined";
}

export function preferredRecordingType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  if (typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** Capture one bounded action from an origin-clean Canvas without microphone access. */
export async function recordCanvasAction(
  canvas: HTMLCanvasElement,
  action: () => Promise<void>,
  frameRate = 30,
): Promise<CanvasRecording> {
  if (!canvasRecordingSupported(canvas)) throw new Error("Canvas recording is unavailable in this browser");
  const stream = canvas.captureStream(frameRate);
  const mimeType = preferredRecordingType();
  let recorder: MediaRecorder;
  try {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    throw error;
  }
  const chunks: Blob[] = [];
  const complete = new Promise<CanvasRecording>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => reject(new Error("The browser could not encode the showcase"));
    recorder.onstop = () => {
      const recordedType = recorder.mimeType || mimeType || "video/webm";
      const blob = new Blob(chunks, { type: recordedType });
      if (blob.size === 0) reject(new Error("The browser produced an empty recording"));
      else resolve({ blob, mimeType: recordedType });
    };
  });

  try {
    recorder.start(250);
    await action();
    recorder.stop();
    return await complete;
  } catch (error) {
    if (recorder.state !== "inactive") recorder.stop();
    await complete.catch(() => undefined);
    throw error;
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}
