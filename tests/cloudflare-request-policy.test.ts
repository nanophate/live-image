import assert from "node:assert/strict";
import test from "node:test";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from "jose";

import {
  MAX_UPLOAD_BYTES,
  MAX_PUBLIC_REVIEW_DURATION_MS,
  accessAuthenticationRequired,
  forwardedHeaders,
  hostedAuthenticationMode,
  hostedCompilerPolicy,
  publicReviewWindowActive,
  requireAccessAssertion,
  uploadLength,
  validateCompileRequest,
} from "../deploy/cloudflare/request-policy.js";
import {
  REVIEW_COOKIE,
  cookieValue,
  createReviewSession,
  expiredSessionCookie,
  passwordMatches,
  safeReturnPath,
  sameOriginLoginPost,
  sameOriginPost,
  sessionCookie,
  verifyReviewSession,
} from "../deploy/cloudflare/shared-password.js";
import { sharedPasswordGate, type SharedPasswordEnvironment } from "../deploy/cloudflare/review-auth.js";

const requestId = "test-request";

function uploadRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://living-image.example/api/compile", {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      "Content-Length": "24",
      Origin: "https://living-image.example",
      ...headers,
    },
    body: new Uint8Array(24),
  });
}

test("Cloudflare request policy accepts a bounded same-origin image upload", () => {
  assert.equal(validateCompileRequest(uploadRequest(), requestId), null);
});

test("Access bypass and public review windows fail closed", () => {
  assert.equal(accessAuthenticationRequired("false"), false);
  for (const value of ["true", "False", "review", undefined]) {
    assert.equal(accessAuthenticationRequired(value), true);
  }

  const now = Date.parse("2026-07-21T14:00:00.000Z");
  assert.equal(
    publicReviewWindowActive("2026-07-21T13:59:00.000Z", "2026-07-21T16:00:00.000Z", now),
    true,
  );
  assert.equal(publicReviewWindowActive(undefined, "2026-07-21T16:00:00.000Z", now), false);
  assert.equal(publicReviewWindowActive("invalid", "2026-07-21T16:00:00.000Z", now), false);
  assert.equal(
    publicReviewWindowActive("2026-07-21T13:00:00.000Z", "2026-07-21T14:00:00.000Z", now),
    false,
  );
  assert.equal(
    publicReviewWindowActive(
      "2026-07-21T14:00:00.000Z",
      new Date(now + MAX_PUBLIC_REVIEW_DURATION_MS + 1).toISOString(),
      now,
    ),
    false,
  );
});

test("hosted Compiler policy binds deployment vars to auth and origin enforcement", () => {
  const now = Date.parse("2026-07-21T14:00:00.000Z");
  const privateBase = {
    authenticationMode: "access",
    compilerEnabled: "true",
    requireAccessJwt: "true",
  };
  assert.deepEqual(hostedCompilerPolicy(privateBase, now), {
    authentication: "cloudflare-access",
    authenticationRequired: true,
    enabled: false,
    requireExactOrigin: false,
  });
  assert.equal(hostedCompilerPolicy({
    ...privateBase,
    accessAudience: "audience",
    accessTeamDomain: "https://living-image.cloudflareaccess.com",
  }, now).enabled, true);
  assert.equal(hostedCompilerPolicy({
    ...privateBase,
    compilerEnabled: "false",
    accessAudience: "audience",
    accessTeamDomain: "https://living-image.cloudflareaccess.com",
  }, now).enabled, false);
  assert.deepEqual(hostedCompilerPolicy({
    authenticationMode: "public-review",
    compilerEnabled: "true",
    requireAccessJwt: "false",
    publicReviewNotBefore: "2026-07-21T13:59:00.000Z",
    publicReviewExpiresAt: "2026-07-21T16:00:00.000Z",
  }, now), {
    authentication: "none",
    authenticationRequired: false,
    enabled: true,
    requireExactOrigin: true,
  });
  for (const publicReviewExpiresAt of ["", "invalid", "2026-07-21T14:00:00.000Z"]) {
    assert.equal(hostedCompilerPolicy({
      authenticationMode: "public-review",
      compilerEnabled: "true",
      requireAccessJwt: "false",
      publicReviewNotBefore: "2026-07-21T13:59:00.000Z",
      publicReviewExpiresAt,
    }, now).enabled, false);
  }
  assert.equal(hostedCompilerPolicy({
    authenticationMode: "access",
    compilerEnabled: "true",
    requireAccessJwt: "False",
  }, now).authenticationRequired, true);
  assert.equal(hostedAuthenticationMode("access"), "cloudflare-access");
  assert.equal(hostedAuthenticationMode("shared-password"), "shared-password");
  assert.equal(hostedAuthenticationMode("public-review"), "none");
  assert.equal(hostedAuthenticationMode("typo"), "invalid");
  assert.equal(hostedAuthenticationMode(undefined), "invalid");
  assert.equal(hostedAuthenticationMode(""), "invalid");
  assert.deepEqual(hostedCompilerPolicy({
    authenticationMode: "shared-password",
    compilerEnabled: "true",
    reviewPassword: "review-password-long",
    reviewSessionSecret: "session-secret-that-is-at-least-32-bytes",
  }, now), {
    authentication: "shared-password",
    authenticationRequired: true,
    enabled: true,
    requireExactOrigin: true,
  });
  assert.equal(hostedCompilerPolicy({
    authenticationMode: "shared-password",
    compilerEnabled: "true",
    reviewPassword: "review-password-long",
  }, now).enabled, false);
});

