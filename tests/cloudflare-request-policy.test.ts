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
  hostedCompilerPolicy,
  publicReviewWindowActive,
  requireAccessAssertion,
  uploadLength,
  validateCompileRequest,
} from "../deploy/cloudflare/request-policy.js";

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
    compilerEnabled: "true",
    requireAccessJwt: "true",
  };
  assert.deepEqual(hostedCompilerPolicy(privateBase, now), {
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
    compilerEnabled: "true",
    requireAccessJwt: "false",
    publicReviewNotBefore: "2026-07-21T13:59:00.000Z",
    publicReviewExpiresAt: "2026-07-21T16:00:00.000Z",
  }, now), {
    authenticationRequired: false,
    enabled: true,
    requireExactOrigin: true,
  });
  for (const publicReviewExpiresAt of ["", "invalid", "2026-07-21T14:00:00.000Z"]) {
    assert.equal(hostedCompilerPolicy({
      compilerEnabled: "true",
      requireAccessJwt: "false",
      publicReviewNotBefore: "2026-07-21T13:59:00.000Z",
      publicReviewExpiresAt,
    }, now).enabled, false);
  }
  assert.equal(hostedCompilerPolicy({
    compilerEnabled: "true",
    requireAccessJwt: "False",
  }, now).authenticationRequired, true);
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
