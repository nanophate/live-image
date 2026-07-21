const encoder = new TextEncoder();

export const REVIEW_COOKIE = "__Host-limg_review";
export const REVIEW_SESSION_SECONDS = 12 * 60 * 60;
export const MAX_LOGIN_BODY_BYTES = 4096;

interface SessionPayload {
  aud: string;
  exp: number;
  iat: number;
  nonce: string;
  version: string;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length > 2048) return null;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const decoded = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) decoded[index] = binary.charCodeAt(index);
    return decoded;
  } catch {
    return null;
  }
}

export async function passwordMatches(provided: string, expected: string): Promise<boolean> {
  const challenge = encoder.encode("living-image-review-password-v1");
  const [providedKey, expectedKey] = await Promise.all([hmacKey(provided), hmacKey(expected)]);
  const expectedSignature = await crypto.subtle.sign("HMAC", expectedKey, challenge);
  return crypto.subtle.verify("HMAC", providedKey, expectedSignature, challenge);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );
}

async function hmac(secret: string, payload: string): Promise<Uint8Array> {
  const key = await hmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

export async function createReviewSession(
  secret: string,
  audience: string,
  version: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const payload: SessionPayload = {
    aud: audience,
    exp: nowSeconds + REVIEW_SESSION_SECONDS,
    iat: nowSeconds,
    nonce: base64Url(nonce),
    version,
  };
  const encoded = base64Url(encoder.encode(JSON.stringify(payload)));
  return `${encoded}.${base64Url(await hmac(secret, encoded))}`;
}

function sessionPayload(value: Uint8Array): SessionPayload | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(value));
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.aud !== "string"
      || typeof candidate.exp !== "number"
      || !Number.isSafeInteger(candidate.exp)
      || typeof candidate.iat !== "number"
      || !Number.isSafeInteger(candidate.iat)
      || typeof candidate.nonce !== "string"
      || candidate.nonce.length < 16
      || typeof candidate.version !== "string"
    ) return null;
    return {
      aud: candidate.aud,
      exp: candidate.exp,
      iat: candidate.iat,
      nonce: candidate.nonce,
      version: candidate.version,
    };
  } catch {
    return null;
  }
}

export async function verifyReviewSession(
  token: string,
  secret: string,
  audience: string,
  version: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (token.length > 4096) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [encoded, signature] = parts;
  if (!encoded || !signature) return false;
  const [payloadBytes, signatureBytes] = [decodeBase64Url(encoded), decodeBase64Url(signature)];
  if (!payloadBytes || !signatureBytes) return false;
  const key = await hmacKey(secret);
  if (!(await crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(encoded)))) return false;
  const payload = sessionPayload(payloadBytes);
  return Boolean(
    payload
    && payload.aud === audience
    && payload.version === version
    && payload.iat <= nowSeconds + 60
    && payload.exp > nowSeconds
    && payload.exp <= payload.iat + REVIEW_SESSION_SECONDS,
  );
}

export function cookieValue(request: Request): string | null {
  const header = request.headers.get("Cookie");
  if (!header || header.length > 8192) return null;
  const matches = header.split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${REVIEW_COOKIE}=`));
  if (matches.length !== 1) return null;
  return matches[0]!.slice(REVIEW_COOKIE.length + 1) || null;
}

export function sessionCookie(token: string): string {
  return `${REVIEW_COOKIE}=${token}; Path=/; Max-Age=${REVIEW_SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function expiredSessionCookie(): string {
  return `${REVIEW_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function safeReturnPath(value: FormDataEntryValue | string | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/compiler.html";
  try {
    const parsed = new URL(value, "https://living-image.invalid");
    if (parsed.origin !== "https://living-image.invalid") return "/compiler.html";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/compiler.html";
  }
}

export function sameOriginPost(request: Request): boolean {
  if (request.method !== "POST") return false;
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) return false;
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return !fetchSite || fetchSite === "same-origin";
}