test("shared review password and signed sessions fail closed", async () => {
  assert.equal(await passwordMatches("correct horse", "correct horse"), true);
  assert.equal(await passwordMatches("wrong", "correct horse"), false);
  const secret = "a sufficiently independent session secret";
  const token = await createReviewSession(secret, "living-image.example", "1", 1_000);
  assert.equal(await verifyReviewSession(token, secret, "living-image.example", "1", 1_001), true);
  assert.equal(await verifyReviewSession(token, "wrong secret", "living-image.example", "1", 1_001), false);
  assert.equal(await verifyReviewSession(token, secret, "wrong.example", "1", 1_001), false);
  assert.equal(await verifyReviewSession(token, secret, "living-image.example", "2", 1_001), false);
  assert.equal(await verifyReviewSession(token, secret, "living-image.example", "1", 50_000), false);
  const [payload, signature] = token.split(".");
  assert.equal(await verifyReviewSession(`${payload}x.${signature}`, secret, "living-image.example", "1", 1_001), false);
  assert.equal(await verifyReviewSession("invalid", secret, "living-image.example", "1", 1_001), false);
  const request = new Request("https://living-image.example/compiler.html", {
    headers: { Cookie: `other=x; ${REVIEW_COOKIE}=${token}` },
  });
  assert.equal(cookieValue(request), token);
  assert.equal(cookieValue(new Request(request.url, { headers: { Cookie: `${REVIEW_COOKIE}=${token}; ${REVIEW_COOKIE}=duplicate` } })), null);
  assert.match(sessionCookie(token), /HttpOnly; Secure; SameSite=Strict/u);
  assert.match(expiredSessionCookie(), /Max-Age=0/u);
});

test("shared review login accepts only same-origin posts and safe return paths", () => {
  const sameOrigin = new Request("https://living-image.example/auth/login", {
    method: "POST",
    headers: { Origin: "https://living-image.example", "Sec-Fetch-Site": "same-origin" },
  });
  assert.equal(sameOriginPost(sameOrigin), true);
  assert.equal(sameOriginPost(new Request(sameOrigin.url, {
    method: "POST",
    headers: { Origin: "https://living-image.example", "Sec-Fetch-Site": "same-site" },
  })), true);
  assert.equal(sameOriginPost(new Request(sameOrigin.url, {
    method: "POST",
    headers: { "Sec-Fetch-Site": "same-origin" },
  })), true);
  assert.equal(sameOriginLoginPost(new Request(sameOrigin.url, {
    method: "POST",
    headers: { Origin: "null", "Sec-Fetch-Site": "same-origin" },
  })), true);
  assert.equal(sameOriginLoginPost(new Request(sameOrigin.url, {
    method: "POST",
    headers: { Origin: "null", "Sec-Fetch-Site": "cross-site" },
  })), false);
  assert.equal(sameOriginLoginPost(new Request(sameOrigin.url, {
    method: "POST",
    headers: { Origin: "null" },
  })), false);
  assert.equal(sameOriginPost(new Request(sameOrigin.url, {
    method: "POST",
    headers: { Origin: "null", "Sec-Fetch-Site": "same-origin" },
  })), false);
  assert.equal(sameOriginPost(new Request(sameOrigin.url, { method: "POST" })), false);
  assert.equal(sameOriginPost(new Request(sameOrigin.url, {
    method: "POST",
    headers: { "Sec-Fetch-Site": "cross-site" },
  })), false);
  assert.equal(sameOriginPost(new Request(sameOrigin.url, { method: "POST", headers: { Origin: "https://attacker.example" } })), false);
  assert.equal(sameOriginPost(new Request(sameOrigin.url, {
    method: "POST",
    headers: { Origin: "https://attacker.example", "Sec-Fetch-Site": "same-origin" },
  })), false);
  assert.equal(safeReturnPath("/viewer.html?character=one"), "/viewer.html?character=one");
  assert.equal(safeReturnPath("//attacker.example"), "/compiler.html");
  assert.equal(safeReturnPath("https://attacker.example"), "/compiler.html");
});

