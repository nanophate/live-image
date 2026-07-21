export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const ALLOWED_MEDIA_TYPES = new Set(["image/png", "image/jpeg"]);
const MAX_FILENAME_HEADER_LENGTH = 512;

export function json(status: number, body: Record<string, unknown>, requestId?: string): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  if (requestId) headers.set("X-Request-Id", requestId);
  return Response.json(body, { status, headers });
}

export function requireAccessAssertion(
  request: Request,
  required: boolean,
  requestId: string,
): Response | null {
  if (!required) return null;
  if (request.headers.get("Cf-Access-Jwt-Assertion")) return null;
  return json(401, { status: "error", message: "Cloudflare Access authentication is required" }, requestId);
}

export function validateCompileRequest(request: Request, requestId: string): Response | null {
  if (request.method !== "POST") {
    return json(405, { status: "error", message: "Method not allowed" }, requestId);
  }
  const mediaType = (request.headers.get("Content-Type") ?? "").split(";", 1)[0]?.trim().toLowerCase();
  if (!mediaType || !ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return json(415, { status: "error", message: "Choose a PNG or JPEG image" }, requestId);
  }
  const rawLength = request.headers.get("Content-Length");
  const length = rawLength === null ? Number.NaN : Number(rawLength);
  if (!Number.isSafeInteger(length) || length <= 0) {
    return json(411, { status: "error", message: "A valid upload length is required" }, requestId);
  }
  if (length > MAX_UPLOAD_BYTES) {
    return json(413, { status: "error", message: "The selected image exceeds 20 MiB" }, requestId);
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json(403, { status: "error", message: "Cross-origin compilation is disabled" }, requestId);
  }
  const filename = request.headers.get("X-Living-Image-Filename");
  if (
    filename !== null
    && (filename.length === 0 || filename.length > MAX_FILENAME_HEADER_LENGTH || /[\u0000-\u001f\u007f]/u.test(filename))
  ) {
    return json(400, { status: "error", message: "The upload filename is invalid" }, requestId);
  }
  return null;
}

export function uploadLength(request: Request): number {
  return Number(request.headers.get("Content-Length"));
}

export function forwardedHeaders(request: Request, requestId: string): Headers {
  const headers = new Headers({
    "Content-Type": request.headers.get("Content-Type") ?? "application/octet-stream",
    "X-Living-Image-Filename": request.headers.get("X-Living-Image-Filename") ?? "portrait.png",
    "X-Request-Id": requestId,
  });
  return headers;
}
