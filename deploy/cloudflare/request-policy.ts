import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_PUBLIC_REVIEW_DURATION_MS = 24 * 60 * 60 * 1000;

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

interface AccessConfiguration {
  audience?: string;
  teamDomain?: string;
}

type JwksFactory = (url: URL) => JWTVerifyGetKey;

let cachedRemoteJwks: { issuer: string; keys: JWTVerifyGetKey } | undefined;

export function accessAuthenticationRequired(value: string | undefined): boolean {
  return value !== "false";
}

export function publicReviewWindowActive(
  notBefore: string | undefined,
  expiresAt: string | undefined,
  now = Date.now(),
): boolean {
  if (!notBefore || !expiresAt) return false;
  const start = Date.parse(notBefore);
  const end = Date.parse(expiresAt);
  return Number.isFinite(start)
    && Number.isFinite(end)
    && start <= now
    && now < end
    && end > start
    && end - start <= MAX_PUBLIC_REVIEW_DURATION_MS;
}

interface HostedCompilerConfiguration {
  accessAudience?: string;
  accessTeamDomain?: string;
  authenticationMode?: string;
  compilerEnabled?: string;
  publicReviewExpiresAt?: string;
  publicReviewNotBefore?: string;
  reviewPassword?: string;
  reviewSessionSecret?: string;
  requireAccessJwt?: string;
}

export type HostedAuthentication = "cloudflare-access" | "shared-password" | "none" | "invalid";

export interface HostedCompilerPolicy {
  authentication: HostedAuthentication;
  authenticationRequired: boolean;
  enabled: boolean;
  requireExactOrigin: boolean;
}

export function hostedAuthenticationMode(value: string | undefined): HostedAuthentication {
  if (value === "access") return "cloudflare-access";
  if (value === "shared-password") return "shared-password";
  if (value === "public-review") return "none";
  return "invalid";
}

export function hostedCompilerPolicy(
  configuration: HostedCompilerConfiguration,
  now = Date.now(),
): HostedCompilerPolicy {
  const authentication = hostedAuthenticationMode(configuration.authenticationMode);
  const authenticationRequired = authentication === "cloudflare-access" || authentication === "shared-password";
  const privateReady = Boolean(configuration.accessAudience) && Boolean(configuration.accessTeamDomain);
  const sharedPasswordReady = (configuration.reviewPassword?.length ?? 0) >= 12
    && (configuration.reviewSessionSecret?.length ?? 0) >= 32;
  const reviewReady = publicReviewWindowActive(
    configuration.publicReviewNotBefore,
    configuration.publicReviewExpiresAt,
    now,
  );
  return {
    authentication,
    authenticationRequired,
    enabled: configuration.compilerEnabled === "true"
      && (authentication === "cloudflare-access"
        ? privateReady
        : authentication === "shared-password"
          ? sharedPasswordReady
          : authentication === "none"
            ? reviewReady
            : false),
    requireExactOrigin: authentication !== "cloudflare-access",
  };
}

function accessIssuer(teamDomain: string | undefined): string | null {
  if (!teamDomain) return null;
  try {
    const url = new URL(teamDomain);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.port
      || url.pathname !== "/"
      || url.search
      || url.hash
      || !url.hostname.endsWith(".cloudflareaccess.com")
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function accessJwks(issuer: string, factory?: JwksFactory): JWTVerifyGetKey {
  const certs = new URL("/cdn-cgi/access/certs", issuer);
  if (factory) return factory(certs);
  if (!cachedRemoteJwks || cachedRemoteJwks.issuer !== issuer) {
    cachedRemoteJwks = { issuer, keys: createRemoteJWKSet(certs) };
  }
  return cachedRemoteJwks.keys;
}

export async function requireAccessAssertion(
  request: Request,
  configuration: AccessConfiguration,
  requestId: string,
  jwksFactory?: JwksFactory,
): Promise<Response | null> {
  const issuer = accessIssuer(configuration.teamDomain);
  const audience = configuration.audience?.trim();
  if (!issuer || !audience) {
    return json(503, { status: "error", message: "Cloudflare Access authentication is not configured" }, requestId);
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    return json(401, { status: "error", message: "Cloudflare Access authentication is required" }, requestId);
  }
  try {
    const jwks = accessJwks(issuer, jwksFactory);
    await jwtVerify(token, jwks, {
      algorithms: ["RS256"],
      audience,
      issuer,
    });
    return null;
  } catch {
    return json(403, { status: "error", message: "Cloudflare Access authentication is invalid" }, requestId);
  }
}

export function validateCompileRequest(
  request: Request,
  requestId: string,
  requireExactOrigin = false,
): Response | null {
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
  if ((requireExactOrigin && !origin) || (origin && origin !== new URL(request.url).origin)) {
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
