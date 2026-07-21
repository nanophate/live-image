import { json } from "./request-policy.js";
import {
  MAX_LOGIN_BODY_BYTES,
  cookieValue,
  createReviewSession,
  expiredSessionCookie,
  passwordMatches,
  safeReturnPath,
  sameOriginPost,
  sessionCookie,
  verifyReviewSession,
} from "./shared-password.js";

export const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export interface SharedPasswordEnvironment {
  REVIEW_AUTH_VERSION?: string;
  REVIEW_LOGIN_LIMITER: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  REVIEW_PASSWORD?: string;
  REVIEW_SESSION_SECRET?: string;
}

function htmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function loginPage(next: string, state: "ready" | "invalid" | "signed-out" = "ready", status = 200): Response {
  const notice = state === "invalid"
    ? '<div class="notice error" role="alert"><strong>Password not accepted</strong><br>Check the review password and try again.</div>'
    : state === "signed-out"
      ? '<div class="notice" role="status"><strong>You’ve signed out.</strong><br>Enter the review password to open the demo again.</div>'
      : "";
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Living Image · Private Review</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#0c101b;color:#f5f7ff}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at top,#243052,#0c101b 55%)}main{width:min(100%,430px);padding:34px;border:1px solid #3a4668;border-radius:22px;background:#151b2b;box-shadow:0 24px 70px #0008}.eyebrow{margin:0 0 10px;color:#a9b8ff;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px}h1{margin:0 0 12px;font-size:32px}p{color:#c9d0e3;line-height:1.55}label{display:block;margin:25px 0 8px;font-weight:700}input,button{width:100%;min-height:48px;border-radius:12px;font:inherit}input{border:1px solid #536087;background:#0c101b;color:#fff;padding:12px}input:focus{outline:3px solid #8da2ff;outline-offset:2px}button{margin-top:14px;border:0;background:#8da2ff;color:#101529;font-weight:800;cursor:pointer}.notice{margin:20px 0;padding:13px;border-radius:12px;background:#233152;color:#dce4ff}.notice.error{background:#49252c;color:#ffe0e4}.support{font-size:14px;margin-bottom:0}</style></head>
<body><main><p class="eyebrow">Private review</p><h1>Open Living Image</h1><p>Enter the review password provided with the Devpost submission.</p>${notice}
<form method="post" action="/auth/login"><input type="hidden" name="next" value="${htmlEscape(next)}"><label for="password">Review password</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus placeholder="Enter password"><button type="submit">Continue to demo</button></form>
<p class="support">This preview includes the hosted Compiler and Viewer.</p></main></body></html>`;
  return new Response(body, { status, headers: { ...securityHeaders, "Content-Type": "text/html; charset=utf-8" } });
}

export function unavailable(): Response {
  const body = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Review access unavailable</title><body><h1>Review access is unavailable</h1><p>This deployment is missing its review access configuration. Please contact the project owner.</p></body></html>";
  return new Response(body, { status: 503, headers: { ...securityHeaders, "Content-Type": "text/html; charset=utf-8" } });
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ ...securityHeaders, Location: location });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export function rateLimitKey(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

export async function sharedPasswordGate(
  request: Request,
  env: SharedPasswordEnvironment,
  url = new URL(request.url),
): Promise<Response | null> {
  const password = env.REVIEW_PASSWORD;
  const sessionSecret = env.REVIEW_SESSION_SECRET;
  if (!password || password.length < 12 || !sessionSecret || sessionSecret.length < 32) return unavailable();
  if (!env.REVIEW_AUTH_VERSION) return unavailable();
  const version = env.REVIEW_AUTH_VERSION;
  if (url.pathname === "/auth/login" && request.method === "GET") {
    return loginPage(safeReturnPath(url.searchParams.get("next")), url.searchParams.get("signed_out") === "1" ? "signed-out" : "ready");
  }
  if (url.pathname === "/auth/login" && request.method === "POST") {
    if (!sameOriginPost(request)) return json(403, { status: "error", message: "Cross-origin authentication is disabled" });
    const contentType = (request.headers.get("Content-Type") ?? "").split(";", 1)[0]?.trim().toLowerCase();
    const length = Number(request.headers.get("Content-Length"));
    if (contentType !== "application/x-www-form-urlencoded" || !Number.isSafeInteger(length) || length <= 0 || length > MAX_LOGIN_BODY_BYTES) {
      return json(400, { status: "error", message: "The login request is invalid" });
    }
    const limit = await env.REVIEW_LOGIN_LIMITER.limit({ key: rateLimitKey(request) });
    if (!limit.success) return new Response("Too many attempts", { status: 429, headers: { ...securityHeaders, "Retry-After": "60" } });
    const form = await request.formData();
    const next = safeReturnPath(form.get("next"));
    const provided = form.get("password");
    if (typeof provided !== "string" || !(await passwordMatches(provided, password))) {
      return loginPage(next, "invalid", 401);
    }
    const token = await createReviewSession(sessionSecret, url.hostname, version);
    return redirect(next, sessionCookie(token));
  }
  const token = cookieValue(request);
  const authenticated = token
    ? await verifyReviewSession(token, sessionSecret, url.hostname, version)
    : false;
  if (!authenticated) {
    return url.pathname.startsWith("/api/")
      ? json(401, { status: "error", message: "Review authentication is required" })
      : redirect(`/auth/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
  }
  if (url.pathname === "/auth/logout") {
    if (!sameOriginPost(request)) return json(403, { status: "error", message: "Cross-origin authentication is disabled" });
    return redirect("/auth/login?signed_out=1", expiredSessionCookie());
  }
  return null;
}