test("shared review gate protects pages and APIs through login and logout", async () => {
  const allow = { limit: async () => ({ success: true }) };
  const env: SharedPasswordEnvironment = {
    REVIEW_AUTH_VERSION: "1",
    REVIEW_LOGIN_LIMITER: allow,
    REVIEW_PASSWORD: "review-password-long",
    REVIEW_SESSION_SECRET: "session-secret-that-is-at-least-32-bytes",
  };
  const page = await sharedPasswordGate(new Request("https://living-image.example/compiler.html"), env);
  assert.equal(page?.status, 303);
  assert.equal(page?.headers.get("Location"), "/auth/login?next=%2Fcompiler.html");
  const api = await sharedPasswordGate(new Request("https://living-image.example/api/config"), env);
  assert.equal(api?.status, 401);
  assert.equal((await api?.json() as { message?: string }).message, "Review authentication is required");

  const loginPage = await sharedPasswordGate(new Request("https://living-image.example/auth/login?next=%2Fviewer.html"), env);
  assert.equal(loginPage?.status, 200);
  assert.match(await loginPage!.text(), /Living Image · Private Review/u);

  const login = async (password: string, limiter = allow) => {
    const body = new URLSearchParams({ next: "/viewer.html", password }).toString();
    return sharedPasswordGate(new Request("https://living-image.example/auth/login", {
      method: "POST",
      headers: {
        "Content-Length": String(new TextEncoder().encode(body).byteLength),
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://living-image.example",
        "Sec-Fetch-Site": "same-origin",
      },
      body,
    }), { ...env, REVIEW_LOGIN_LIMITER: limiter });
  };
  assert.equal((await login("wrong-password"))?.status, 401);
  assert.equal((await login("review-password-long", { limit: async () => ({ success: false }) }))?.status, 429);
  const accepted = await login("review-password-long");
  assert.equal(accepted?.status, 303);
  assert.equal(accepted?.headers.get("Location"), "/viewer.html");
  const setCookie = accepted?.headers.get("Set-Cookie") ?? "";
  const session = setCookie.split(";", 1)[0] ?? "";
  assert.ok(session.startsWith(`${REVIEW_COOKIE}=`));

  const accessBody = new URLSearchParams({ next: "/compiler.html", password: "review-password-long" }).toString();
  const accessRouted = await sharedPasswordGate(new Request("https://living-image.example/auth/login", {
    method: "POST",
    headers: {
      "Content-Length": String(new TextEncoder().encode(accessBody).byteLength),
      "Content-Type": "application/x-www-form-urlencoded",
      "Sec-Fetch-Site": "same-origin",
    },
    body: accessBody,
  }), env);
  assert.equal(accessRouted?.status, 303);
  assert.equal(accessRouted?.headers.get("Location"), "/compiler.html");

  const authenticated = await sharedPasswordGate(new Request("https://living-image.example/api/config", {
    headers: { Cookie: session },
  }), env);
  assert.equal(authenticated, null);
  const logout = await sharedPasswordGate(new Request("https://living-image.example/auth/logout", {
    method: "POST",
    headers: {
      Cookie: session,
      Origin: "https://living-image.example",
      "Sec-Fetch-Site": "same-origin",
    },
  }), env);
  assert.equal(logout?.status, 303);
  assert.match(logout?.headers.get("Set-Cookie") ?? "", /Max-Age=0/u);

  assert.equal((await sharedPasswordGate(new Request("https://living-image.example/compiler.html"), {
    ...env,
    REVIEW_PASSWORD: "short",
  }))?.status, 503);
  assert.equal((await sharedPasswordGate(new Request("https://living-image.example/compiler.html"), {
    ...env,
    REVIEW_AUTH_VERSION: "",
  }))?.status, 503);
});

