import { Container, getContainer } from "@cloudflare/containers";

import {
  forwardedHeaders,
  hostedCompilerPolicy,
  json,
  requireAccessAssertion,
  uploadLength,
  validateCompileRequest,
} from "./request-policy.js";
import { rateLimitKey, securityHeaders, sharedPasswordGate, unavailable } from "./review-auth.js";

function policy(env: Env) {
  return hostedCompilerPolicy({
    accessAudience: env.ACCESS_POLICY_AUD,
    accessTeamDomain: env.ACCESS_TEAM_DOMAIN,
    authenticationMode: env.AUTH_MODE,
    compilerEnabled: env.HOSTED_COMPILER_ENABLED,
    publicReviewExpiresAt: env.PUBLIC_REVIEW_EXPIRES_AT,
    publicReviewNotBefore: env.PUBLIC_REVIEW_NOT_BEFORE,
    reviewPassword: env.REVIEW_PASSWORD,
    reviewSessionSecret: env.REVIEW_SESSION_SECRET,
    requireAccessJwt: env.REQUIRE_ACCESS_JWT,
  });
}

export class CompilerContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  pingEndpoint = "ping";
  sleepAfter = "5m";
  enableInternet = false;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const compilerPolicy = policy(env);
    if (compilerPolicy.authentication === "invalid") return unavailable();
    if (compilerPolicy.authentication === "none" && !compilerPolicy.enabled) return unavailable();
    if (compilerPolicy.authentication === "shared-password") {
      const denied = await sharedPasswordGate(request, env, url);
      if (denied) return denied;
    } else if (compilerPolicy.authentication === "cloudflare-access") {
      const denied = await requireAccessAssertion(request, {
        audience: env.ACCESS_POLICY_AUD,
        teamDomain: env.ACCESS_TEAM_DOMAIN,
      }, crypto.randomUUID());
      if (denied) return denied;
    }
    if (url.pathname === "/api/config") {
      return json(200, {
        compiler: "hosted",
        enabled: compilerPolicy.enabled,
        authentication: compilerPolicy.authentication,
        reviewExpiresAt: compilerPolicy.authenticationRequired ? undefined : env.PUBLIC_REVIEW_EXPIRES_AT,
        samplesAvailable: false,
        provider: "cloudflare",
      });
    }
    if (url.pathname !== "/api/compile") {
      return url.pathname.startsWith("/api/")
        ? json(404, { status: "error", message: "Unknown compiler endpoint" })
        : env.ASSETS.fetch(request);
    }

    const requestId = crypto.randomUUID();
    if (!compilerPolicy.enabled) {
      return json(
        503,
        { status: "error", message: "Hosted compilation is not enabled for this deployment" },
        requestId,
      );
    }
    const invalid = validateCompileRequest(request, requestId, compilerPolicy.requireExactOrigin);
    if (invalid) return invalid;
    const compileLimit = await env.COMPILER_LIMITER.limit({ key: rateLimitKey(request) });
    if (!compileLimit.success) {
      return new Response(JSON.stringify({ status: "error", message: "Compilation limit reached; try again shortly" }), {
        status: 429,
        headers: { ...securityHeaders, "Content-Type": "application/json; charset=utf-8", "Retry-After": "60", "X-Request-Id": requestId },
      });
    }

    if (!request.body) {
      return json(400, { status: "error", message: "The selected image is empty" }, requestId);
    }
    const length = uploadLength(request);
    const fixedBody = new FixedLengthStream(length);
    const bodyTransfer = request.body.pipeTo(fixedBody.writable);
    const forwarded = new Request(request.url, {
      method: "POST",
      headers: forwardedHeaders(request, requestId),
      body: fixedBody.readable,
    });
    const compiler = getContainer(env.COMPILER, "primary");
    const [response] = await Promise.all([compiler.fetch(forwarded), bodyTransfer]);
    return response;
  },
} satisfies ExportedHandler<Env>;
