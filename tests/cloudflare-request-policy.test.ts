import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_UPLOAD_BYTES,
  forwardedHeaders,
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
});

test("private alpha requires a Cloudflare Access assertion by default", () => {
  assert.equal(requireAccessAssertion(uploadRequest(), true, requestId)?.status, 401);
  assert.equal(
    requireAccessAssertion(uploadRequest({ "Cf-Access-Jwt-Assertion": "edge-validated-token" }), true, requestId),
    null,
  );
  assert.equal(requireAccessAssertion(uploadRequest(), false, requestId), null);
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