test("Cloudflare request policy rejects method, media, length, size, and origin failures", () => {
  assert.equal(validateCompileRequest(new Request("https://living-image.example/api/compile"), requestId)?.status, 405);
  assert.equal(validateCompileRequest(uploadRequest({ "Content-Type": "image/gif" }), requestId)?.status, 415);
  assert.equal(validateCompileRequest(uploadRequest({ "Content-Length": "" }), requestId)?.status, 411);
  assert.equal(
    validateCompileRequest(uploadRequest({ "Content-Length": String(MAX_UPLOAD_BYTES + 1) }), requestId)?.status,
    413,
  );
  assert.equal(
    validateCompileRequest(uploadRequest({ Origin: "https://untrusted.example" }), requestId)?.status,
    403,
  );
  assert.equal(
    validateCompileRequest(uploadRequest({ Origin: "" }), requestId, true)?.status,
    403,
  );
});

test("private alpha verifies Cloudflare Access signature, issuer, audience, and expiry", async () => {
  const issuer = "https://living-image.cloudflareaccess.com";
  const audience = "living-image-policy";
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const { privateKey: wrongPrivateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.alg = "RS256";
  publicJwk.kid = "test-key";
  publicJwk.use = "sig";
  const localJwks = createLocalJWKSet({ keys: [publicJwk] });
  const sign = async (tokenIssuer = issuer, tokenAudience = audience, expiration: string | number = "5m") => new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuedAt()
    .setIssuer(tokenIssuer)
    .setAudience(tokenAudience)
    .setExpirationTime(expiration)
    .sign(privateKey);
  const verify = (request: Request, configuration = { audience, teamDomain: issuer }) => requireAccessAssertion(
    request,
    configuration,
    requestId,
    () => localJwks,
  );

  assert.equal((await verify(uploadRequest()))?.status, 401);
  assert.equal((await verify(uploadRequest({ "Cf-Access-Jwt-Assertion": await sign() }))), null);
  assert.equal((await verify(uploadRequest({ "Cf-Access-Jwt-Assertion": "forged-token" })))?.status, 403);
  const wrongKeyToken = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime("5m")
    .sign(wrongPrivateKey);
  assert.equal((await verify(uploadRequest({ "Cf-Access-Jwt-Assertion": wrongKeyToken })))?.status, 403);
  const unsupportedAlgorithmToken = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode("not-an-access-signing-key-123456"));
  assert.equal((await verify(uploadRequest({ "Cf-Access-Jwt-Assertion": unsupportedAlgorithmToken })))?.status, 403);
  assert.equal((await verify(uploadRequest({ "Cf-Access-Jwt-Assertion": await sign(issuer, "wrong-audience") })))?.status, 403);
  assert.equal((await verify(uploadRequest({ "Cf-Access-Jwt-Assertion": await sign("https://wrong.cloudflareaccess.com") })))?.status, 403);
  assert.equal((await verify(uploadRequest({ "Cf-Access-Jwt-Assertion": await sign(issuer, audience, 0) })))?.status, 403);
  assert.equal((await verify(uploadRequest(), { audience: "", teamDomain: issuer }))?.status, 503);
  assert.equal((await verify(uploadRequest(), { audience, teamDomain: "https://attacker.example" }))?.status, 503);
  assert.equal((await verify(uploadRequest(), { audience, teamDomain: "https://living-image.cloudflareaccess.com:8443" }))?.status, 503);
});

test("Cloudflare gateway bounds filenames and forwards only compiler headers", () => {
  assert.equal(
    validateCompileRequest(uploadRequest({ "X-Living-Image-Filename": "x".repeat(513) }), requestId)?.status,
    400,
  );
  const request = uploadRequest({
    Authorization: "Bearer secret",
    Cookie: "session=secret",
    "Cf-Access-Jwt-Assertion": "edge-validated-token",
    "X-Living-Image-Filename": "portrait.png",
  });
  const headers = forwardedHeaders(request, requestId);
  assert.deepEqual([...headers.keys()].sort(), ["content-type", "x-living-image-filename", "x-request-id"]);
  assert.equal(headers.get("Authorization"), null);
  assert.equal(headers.get("Cookie"), null);
  assert.equal(uploadLength(request), 24);
});
